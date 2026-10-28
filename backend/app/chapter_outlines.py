"""One chapter outline, immutable revisions, and deterministic candidate adoption."""
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select

from . import schemas as dto
from .domain import DomainError, digest, now, uid
from .library import require_chapter, require_job, require_novel
from .models import OutlineRevision, Plan

DOCUMENT = TypeAdapter(dto.OutlineDocument)
STRUCTURED_FIELDS = ("goal", "conflict", "beats", "ending_hook")


def render_document(document) -> str:
    if document.kind == "text":
        return document.text
    if not any((document.goal, document.conflict, document.beats, document.ending_hook)):
        return ""
    return document.goal + "\n冲突：" + document.conflict + "\n情节：\n" + "\n".join(document.beats) + "\n章末：" + document.ending_hook


def linked_plan(session, chapter):
    rows = session.scalars(select(Plan).where(Plan.novel_id == chapter.novel_id, Plan.level == "chapter",
        Plan.structure["chapter_id"].as_string() == chapter.id).limit(2)).all()
    if len(rows) > 1:
        raise DomainError("OUTLINE_LINK_CONFLICT", "本章关联了多个细纲，请先核对规划记录。", 409)
    return rows[0] if rows else None


def current_document(session, chapter):
    plan = linked_plan(session, chapter)
    return stored_document(chapter.title, chapter.goal, plan.structure if plan else {})


def stored_document(title, body, structure):
    if structure.get("kind") == "author_chapter":
        return dto.TextOutline(kind="text", title=title, text=body)
    if structure.get("kind") == "chapter_outline":
        try:
            value = dto.StructuredOutline(kind="structured", title=title, **{k: structure[k] for k in STRUCTURED_FIELDS})
            if render_document(value) == body:
                return value
        except (KeyError, ValidationError):
            pass  # Legacy free text remains intact; never guess a field split.
    if not body:
        return dto.StructuredOutline(kind="structured", title=title)
    return dto.TextOutline(kind="text", title=title, text=body)


def state(session, novel_id, chapter_id):
    chapter = require_chapter(session, novel_id, chapter_id)
    return dto.OutlineState(chapter_id=chapter.id, revision=chapter.outline_revision,
        document=current_document(session, chapter))


def _row(chapter, document, revision, operation_id, request_hash, source):
    values = document.model_dump()
    return OutlineRevision(id=uid("outline"), novel_id=chapter.novel_id, chapter_id=chapter.id,
        revision=revision, title=document.title, document=values, content_hash=digest(values),
        operation_id=operation_id, request_hash=request_hash, source=source)


def write_outline(session, chapter, document, base_revision, operation_id, *, source="manual"):
    request_hash = digest({"base": base_revision, "document": document.model_dump(), "source": source})
    previous = session.scalar(select(OutlineRevision).where(OutlineRevision.chapter_id == chapter.id,
        OutlineRevision.operation_id == operation_id))
    if previous:
        if previous.request_hash != request_hash:
            raise DomainError("IDEMPOTENCY_CONFLICT", "同一次细纲操作包含了不同内容。", 409)
        return state(session, chapter.novel_id, chapter.id).model_copy(update={"operation_revision": previous.revision})
    if base_revision != chapter.outline_revision:
        raise DomainError("OUTLINE_CONFLICT", "细纲已在其他窗口更新。你的输入已保留，请读取最新细纲后比较。", 409)
    current = current_document(session, chapter)
    if document == current:
        return dto.OutlineState(chapter_id=chapter.id, revision=chapter.outline_revision, document=current)
    if not document.title.strip():
        raise DomainError("OUTLINE_TITLE_REQUIRED", "请填写章节标题。")
    if chapter.outline_revision == 0:
        session.add(_row(chapter, current, 0, uid("initial"), digest(current.model_dump()), "initial"))
    plan = linked_plan(session, chapter)
    if plan is None:
        parent = session.scalar(select(Plan).where(Plan.novel_id == chapter.novel_id,
            Plan.level == "volume", Plan.title == chapter.volume))
        plan = Plan(id=uid("plan"), novel_id=chapter.novel_id, level="chapter", position=chapter.position,
            title=chapter.title, parent_id=parent.id if parent else None)
        session.add(plan)
    chapter.title, chapter.goal = document.title, render_document(document)
    chapter.outline_revision += 1
    chapter.updated_at = now()
    plan.title, plan.body, plan.updated_at = chapter.title, chapter.goal, now()
    plan.structure = {"kind": "chapter_outline" if document.kind == "structured" else "author_chapter",
        "chapter_id": chapter.id, "number": chapter.position,
        **(document.model_dump(exclude={"kind"}) if document.kind == "structured" else {})}
    session.add(_row(chapter, document, chapter.outline_revision, operation_id, request_hash, source))
    session.flush()
    return dto.OutlineState(chapter_id=chapter.id, revision=chapter.outline_revision,
        document=document, operation_revision=chapter.outline_revision)


def changed_settings(novel):
    novel.settings_revision += 1
    novel.updated_at = now()


class ChapterOutlines:
    def __init__(self, workspace):
        self.ws = workspace

    def get(self, novel_id, chapter_id):
        with self.ws.session() as session:
            return state(session, novel_id, chapter_id)

    def save(self, novel_id, chapter_id, data: dto.OutlineUpdate):
        with self.ws.session(write=True) as session:
            chapter = require_chapter(session, novel_id, chapter_id)
            before = chapter.outline_revision
            result = write_outline(session, chapter, data.document, data.base_revision, data.operation_id)
            if chapter.outline_revision != before:
                changed_settings(require_novel(session, novel_id))
            return result

    def history(self, novel_id, chapter_id, before=None):
        with self.ws.session() as session:
            chapter = require_chapter(session, novel_id, chapter_id)
            query = select(OutlineRevision.revision, OutlineRevision.title, OutlineRevision.source,
                OutlineRevision.created_at).where(OutlineRevision.chapter_id == chapter.id)
            if before is not None:
                query = query.where(OutlineRevision.revision < before)
            rows = session.execute(query.order_by(OutlineRevision.revision.desc()).limit(31)).mappings().all()
            if not rows and before is None and chapter.outline_revision == 0:
                rows = [{"revision": 0, "title": chapter.title, "source": "initial", "created_at": chapter.updated_at}]
            return dto.OutlineHistoryPage(items=[dto.OutlineHistoryItem(**r) for r in rows[:30]],
                next_before=rows[29]["revision"] if len(rows) > 30 else None)

    def revision(self, novel_id, chapter_id, revision):
        with self.ws.session() as session:
            chapter = require_chapter(session, novel_id, chapter_id)
            if revision == 0 and chapter.outline_revision == 0:
                return dto.OutlineRevisionOut(revision=0, title=chapter.title, source="initial",
                    created_at=chapter.updated_at, document=current_document(session, chapter))
            row = session.scalar(select(OutlineRevision).where(OutlineRevision.chapter_id == chapter.id,
                OutlineRevision.revision == revision))
            if row is None:
                raise DomainError("OUTLINE_REVISION_NOT_FOUND", "此章节中没有该细纲版本。", 404)
            return dto.OutlineRevisionOut.model_validate(row)

    def restore(self, novel_id, chapter_id, revision, data: dto.OutlineRestoreInput):
        with self.ws.session(write=True) as session:
            chapter = require_chapter(session, novel_id, chapter_id)
            row = session.scalar(select(OutlineRevision).where(OutlineRevision.chapter_id == chapter.id,
                OutlineRevision.revision == revision))
            if row is None:
                raise DomainError("OUTLINE_REVISION_NOT_FOUND", "此章节中没有该细纲版本。", 404)
            before = chapter.outline_revision
            result = write_outline(session, chapter, DOCUMENT.validate_python(row.document), data.base_revision,
                data.operation_id, source="restore:" + str(revision))
            if chapter.outline_revision != before:
                changed_settings(require_novel(session, novel_id))
            return result

    def adopt(self, novel_id, job_id, data: dto.OutlineApplyInput):
        from .context import context_current
        with self.ws.session(write=True) as session:
            job = require_job(session, novel_id, job_id)
            signature = digest(data.model_dump())
            applied = job.context.get("outline_applied")
            if applied:
                if applied["signature"] != signature:
                    raise DomainError("IDEMPOTENCY_CONFLICT", "已采纳的细纲建议不能换一组字段再次覆盖。", 409)
                return state(session, novel_id, job.chapter_id).model_copy(update={
                    "operation_revision": applied["state"]["revision"]})
            if job.task != "outline_edit" or job.state != "succeeded" or not job.result or job.candidate_status != "ready":
                raise DomainError("OUTLINE_CANDIDATE_NOT_READY", "这份细纲建议尚不可采纳。", 409)
            if not context_current(session, job):
                raise DomainError("CONTEXT_STALE", "原稿、设定或细纲已更新，请重新生成建议。", 409)
            frozen = job.context["input"]["outline_edit"]
            selected = set(data.fields)
            if not selected or not selected <= set(frozen["fields"]):
                raise DomainError("OUTLINE_FIELDS_INVALID", "只能采纳本次允许修改的字段。")
            original = DOCUMENT.validate_python(frozen["document"])
            candidate = dto.OutlineEditResult.model_validate(job.result).document
            validate_edit_result(job.result, job.context)
            document = original.model_copy(update={k: getattr(candidate, k) for k in selected})
            chapter = require_chapter(session, novel_id, job.chapter_id)
            before = chapter.outline_revision
            result = write_outline(session, chapter, document, data.base_revision, data.operation_id, source="ai:" + job.id)
            if chapter.outline_revision != before:
                changed_settings(require_novel(session, novel_id))
            job.context = {**job.context, "outline_applied": {"signature": signature, "state": result.model_dump()}}
            job.candidate_status = "adopted"
            job.updated_at = now()
            return result


def edit_guidance(session, novel_id, request):
    if request.task != "outline_edit":
        if request.outline_edit:
            raise DomainError("OUTLINE_TASK_MISMATCH", "细纲修改范围只能用于细纲任务。")
        return None
    if request.outline_edit is None:
        raise DomainError("OUTLINE_REFERENCE_REQUIRED", "请指定要修改的细纲与字段。")
    current = state(session, novel_id, request.chapter_id)
    if current.revision != request.outline_edit.base_revision:
        raise DomainError("OUTLINE_CONFLICT", "细纲已更新，请先读取最新细纲。", 409)
    fields = set(request.outline_edit.fields)
    allowed = set(STRUCTURED_FIELDS) if current.document.kind == "structured" else {"text"}
    if not fields <= allowed:
        raise DomainError("OUTLINE_FIELDS_INVALID", "所选字段不属于当前细纲格式。")
    return {"base_revision": current.revision, "fields": sorted(fields), "document": current.document.model_dump()}


def validate_edit_result(result, context):
    frozen = context["input"]["outline_edit"]
    original = frozen["document"]
    document = result["document"]
    if original.keys() != document.keys() or any(document[k] != value for k, value in original.items() if k not in frozen["fields"]):
        raise DomainError("OUTLINE_SCOPE_CHANGED", "模型修改了未授权字段，建议已保留但不可采纳。")
