"""Scoped planning conversations; proposals never mutate prose or facts."""
from __future__ import annotations

import json
import math

from sqlalchemy import and_, or_, select

from . import schemas as dto
from .chapter_outlines import (
    DOCUMENT,
    STRUCTURED_FIELDS,
    changed_settings,
    current_document,
    state,
    write_outline,
)
from .discussion_sources import materials, validate_snapshot
from .domain import DomainError, digest, resolve_evidence, uid
from .library import require_chapter, require_job, require_novel
from .models import Job, Plan, PlanningConversation, Provider
from .storage import PROJECT_DIR


def require_conversation(session, novel_id, conversation_id):
    row = session.get(PlanningConversation, conversation_id)
    if row is None or row.novel_id != novel_id:
        raise DomainError("DISCUSSION_NOT_FOUND", "此作品中没有该讨论。", 404)
    return row


def _chapters(session, novel_id, ids):
    return [{"chapter_id": chapter.id, "volume": chapter.volume, "revision": chapter.outline_revision,
             "document": current_document(session, chapter).model_dump()}
            for chapter in [require_chapter(session, novel_id, chapter_id) for chapter_id in ids]]


def build_discussion_context(session, novel_id, request):
    from .context import provider_config
    novel = require_novel(session, novel_id)
    reference = request.discussion
    if reference is None or len(reference.chapter_ids) != len(set(reference.chapter_ids)):
        raise DomainError("DISCUSSION_REFERENCE_REQUIRED", "请选择一至三章不重复的细纲。")
    conversation = require_conversation(session, novel_id, reference.conversation_id)
    if conversation.last_job_id != reference.last_job_id:
        raise DomainError("DISCUSSION_CONFLICT", "讨论已在其他窗口更新，请读取最新对话后再发送。", 409)
    if not request.instruction.strip() or len(request.instruction) > 4000:
        raise DomainError("DISCUSSION_MESSAGE_INVALID", "请填写不超过 4000 字符的讨论内容。")
    if request.chapter_id != reference.chapter_ids[0]:
        raise DomainError("DISCUSSION_ANCHOR", "讨论入口与所选第一章不一致，请重新准备。")
    chapter = require_chapter(session, novel_id, request.chapter_id)
    if chapter.working_version_id != request.base_version_id:
        raise DomainError("VERSION_CONFLICT", "章节已更新，请读取最新资料后再发送。", 409)
    if (request.selection or request.outline_edit or request.inspiration or request.review_reference
            or request.excluded_source_ids or request.volume_plan_id or request.scene):
        raise DomainError("DISCUSSION_SCOPE", "讨论仅使用明确选择的细纲、正文、档案与本书规划。")
    provider = session.get(Provider, request.provider_id)
    if provider is None:
        raise DomainError("PROVIDER_NOT_FOUND", "请先选择模型连接。", 404)
    chapters = _chapters(session, novel_id, reference.chapter_ids)
    manuscripts, sources, entities = materials(session, novel_id, reference)
    volumes = {item["volume"] for item in chapters}
    plans = session.scalars(select(Plan).where(Plan.novel_id == novel_id,
        or_(Plan.level == "book", and_(Plan.level == "volume", Plan.title.in_(volumes))))
        .order_by(Plan.position, Plan.id)).all()
    notices = ["细纲与讨论属于计划和建议；正文按列出的版本读取，当前稿和待复核稿不作为正式事实。"
               if manuscripts else "本次没有选择正文；仅读取所选细纲、档案与本书规划，不推断正文已发生的事件。"]
    history = session.execute(select(Job.instruction, Job.result, Job.candidate_status).where(
        Job.novel_id == novel_id, Job.conversation_id == conversation.id, Job.state == "succeeded")
        .order_by(Job.conversation_turn.desc()).limit(9)).all()
    turns = [{"author": row.instruction, "suggestion": row.result,
              "applied": row.candidate_status == "adopted"} for row in reversed(history[:8])]
    payload = {"author_brief": {"title": novel.title, "premise": novel.premise, "style": novel.style},
        "chapter_outlines": chapters,
        "manuscripts": manuscripts, "sources": sources, "entities": entities,
        "plans": [{"id": p.id, "title": p.title, "level": p.level, "body": p.body[:3000]} for p in plans],
        "past_discussions_not_facts": turns, "message": request.instruction,
        "output_schema": dto.DiscussionResult.model_json_schema()}
    if any(len(p.body) > 3000 for p in plans):
        notices.append("全书/分卷资料仅取各项前 3000 字符；所选细纲保持完整。")
    system = (PROJECT_DIR / "prompts/base-v1.md").read_text(encoding="utf-8") + "\n" + (PROJECT_DIR / "prompts/discuss-v2.md").read_text(encoding="utf-8")

    def messages():
        return [{"role": "system", "content": system},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}]

    def estimate():
        return math.ceil(sum(len(m["content"].encode("utf-8")) for m in messages()) / 2) + 256
    available = provider.context_window - provider.max_output_tokens - max(512, math.ceil(provider.context_window * .08))
    omitted = max(0, len(history) - 8)
    while turns and estimate() > available:
        turns.pop(0)
        omitted += 1
    while payload["plans"] and estimate() > available:
        payload["plans"].pop()
        notices.append("有一项全书/分卷资料未纳入，以保留完整选定细纲。")
    if estimate() > available:
        raise DomainError("CONTEXT_TOO_LARGE", "所选细纲、正文、档案与问题超出模型容量，请减少参考资料或选择更大上下文的模型。", 422)
    if omitted:
        notices.append("部分较早讨论未纳入本次请求，完整记录仍可分页查看。")
    fingerprint = digest({"input": payload, "provider": provider_config(provider),
                          "settings_revision": novel.settings_revision, "canon_revision": novel.canon_revision})
    if reference.source_fingerprint is not None and reference.source_fingerprint != fingerprint:
        raise DomainError("DISCUSSION_CONTEXT_CHANGED", "本次参考资料已变化，请重新查看资料后再发送。", 409)
    reference = reference.model_copy(update={"source_fingerprint": fingerprint})
    max_cost = ((estimate() * provider.input_price + provider.max_output_tokens * provider.output_price) / 1_000_000
                if provider.input_price is not None and provider.output_price is not None else None)
    included_ids = {item["id"] for item in payload["plans"]}
    preview = dto.ContextOut(novel_id=novel_id, chapter_id=chapter.id, base_version_id=request.base_version_id,
        task="discuss", canon_revision=novel.canon_revision, settings_revision=novel.settings_revision,
        discussion=reference, discussion_outlines=chapters, discussion_manuscripts=manuscripts,
        author_brief=payload["author_brief"], instruction=request.instruction,
        sources=sources, entities=entities, facts=[], plans=[dto.PlanOut.model_validate(p).model_copy(update={
            "body": next(item["body"] for item in payload["plans"] if item["id"] == p.id), "structure": {}})
            for p in plans if p.id in included_ids],
        estimated_input_tokens=estimate(), max_output_tokens=provider.max_output_tokens,
        context_window=provider.context_window, estimate_note="按输入 UTF-8 字节估算，实际用量可能不同。",
        notices=notices, excluded_source_ids=[], source_fingerprint=fingerprint, estimated_max_cost=max_cost,
        currency=provider.currency, provider_name=provider.name, model=provider.model,
        is_demo=provider.kind == "demo", provider_url=provider.base_url)
    return {"preview": preview.model_dump(), "messages": messages(), "provider": provider_config(provider),
            "prompt_version": "discuss-v2", "input": payload, "base_text": ""}


def discussion_current(session, job):
    reference = job.context["preview"]["discussion"]
    conversation = require_conversation(session, job.novel_id, reference["conversation_id"])
    novel = require_novel(session, job.novel_id)
    if (conversation.last_job_id != job.id or novel.settings_revision != job.context["preview"]["settings_revision"]
            or novel.canon_revision != job.context["preview"]["canon_revision"]):
        return False
    if _chapters(session, job.novel_id, reference["chapter_ids"]) != job.context["input"]["chapter_outlines"]:
        return False
    if reference.get("manuscripts") or reference.get("entity_ids"):
        try:
            manuscripts, sources, entities = materials(session, job.novel_id, dto.DiscussionReference.model_validate(reference))
        except DomainError:
            return False
        return (manuscripts == job.context["input"]["manuscripts"] and sources == job.context["input"]["sources"]
                and entities == job.context["input"]["entities"])
    return True


def validate_discussion_result(result, context):
    chapters = {item["chapter_id"]: item for item in context["input"]["chapter_outlines"]}
    readable = chapters.keys() | {item["chapter_id"] for item in context["input"].get("manuscripts", [])}
    if not set(result["referenced_chapter_ids"]) <= readable:
        raise DomainError("DISCUSSION_SCOPE", "回复引用了未选择的章节。")
    result["evidence"] = [resolve_evidence(item, context["input"].get("sources", [])) for item in result.get("evidence", [])]
    proposal = result["proposal"]
    if proposal is None:
        return
    if proposal["chapter_id"] not in chapters:
        raise DomainError("DISCUSSION_SCOPE", "建议修改了未选择的章节。")
    original = chapters[proposal["chapter_id"]]["document"]
    allowed = set(STRUCTURED_FIELDS) if original["kind"] == "structured" else {"text"}
    selected = set(proposal["fields"])
    candidate = proposal["document"]
    if (not selected or len(selected) != len(proposal["fields"]) or not selected <= allowed or original.keys() != candidate.keys()
            or any(candidate[k] != value for k, value in original.items() if k not in selected)):
        raise DomainError("DISCUSSION_SCOPE", "建议改变了细纲格式或允许范围之外的字段。")


class Discussions:
    def __init__(self, workspace):
        self.ws = workspace

    def create(self, novel_id, data):
        with self.ws.session(write=True) as session:
            require_novel(session, novel_id)
            row = PlanningConversation(id=uid("discussion"), novel_id=novel_id, title=data.title)
            session.add(row)
            session.flush()
            return dto.ConversationOut.model_validate(row)

    def list(self, novel_id):
        with self.ws.session() as session:
            require_novel(session, novel_id)
            return [dto.ConversationOut.model_validate(row) for row in session.scalars(select(PlanningConversation)
                .where(PlanningConversation.novel_id == novel_id).order_by(PlanningConversation.created_at.desc(), PlanningConversation.id.desc())).all()]

    def get(self, novel_id, conversation_id, before=None):
        with self.ws.session() as session:
            conversation = require_conversation(session, novel_id, conversation_id)
            query = select(Job.id, Job.instruction, Job.state, Job.candidate_status, Job.result,
                Job.error_message, Job.is_demo, Job.created_at).where(Job.novel_id == novel_id,
                Job.conversation_id == conversation_id)
            if before:
                cursor = session.execute(select(Job.id, Job.conversation_turn).where(Job.id == before,
                    Job.novel_id == novel_id, Job.conversation_id == conversation_id)).first()
                if cursor is None:
                    raise DomainError("INVALID_DISCUSSION_CURSOR", "消息位置不属于此讨论。")
                query = query.where(Job.conversation_turn < cursor.conversation_turn)
            rows = session.execute(query.order_by(Job.conversation_turn.desc()).limit(31)).mappings().all()
            items = [dto.DiscussionTurn(**row, applied=row["candidate_status"] == "adopted") for row in rows[:30]]
            return dto.DiscussionPage(conversation=dto.ConversationOut.model_validate(conversation),
                items=items, next_before=rows[29]["id"] if len(rows) > 30 else None)

    def adopt(self, novel_id, job_id, data):
        with self.ws.session(write=True) as session:
            job = require_job(session, novel_id, job_id)
            if job.task != "discuss" or not job.result or not job.result.get("proposal"):
                raise DomainError("DISCUSSION_PROPOSAL_MISSING", "这条回复没有可采纳的细纲建议。", 409)
            signature = digest(data.model_dump())
            applied = job.context.get("discussion_applied")
            target = job.result["proposal"]["chapter_id"]
            if applied:
                if signature != applied["signature"]:
                    raise DomainError("IDEMPOTENCY_CONFLICT", "该建议已采纳，不能换字段再次覆盖。", 409)
                return state(session, novel_id, target).model_copy(update={"operation_revision": applied["revision"]})
            if job.state != "succeeded" or job.candidate_status != "ready" or not discussion_current(session, job):
                raise DomainError("DISCUSSION_STALE", "参考细纲、作品资料或后续讨论已变化，请重新讨论后再采纳。", 409)
            validate_discussion_result(job.result, job.context)
            proposal = job.result["proposal"]
            fields = set(data.fields)
            if not fields or not fields <= set(proposal["fields"]):
                raise DomainError("OUTLINE_FIELDS_INVALID", "只能采纳本次建议中的字段。")
            frozen = next(item for item in job.context["input"]["chapter_outlines"] if item["chapter_id"] == target)
            if data.base_revision != frozen["revision"]:
                raise DomainError("OUTLINE_CONFLICT", "提案基线不一致，请读取最新细纲。", 409)
            document = DOCUMENT.validate_python(frozen["document"]).model_copy(update={
                key: proposal["document"][key] for key in fields})
            chapter = require_chapter(session, novel_id, target)
            result = write_outline(session, chapter, document, data.base_revision, data.operation_id, source="discussion:" + job.id)
            changed_settings(require_novel(session, novel_id))
            job.context = {**job.context, "discussion_applied": {"signature": signature, "revision": result.revision}}
            job.candidate_status = "adopted"
            return result


def validate_restored_discussions(connection):
    """Validate untrusted cross-book links before restored tasks can be retried."""
    chapters = {row[0]: row[1] for row in connection.execute("SELECT id,novel_id FROM chapters")}
    conversations = {}
    for cid, nid, raw_ids, head in connection.execute(
            "SELECT id,novel_id,chapter_ids,last_job_id FROM planning_conversations"):
        ids = json.loads(raw_ids)
        if (not isinstance(ids, list) or len(ids) > 3 or any(not isinstance(item, str) for item in ids)
                or len(set(ids)) != len(ids) or any(chapters.get(item) != nid for item in ids)):
            raise DomainError("INVALID_DATABASE", "讨论参考不属于同一作品。")
        conversations[cid] = {"novel": nid, "head": head, "ids": ids, "turns": {}}
    for jid, nid, cid, number, task, anchor, raw_context, raw_result in connection.execute(
            "SELECT id,novel_id,conversation_id,conversation_turn,task,chapter_id,context,result FROM jobs "
            "WHERE conversation_id IS NOT NULL OR conversation_turn IS NOT NULL OR task='discuss'"):
        conversation = conversations.get(cid)
        if conversation is None or conversation["novel"] != nid or task != "discuss" or type(number) is not int or number < 1:
            raise DomainError("INVALID_DATABASE", "讨论任务关联无效。")
        context = json.loads(raw_context)
        reference = dto.DiscussionReference.model_validate(context["preview"]["discussion"])
        preview = context["preview"]
        if (reference.conversation_id != cid or len(set(reference.chapter_ids)) != len(reference.chapter_ids)
                or any(chapters.get(item) != nid for item in reference.chapter_ids)
                or preview["novel_id"] != nid or preview["task"] != "discuss"
                or anchor != reference.chapter_ids[0] or preview["chapter_id"] != anchor):
            raise DomainError("INVALID_DATABASE", "讨论任务引用了其他作品。")
        frozen = context["input"]["chapter_outlines"]
        if [item["chapter_id"] for item in frozen] != reference.chapter_ids:
            raise DomainError("INVALID_DATABASE", "讨论参考快照与范围不一致。")
        for item in frozen:
            dto.DiscussionOutline.model_validate(item)
            if type(item["revision"]) is not int or item["revision"] < 0:
                raise DomainError("INVALID_DATABASE", "讨论细纲修订无效。")
        if preview["discussion_outlines"] != frozen:
            raise DomainError("INVALID_DATABASE", "讨论预览与实际参考细纲不一致。")
        validate_snapshot(connection, nid, reference, context)
        result = json.loads(raw_result) if raw_result else None
        if result:
            result = dto.DiscussionResult.model_validate(result).model_dump()
            validate_discussion_result(result, context)
        if number in conversation["turns"]:
            raise DomainError("INVALID_DATABASE", "讨论消息顺序重复。")
        conversation["turns"][number] = (jid, reference.chapter_ids, reference.last_job_id)
    for conversation in conversations.values():
        turns = conversation["turns"]
        if turns:
            if (set(turns) != set(range(1, len(turns) + 1)) or turns[len(turns)][0] != conversation["head"]
                    or turns[len(turns)][1] != conversation["ids"]):
                raise DomainError("INVALID_DATABASE", "讨论消息顺序或最新消息无效。")
            for number in range(1, len(turns) + 1):
                if turns[number][2] != (turns[number - 1][0] if number > 1 else None):
                    raise DomainError("INVALID_DATABASE", "讨论前后消息的关联无效。")
        elif conversation["head"] is not None:
            raise DomainError("INVALID_DATABASE", "讨论的最新消息不存在。")
