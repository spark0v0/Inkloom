"""Source-scoped, frozen input construction. No model operation mutates the library."""

from __future__ import annotations

import json
import math
import re
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from . import schemas as dto
from .domain import DomainError, digest, source_for
from .library import require_chapter, require_novel
from .models import Chapter, Entity, Fact, Job, Plan, Provider, Version
from .storage import PROJECT_DIR

RESULT_SCHEMAS = {
    "extract": dto.ExtractResult, "review": dto.ReviewResult,
    "plan": dto.PlanResult, "handoff": dto.HandoffResult,
}


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
            or novel.settings_revision != snapshot["settings_revision"]):
        return False
    if canon_checkpoint(session, novel.id, chapter.position) != job.context.get("canon_checkpoint", {}):
        return False
    return True


def provider_config(provider: Provider) -> dict[str, Any]:
    return {column.name: getattr(provider, column.name) for column in Provider.__table__.columns}


def build_context(session: Session, novel_id: str, request: dto.ContextInput) -> dict[str, Any]:
    novel = require_novel(session, novel_id)
    chapter = require_chapter(session, novel_id, request.chapter_id)
    if chapter.working_version_id != request.base_version_id:
        raise DomainError("VERSION_CONFLICT", "正文已更新，请保存当前稿后重新准备上下文。", 409)
    version = session.get(Version, chapter.working_version_id)
    provider = session.get(Provider, request.provider_id)
    if provider is None:
        raise DomainError("PROVIDER_NOT_FOUND", "请先选择或配置模型连接。", 404)
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
    draft_sources = [source_for(version, chapter, p) for p in version.paragraphs]
    if any(source["source_id"] in request.excluded_source_ids for source in draft_sources):
        raise DomainError("PROTECTED_CONTEXT", "当前章基线不能从任务中移除。")
    prior_chapters = session.scalars(select(Chapter).where(Chapter.novel_id == novel_id,
        Chapter.position < chapter.position, Chapter.review_state == "confirmed").order_by(
        Chapter.position.desc())).all()
    entities = session.scalars(select(Entity).where(Entity.novel_id == novel_id,
                    Entity.status == "author").order_by(Entity.updated_at.desc()).limit(60)).all()
    # Chinese names and aliases are matched literally; longer phrases also use FTS5 trigram.
    relevance_text = request.instruction + "\n" + chapter.goal + "\n" + version.text[-6000:]
    terms = re.findall(r"[\w\u3400-\u9fff]{2,32}", request.instruction)
    for entity in entities:
        names = [entity.name, *entity.aliases]
        if any(name in relevance_text for name in names if name):
            terms.extend(name for name in names if len(name) >= 2)
    terms = list(dict.fromkeys(terms))[:20]
    relevant_ids: set[str] = set()
    for term in terms:
        if len(term) >= 3:
            rows = session.execute(text("SELECT version_id,paragraph_id FROM story_search "
                "WHERE novel_id=:nid AND story_search MATCH :q LIMIT 30"),
                {"nid": novel_id, "q": '"' + term.replace('"', '""') + '"'}).all()
        else:
            rows = session.execute(text("SELECT version_id,paragraph_id FROM story_search "
                "WHERE novel_id=:nid AND instr(lower(body),lower(:q))>0 LIMIT 30"),
                {"nid": novel_id, "q": term}).all()
        relevant_ids.update(f"{row[0]}:{row[1]}" for row in rows)
    prior_sources = []
    optional_sources = []
    for i, prior in enumerate(prior_chapters):
        accepted = session.get(Version, prior.accepted_version_id)
        if not accepted:
            continue
        for paragraph in accepted.paragraphs:
            source = source_for(accepted, prior, paragraph)
            if source["source_id"] in request.excluded_source_ids:
                continue
            if i < 2:
                prior_sources.append(source)
            elif len(optional_sources) < 30:
                if source["source_id"] in relevant_ids:
                    optional_sources.append(source)
    plans = session.scalars(select(Plan).where(Plan.novel_id == novel_id).order_by(
        Plan.position).limit(30)).all()
    facts = session.scalars(select(Fact).join(Chapter, Fact.chapter_id == Chapter.id).where(
        Fact.novel_id == novel_id, Fact.active.is_(True), Chapter.position < chapter.position,
        Chapter.review_state == "confirmed").order_by(Fact.created_at.desc()).limit(60)).all()
    facts = [fact for fact in facts if not any(e["source_id"] in request.excluded_source_ids for e in fact.evidence)]
    included = {source["source_id"] for source in prior_sources}
    fact_sources = []
    for fact in facts:
        fact_version = session.get(Version, fact.version_id)
        fact_chapter = session.get(Chapter, fact.chapter_id)
        for evidence in fact.evidence:
            if evidence["source_id"] in included:
                continue
            paragraph = next(p for p in fact_version.paragraphs if p["paragraph_id"] == evidence["paragraph_id"])
            source = source_for(fact_version, fact_chapter, paragraph)
            fact_sources.append(source)
            included.add(source["source_id"])
    optional_sources = [source for source in optional_sources if source["source_id"] not in included]
    notices = ["Token 为保守估算，未使用此模型的专用 tokenizer。"]
    if not facts:
        notices.append("此前尚未整理结构化事实；本次只使用可用设定与已确认原文，不补造记忆。")
    if request.excluded_source_ids:
        notices.append("已按你的选择移除可选参考。当前章基线与作者硬约束保留。")
    input_body: dict[str, Any] = {
        "task": request.task,
        "author_brief": {"title": novel.title, "genre": novel.genre,
                         "premise": novel.premise, "style": novel.style},
        "chapter": {"title": chapter.title, "goal": chapter.goal, "position": chapter.position},
        "instruction": request.instruction,
        "target_chars": request.target_chars,
        "author_settings": [dto.EntityOut.model_validate(e).model_dump() for e in entities],
        "canon_facts": [dto.FactOut.model_validate(f).model_dump() for f in facts],
        "plans": [dto.PlanOut.model_validate(p).model_dump() for p in plans],
        "draft_sources": draft_sources,
        "sources": prior_sources + fact_sources + optional_sources,
        "selection": request.selection.model_dump() if request.selection else None,
    }
    if request.task == "rewrite" and request.selection:
        start, end = request.selection.start_codepoint, request.selection.end_codepoint
        input_body["surrounding_text"] = {"before": version.text[max(0, start - 1500):start],
                                         "after": version.text[end:end + 1500]}
        input_body["draft_sources"] = []
    if request.task in RESULT_SCHEMAS:
        input_body["output_schema"] = RESULT_SCHEMAS[request.task].model_json_schema()
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
    while optional_sources and estimate() > available:
        optional_sources.pop()
        input_body["sources"] = prior_sources + fact_sources + optional_sources
    if estimate() > available:
        raise DomainError("CONTEXT_TOO_LARGE", "本章基线和必要参考超出模型上下文预算。"
                          "请选择更大上下文的模型、减少近期长章或使用选段改写；未发送请求。", 422,
                          estimated_tokens=estimate(), available_tokens=available)
    config = provider_config(provider)
    estimated_max = None
    if provider.input_price is not None and provider.output_price is not None:
        estimated_max = (estimate() * provider.input_price + output * provider.output_price) / 1_000_000
    preview = dto.ContextOut(novel_id=novel_id, chapter_id=chapter.id, task=request.task,
        base_version_id=version.id, canon_revision=novel.canon_revision,
        settings_revision=novel.settings_revision, author_brief=input_body["author_brief"],
        chapter_goal=chapter.goal, instruction=request.instruction,
        current_selection=request.selection, rewrite_surroundings=input_body.get("surrounding_text", {}),
        sources=[dto.Source(**s) for s in
            input_body["draft_sources"] + prior_sources + fact_sources + optional_sources],
        entities=[dto.EntityOut.model_validate(e) for e in entities],
        facts=[dto.FactOut.model_validate(f) for f in facts],
        plans=[dto.PlanOut.model_validate(p) for p in plans],
        estimated_input_tokens=estimate(), max_output_tokens=output, context_window=window,
        estimate_note="按输入 UTF-8 字节估算，实际服务用量可能不同。", notices=notices,
        excluded_source_ids=request.excluded_source_ids,
        source_fingerprint=digest({"canon": novel.canon_revision, "settings": novel.settings_revision,
                                 "sources": [(s["source_id"], s["content_hash"]) for s in
                                             input_body["draft_sources"] + prior_sources + fact_sources + optional_sources]}),
        estimated_max_cost=estimated_max, currency=provider.currency,
        provider_name=provider.name, model=provider.model, is_demo=provider.kind == "demo",
        provider_url=provider.base_url)
    return {"preview": preview.model_dump(), "messages": messages_for(), "provider": config,
            "base_text": version.text, "target_chars": request.target_chars,
            "canon_checkpoint": canon_checkpoint(session, novel_id, chapter.position),
            "prompt_version": "v1", "input": input_body}


def validate_result(task: str, raw: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    schema = RESULT_SCHEMAS[task]
    result = schema.model_validate(raw).model_dump()
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
    return result
