"""Source-scoped, frozen input construction. No model operation mutates the library."""

from __future__ import annotations

import json
import math
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import schemas as dto
from .domain import DomainError, digest, source_for
from .library import require_chapter, require_novel
from .models import Chapter, Entity, Fact, Job, Plan, Provider, Version
from .references import resolve_references
from .retrieval import match_score, retrieval_terms, retrieve_source_ids, weight_terms
from .storage import PROJECT_DIR

RESULT_SCHEMAS = {
    "extract": dto.ExtractResult, "review": dto.ReviewResult,
    "plan": dto.PlanResult, "handoff": dto.HandoffResult,
    "blueprint": dto.BlueprintResult, "outline": dto.OutlineResult,
    "inspiration": dto.InspirationResult,
    "outline_edit": dto.OutlineEditResult,
}


def chapter_catalog(session: Session, novel_id: str) -> list[dict[str, Any]]:
    return [{"id": c.id, "title": c.title, "volume": c.volume, "goal": c.goal,
             "position": c.position, "version": c.working_version_id} for c in session.scalars(
        select(Chapter).where(Chapter.novel_id == novel_id).order_by(Chapter.position)).all()]


def canon_checkpoint(session: Session, novel_id: str, position: int) -> dict[str, str]:
    return {c.id: c.accepted_version_id for c in session.scalars(select(Chapter).where(
        Chapter.novel_id == novel_id, Chapter.position < position,
        Chapter.review_state == "confirmed")).all()}


def context_current(session: Session, job: Job) -> bool:
    novel = require_novel(session, job.novel_id)
    chapter = require_chapter(session, job.novel_id, job.chapter_id)
    snapshot = job.context["preview"]
    if (chapter.working_version_id != job.base_version_id
            or novel.canon_revision != snapshot["canon_revision"]
            or novel.settings_revision != snapshot["settings_revision"]
            or chapter.references_revision != snapshot.get("references_revision", 0)):
        return False
    position = job.context.get("narrative_position", chapter.position) if job.task == "outline" else chapter.position
    if canon_checkpoint(session, novel.id, position) != job.context.get("canon_checkpoint", {}):
        return False
    if job.task in {"blueprint", "outline"}:
        catalog = chapter_catalog(session, novel.id)
        expected = job.context.get("catalog_signature")
        if (expected and expected != digest(catalog)) or (not expected and job.context.get("catalog") != catalog):
            return False
    if job.task == "outline_edit":
        from .chapter_outlines import current_document
        frozen = job.context["input"].get("outline_edit", {})
        if (chapter.outline_revision != frozen.get("base_revision")
                or current_document(session, chapter).model_dump() != frozen.get("document")):
            return False
    from .review_rewrite import review_reference_current
    return review_reference_current(session, job)


def provider_config(provider: Provider) -> dict[str, Any]:
    from .providers import request_limits
    return {**{column.name: getattr(provider, column.name) for column in Provider.__table__.columns},
            **(request_limits() if provider.kind != "demo" else {})}


def build_context(session: Session, novel_id: str, request: dto.ContextInput) -> dict[str, Any]:
    novel = require_novel(session, novel_id)
    chapter = require_chapter(session, novel_id, request.chapter_id)
    if chapter.working_version_id != request.base_version_id:
        raise DomainError("VERSION_CONFLICT", "正文已更新，请保存当前稿后重新准备上下文。", 409)
    if request.references_revision is not None and chapter.references_revision != request.references_revision:
        raise DomainError("REFERENCE_CONFLICT", "本章参考已在其他窗口更新，请重新读取后再生成。", 409)
    version = session.get(Version, chapter.working_version_id)
    provider = session.get(Provider, request.provider_id)
    if provider is None:
        raise DomainError("PROVIDER_NOT_FOUND", "请先选择或配置模型连接。", 404)
    # An outline job's mount is a version/concurrency anchor, not the chapter being planned.
    catalog = chapter_catalog(session, novel_id)
    all_plans = session.scalars(select(Plan).where(Plan.novel_id == novel_id).order_by(Plan.position)).all()
    initial_slot = None
    narrative_position = chapter.position
    if request.task == "outline":
        if len(catalog) == 1 and not version.text and not any(p.structure.get("chapter_id") for p in all_plans):
            initial_slot = catalog[0]
        narrative_position = 1 if initial_slot else max((c["position"] for c in catalog), default=0) + 1
        reference_selection = dto.ReferenceSelection()
    else:
        reference_selection = dto.ReferenceSelection.model_validate(chapter.references)
    pinned_entities, pinned_sources = resolve_references(session, chapter, reference_selection)
    if any(source["source_id"] in request.excluded_source_ids for source in pinned_sources):
        raise DomainError("PROTECTED_CONTEXT", "本章必读不能在预览中排除，请先调整“本章参考”。")
    from .inspiration import chosen_direction
    direction = chosen_direction(session, novel_id, request)
    from .review_rewrite import review_guidance
    revision = review_guidance(session, novel_id, request)
    from .chapter_outlines import edit_guidance
    outline_edit = edit_guidance(session, novel_id, request)
    if request.task == "continue":
        if novel.dirty_from_order is not None and chapter.position > novel.dirty_from_order:
            raise DomainError("CANON_DIRTY", f"第 {novel.dirty_from_order} 章起的正史待复核。"
                              "手工写作不受影响，请先确认前文再自动续写。", 409)
        previous = session.scalars(select(Chapter).where(Chapter.novel_id == novel_id,
                    Chapter.position < chapter.position)).all()
        if any(c.review_state != "confirmed" for c in previous):
            raise DomainError("CANON_GAP", "自动续写需要先确认前面的章节，仍可自由手写或改写选段。", 409)
    if request.task == "rewrite":
        selection = request.selection
        if selection is None or version.text[selection.start_codepoint:selection.end_codepoint] != selection.text:
            raise DomainError("SELECTION_CHANGED", "选段与保存的原稿不一致，请重新选择。", 409)
    draft_sources = [] if request.task == "outline" else [source_for(version, chapter, p) for p in version.paragraphs]
    if any(source["source_id"] in request.excluded_source_ids for source in draft_sources):
        raise DomainError("PROTECTED_CONTEXT", "当前章基线不能从任务中移除。")
    prior_chapters = session.scalars(select(Chapter).where(Chapter.novel_id == novel_id,
        Chapter.position < narrative_position, Chapter.review_state == "confirmed").order_by(
        Chapter.position.desc())).all()
    chapter_plans = [] if request.task == "outline" else [p for p in all_plans if p.structure.get("chapter_id") == chapter.id]
    outline_volume = next((p for p in all_plans if p.id == request.volume_plan_id and p.level == "volume"), None)
    if request.task == "outline" and outline_volume is None:
        raise DomainError("VOLUME_NOT_FOUND", "请先选择本书分卷。", 404)
    # Prose tasks retrieve against the current chapter. Outlining uses its volume and
    # recent plans; neither turns future intentions into evidence of past events.
    direction_query = " ".join(str(direction["direction"][key]) for key in ("title", "event", "motivation")) if direction else ""
    query_title = outline_volume.title if request.task == "outline" else chapter.title
    query_goal = outline_volume.body if request.task == "outline" else chapter.goal
    recent_plan_text = "\n".join(c["goal"][:1500] for c in catalog[-6:]) if request.task == "outline" else ""
    query_text = "\n".join([request.instruction, query_title, query_goal, direction_query, recent_plan_text,
                            *(" ".join([e.name, *e.aliases]) for e in pinned_entities),
                            *(p.body for p in chapter_plans)])
    recent_text = version.text[-6000:]
    if request.task == "outline":
        recent_text = ""
        if prior_chapters:
            recent_text = session.get(Version, prior_chapters[0].accepted_version_id).text[-6000:]
    relevance_text = (query_text + "\n" + recent_text).casefold()
    all_entities = session.scalars(select(Entity).where(Entity.novel_id == novel_id,
                    Entity.status == "author").order_by(Entity.updated_at.desc(), Entity.id)).all()
    matched = [e for e in all_entities if any(name and name.casefold() in relevance_text
                                             for name in [e.name, *e.aliases])]
    # Match BEFORE limiting. All matched settings and world rules are mandatory;
    # the context budget rejects an oversized request instead of silently dropping them.
    required_ids = {e.id for e in matched} | {e.id for e in all_entities if e.kind == "world"} | {
        e.id for e in pinned_entities}
    from .threads import thread_context
    thread_guidance, thread_sources = thread_context(session, novel_id, narrative_position, required_ids)
    if any(source["source_id"] in request.excluded_source_ids for source in thread_sources):
        raise DomainError("PROTECTED_CONTEXT", "本次伏笔跟进的原文依据不能排除，请先调整伏笔安排或暂缓跟进。")
    required_ids.update(item.entity_id for item in thread_guidance)
    required = [e for e in all_entities if e.id in required_ids]
    entities = required + [e for e in all_entities if e.id not in required_ids][:max(0, 60 - len(required))]
    terms, terms_omitted = retrieval_terms(query_text, [name for e in matched for name in [e.name, *e.aliases]])
    terms = weight_terms(session, novel_id, narrative_position, terms)
    ranked_ids = retrieve_source_ids(session, novel_id, narrative_position, terms, request.excluded_source_ids)
    relevant_ids = set(ranked_ids)
    prior_sources = []
    optional_sources = []
    for i, prior in enumerate(prior_chapters):
        if i >= 2 and not any(source_id.startswith(prior.accepted_version_id + ":") for source_id in relevant_ids):
            continue
        accepted = session.get(Version, prior.accepted_version_id)
        if not accepted:
            continue
        for paragraph in accepted.paragraphs:
            source = source_for(accepted, prior, paragraph)
            if source["source_id"] in request.excluded_source_ids:
                continue
            if i < 2:
                prior_sources.append(source)
            elif source["source_id"] in relevant_ids:
                optional_sources.append(source)
    source_rank = {source_id: rank for rank, source_id in enumerate(ranked_ids)}
    optional_sources.sort(key=lambda source: source_rank[source["source_id"]])
    # Explicit pins and selected thread evidence are hard constraints; automatic
    # recent prose is useful context, not an implicit pin of two entire chapters.
    protected_ids = {source["source_id"] for source in pinned_sources + thread_sources}
    latest_id = prior_chapters[0].id if prior_chapters else None
    continuity_ids = {source["source_id"] for source in
                      [source for source in prior_sources if source["chapter_id"] == latest_id][-2:]}
    prior_by_id = {source["source_id"]: source for source in prior_sources}
    prior_by_id.update({source["source_id"]: source for source in pinned_sources})
    prior_by_id.update({source["source_id"]: source for source in thread_sources})
    prior_sources = list(prior_by_id.values())
    volume_id = request.volume_plan_id if request.task == "outline" else next(
        (p.id for p in all_plans if p.level == "volume" and p.title == chapter.volume), None)
    plans = [p for p in all_plans if p.level == "book" or p.id == volume_id
             or (request.task != "outline" and p.structure.get("chapter_id") == chapter.id)]
    # Older free-form plans remain usable, without injecting every future volume/outline.
    plans += [p for p in all_plans if not p.structure and p.level in {"chapter", "scene"}][-6:]

    def plan_context(plan):
        data = dto.PlanOut.model_validate(plan).model_dump()
        # The authoritative, editable body is sufficient. Do not duplicate the original
        # full blueprint (characters/world/all volumes) inside every model request.
        data["structure"] = {}
        return data
    production = None
    if request.task == "blueprint":
        if any(p.level == "book" for p in all_plans):
            raise DomainError("BLUEPRINT_EXISTS", "本书已有全书方案。请编辑现有大纲，或继续规划分卷章节。", 409)
        production = {"platform": novel.platform, "target_words": novel.target_words,
                      "chapter_words": novel.chapter_words}
    elif request.task == "outline":
        volume = outline_volume
        later_volumes = [p.id for p in all_plans if p.level == "volume" and p.position > volume.position]
        if any(p.parent_id in later_volumes and p.structure.get("chapter_id") for p in all_plans):
            raise DomainError("VOLUME_ORDER", "后面的卷已有章节，请继续规划最后一个已有章节的分卷。", 409)
        # Only the untouched initial slot may be reused; existing drafts are never overwritten.
        next_number = narrative_position
        production = {"platform": novel.platform, "target_words": novel.target_words,
            "chapter_words": novel.chapter_words, "volume_plan_id": volume.id,
            "volume": plan_context(volume), "chapter_count": request.chapter_batch,
            "start_number": next_number, "initial_slot": initial_slot["id"] if initial_slot else None,
            "recent_chapter_plans": [{"title": c["title"], "goal_excerpt": c["goal"][:1500]} for c in catalog[-6:]]}
    fact_query = select(Fact).join(Chapter, Fact.chapter_id == Chapter.id).where(
        Fact.novel_id == novel_id, Fact.active.is_(True), Chapter.position < narrative_position,
        Fact.version_id == Chapter.accepted_version_id,
        Chapter.review_state == "confirmed").order_by(Fact.created_at.desc())
    fact_score = match_score(Fact.subject + " " + Fact.claim, terms)
    relevant_facts = session.scalars(fact_query.order_by(None).where(fact_score > 0)
        .order_by(fact_score.desc(), Fact.created_at.desc(), Fact.id).limit(35)).all() if terms else []
    recent_facts = session.scalars(fact_query.limit(40)).all()
    seen = {f.id for f in relevant_facts}
    facts = (relevant_facts + [f for f in recent_facts if f.id not in seen])[:60]
    facts = [fact for fact in facts if not any(e["source_id"] in request.excluded_source_ids for e in fact.evidence)]
    fact_source_pool = {}
    for fact in facts:
        fact_version = session.get(Version, fact.version_id)
        fact_chapter = session.get(Chapter, fact.chapter_id)
        for evidence in fact.evidence:
            if evidence["source_id"] in fact_source_pool:
                continue
            paragraph = next(p for p in fact_version.paragraphs if p["paragraph_id"] == evidence["paragraph_id"])
            fact_source_pool[evidence["source_id"]] = source_for(fact_version, fact_chapter, paragraph)

    def reading_sources():
        # Rebuild after every trim so retained facts never lose their evidence,
        # and removing one fact cannot remove another channel's shared source.
        sources = {source["source_id"]: source for source in prior_sources}
        for fact in facts:
            for evidence in fact.evidence:
                sources.setdefault(evidence["source_id"], fact_source_pool[evidence["source_id"]])
        for source in optional_sources:
            sources.setdefault(source["source_id"], source)
        return list(sources.values())

    initial_source_ids = {source["source_id"] for source in reading_sources()}
    initial_fact_count = len(facts)
    notices = ["Token 为保守估算，未使用此模型的专用 tokenizer。"]
    if terms_omitted:
        notices.append("本章检索词较多，已优先检索人物及别名；部分检索词未纳入。")
    if not facts:
        notices.append("此前尚未整理结构化事实；本次只使用可用设定与已确认原文，不补造记忆。")
    if request.excluded_source_ids:
        notices.append("已按你的选择移除可选参考。当前章基线与作者硬约束保留。")
    if reference_selection.entity_ids or reference_selection.chapters:
        notices.append(f"本章必读：{len(reference_selection.entity_ids)} 项设定、{len(reference_selection.chapters)} 章定稿；不自动裁剪。")
    if reference_selection.notes:
        notices.append("本章补充资料只作创作参考，不作为故事中已发生事实的依据。")
    input_body: dict[str, Any] = {
        "task": request.task,
        "author_brief": {"title": novel.title, "genre": novel.genre,
                         "premise": novel.premise, "style": novel.style},
        "chapter": {"title": "待规划章节" if request.task == "outline" else chapter.title,
                    "goal": query_goal, "position": narrative_position},
        "instruction": request.instruction,
        "target_chars": request.target_chars,
        "author_settings": [dto.EntityOut.model_validate(e).model_dump() for e in entities],
        "canon_facts": [dto.FactOut.model_validate(f).model_dump() for f in facts],
        "plans": [plan_context(p) for p in plans],
        "draft_sources": draft_sources,
        "sources": reading_sources(),
        "selection": request.selection.model_dump() if request.selection else None,
    }
    if production is not None:
        input_body["production"] = production
    if direction is not None:
        input_body["inspiration_direction"] = direction
    if revision is not None:
        input_body["review_guidance"] = revision
    if thread_guidance:
        input_body["thread_guidance"] = [item.model_dump() for item in thread_guidance]
    writing_preferences = dto.WritingPreferences.model_validate(novel.writing_preferences)
    style_profile = None
    if request.task in {"continue", "rewrite", "review"} and writing_preferences != dto.WritingPreferences():
        style_profile = writing_preferences
        input_body["writing_preferences"] = {
            "viewpoint": writing_preferences.viewpoint,
            "avoid": writing_preferences.avoid,
            "example": {"status": "author_supplied_noncanonical_style_sample", "text": writing_preferences.example},
        }
    input_body["reference_selection"] = {"entity_ids": reference_selection.entity_ids,
        "chapters": [pin.model_dump() for pin in reference_selection.chapters], "revision": chapter.references_revision}
    if reference_selection.notes:
        input_body["reference_material"] = {"status": "author_supplied_noncanonical", "text": reference_selection.notes}
    input_body["author_brief"].update({"platform": novel.platform,
        "target_words": str(novel.target_words), "chapter_words": str(novel.chapter_words)})
    if request.task == "rewrite" and request.selection:
        start, end = request.selection.start_codepoint, request.selection.end_codepoint
        input_body["surrounding_text"] = {"before": version.text[max(0, start - 1500):start],
                                         "after": version.text[end:end + 1500]}
        input_body["draft_sources"] = []
    if request.task in RESULT_SCHEMAS:
        input_body["output_schema"] = RESULT_SCHEMAS[request.task].model_json_schema()
    if outline_edit:
        input_body["outline_edit"] = outline_edit
    base_prompt = (PROJECT_DIR / "prompts/base-v1.md").read_text(encoding="utf-8")
    task_prompt = (PROJECT_DIR / f"prompts/{request.task}-v1.md").read_text(encoding="utf-8")

    def messages_for() -> list[dict[str, str]]:
        return [{"role": "system", "content": base_prompt + "\n" + task_prompt},
                {"role": "user", "content": json.dumps(input_body, ensure_ascii=False)}]

    def estimate() -> int:
        return math.ceil(sum(len(m["content"].encode("utf-8")) for m in messages_for()) / 2) + 256

    window = provider.context_window
    output = provider.max_output_tokens
    available = window - output - max(512, math.ceil(window * .08))
    optional_entity_count = len(entities) - len(required)
    while len(entities) > len(required) and estimate() > available:
        entities.pop()
        input_body["author_settings"].pop()
    trimmable_recent = sorted((source for source in prior_sources
        if source["source_id"] not in protected_ids | continuity_ids),
        key=lambda source: (source["source_id"] in relevant_ids, source["chapter_position"]))
    for source in trimmable_recent:
        if estimate() <= available:
            break
        prior_sources.remove(source)
        input_body["sources"] = reading_sources()
    while optional_sources and estimate() > available:
        optional_sources.pop()
        input_body["sources"] = reading_sources()
    while facts and estimate() > available:
        facts.pop()
        input_body["canon_facts"].pop()
        input_body["sources"] = reading_sources()
    if estimate() > available:
        raise DomainError("CONTEXT_TOO_LARGE", "本章基线和必要参考超出模型上下文预算。"
                          "请选择更大上下文的模型、减少必要设定或本章必读，或缩小当前稿/选段范围。"
                          "最近衔接段落与明确必读不会自动截断；未发送请求。", 422,
                          estimated_tokens=estimate(), available_tokens=available)
    omitted_sources = len(initial_source_ids - {source["source_id"] for source in input_body["sources"]})
    if omitted_sources:
        notices.append(f"受上下文预算限制，{omitted_sources} 段自动前文未纳入；最近衔接原文、本章必读与伏笔依据已保留。")
    if len(facts) < initial_fact_count:
        notices.append(f"受上下文预算限制，{initial_fact_count - len(facts)} 条自动记忆及其专用引文未纳入；"
                       "记录仍保存在本书中，未纳入不代表没有发生。")
    if len(entities) < len(all_entities):
        notices.append(f"本次参考 {len(entities)} / {len(all_entities)} 条作者设定；"
                       "本章提及的人物、别名及世界规则优先，其余部分设定未纳入。")
    removed_entities = optional_entity_count - (len(entities) - len(required))
    if removed_entities:
        notices.append(f"受上下文预算限制，{removed_entities} 条未命中的可选设定未纳入；必读与命中设定已保留。")
    if request.task == "outline":
        notices.append("后续章纲读取此前有效定稿与实际记忆；未定稿正文不作为已发生剧情，最近细纲仍属于计划。")
    config = provider_config(provider)
    if provider.kind != "demo":
        notices.append(f"本次请求最长 {config['request_timeout_seconds']:g} 秒；连续 {config['progress_timeout_seconds']:g} 秒无有效正文则停止等待，费用可能未知。")
    estimated_max = None
    if provider.input_price is not None and provider.output_price is not None:
        estimated_max = (estimate() * provider.input_price + output * provider.output_price) / 1_000_000
    preview = dto.ContextOut(novel_id=novel_id, chapter_id=chapter.id, task=request.task,
        outline_edit=request.outline_edit,
        writing_preferences=style_profile,
        thread_guidance=thread_guidance,
        base_version_id=version.id, canon_revision=novel.canon_revision,
        settings_revision=novel.settings_revision, author_brief=input_body["author_brief"],
        references_revision=chapter.references_revision, pinned_entity_ids=reference_selection.entity_ids,
        pinned_chapters=reference_selection.chapters, reference_notes=reference_selection.notes,
        target_chars=request.target_chars,
        chapter_goal=query_goal, instruction=request.instruction,
        current_selection=request.selection, rewrite_surroundings=input_body.get("surrounding_text", {}),
        sources=[dto.Source(**s) for s in
            input_body["draft_sources"] + input_body["sources"]],
        entities=[dto.EntityOut.model_validate(e) for e in entities],
        facts=[dto.FactOut.model_validate(f) for f in facts],
        plans=[dto.PlanOut(**plan_context(p)) for p in plans],
        estimated_input_tokens=estimate(), max_output_tokens=output, context_window=window,
        estimate_note="按输入 UTF-8 字节估算，实际服务用量可能不同。", notices=notices,
        excluded_source_ids=request.excluded_source_ids,
        source_fingerprint=digest({"canon": novel.canon_revision, "settings": novel.settings_revision,
                                 "sources": [(s["source_id"], s["content_hash"]) for s in
                                             input_body["draft_sources"] + input_body["sources"]]}),
        estimated_max_cost=estimated_max, currency=provider.currency,
        provider_name=provider.name, model=provider.model, is_demo=provider.kind == "demo",
        provider_url=provider.base_url,
        inspiration_title=direction["direction"]["title"] if direction else None,
        inspiration_reference=request.inspiration, review_reference=request.review_reference,
        review_explanation=revision["finding"]["explanation"] if revision else None,
        review_suggestion=revision["finding"]["suggestion"] if revision else None)
    return {"preview": preview.model_dump(), "messages": messages_for(), "provider": config,
            "base_text": version.text, "target_chars": request.target_chars,
            "narrative_position": narrative_position,
            "canon_checkpoint": canon_checkpoint(session, novel_id, narrative_position),
            "prompt_version": "v1", "input": input_body, "catalog_signature": digest(catalog)}


def validate_result(task: str, raw: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    schema = RESULT_SCHEMAS[task]
    result = schema.model_validate(raw).model_dump()
    if task == "outline_edit":
        from .chapter_outlines import validate_edit_result
        validate_edit_result(result, context)
    sources = context["preview"]["sources"]
    draft_sources = [s for s in sources if s["version_id"] == context["preview"]["base_version_id"]]
    entity_ids = {e["id"] for e in context["preview"]["entities"] if e["kind"] == "character"}
    if task in {"extract", "handoff"}:
        from .domain import resolve_evidence
        key = "changes" if task == "extract" else "observations"
        for change in result[key]:
            if any(character not in entity_ids for character in change["known_by"]):
                raise DomainError("INVALID_EVIDENCE", "模型引用了不属于本书的人物。")
            change["evidence"] = [resolve_evidence(e, draft_sources) for e in change["evidence"]]
    elif task == "inspiration":
        from .domain import resolve_evidence
        titles = [option["title"].strip() for option in result["options"]]
        if any(not title for title in titles) or len(set(titles)) != 3:
            raise DomainError("INVALID_INSPIRATION", "请提供三个标题明确且不同的剧情方向。")
        for option in result["options"]:
            option["evidence"] = [resolve_evidence(e, sources) for e in option["evidence"]]
    elif task == "review":
        from .domain import resolve_evidence
        for finding in result["findings"]:
            finding["target"] = resolve_evidence(finding["target"], draft_sources)
            finding["source_evidence"] = [resolve_evidence(e, sources) for e in finding["source_evidence"]]
            if finding["type"] == "fact_conflict" and not finding["source_evidence"]:
                finding["type"] = "needs_verification"
                finding["severity"] = "question"
            finding["decision"] = "pending"
            finding["decision_note"] = ""
    elif task == "outline":
        production = context["input"]["production"]
        expected = list(range(production["start_number"], production["start_number"] + production["chapter_count"]))
        if [c["number"] for c in result["chapters"]] != expected:
            raise DomainError("INVALID_OUTLINE", "章节数量或编号与本次规划范围不一致，请调整要求后重试。")
        if result["volume_title"] != production["volume"]["title"]:
            raise DomainError("INVALID_OUTLINE", "生成的分卷名与所选分卷不一致。")
    elif task == "blueprint":
        names = [v["title"].strip() for v in result["volumes"]]
        if len(set(names)) != len(names) or any(not name for name in names):
            raise DomainError("INVALID_BLUEPRINT", "分卷标题为空或重复，请调整要求后重试。")
    return result
