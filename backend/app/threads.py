"""Author-owned plans and chronological, evidence-bound foreshadowing progress."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import schemas as dto
from .domain import DomainError, digest, now, resolve_evidence, source_for, uid
from .library import require_chapter, require_novel
from .models import Entity, ThreadProgress, ThreadTrack, Version
from .storage import Workspace


def require_thread(session: Session, novel_id: str, entity_id: str) -> Entity:
    require_novel(session, novel_id)
    entity = session.get(Entity, entity_id)
    if entity is None or entity.novel_id != novel_id or entity.kind != "thread":
        raise DomainError("THREAD_NOT_FOUND", "此作品中没有这条伏笔。", 404)
    return entity


def thread_view(session: Session, entity: Entity, before_position: int | None = None) -> dto.ThreadOut:
    track = session.get(ThreadTrack, entity.id)
    target = require_chapter(session, entity.novel_id, track.target_chapter_id) if track and track.target_chapter_id else None
    progress = []
    for row in session.scalars(select(ThreadProgress).where(ThreadProgress.entity_id == entity.id)).all():
        chapter = require_chapter(session, entity.novel_id, row.chapter_id)
        if before_position is not None and chapter.position >= before_position:
            continue
        version = session.get(Version, row.version_id)
        ordinal = next((p["ordinal"] for p in version.paragraphs if p["paragraph_id"] == row.evidence.get("paragraph_id")), 0) if version else 0
        reason = "已撤销关联" if row.voided else ""
        if not reason and (chapter.review_state != "confirmed" or chapter.accepted_version_id != row.version_id):
            reason = "原文已变更或章节待重新定稿"
        if not reason:
            try:
                sources = [source_for(version, chapter, p) for p in version.paragraphs]
                resolved = resolve_evidence(row.evidence, sources)
                keys = ("novel_id", "chapter_id", "version_id", "paragraph_id", "content_hash", "start_codepoint", "end_codepoint")
                if version.chapter_id != chapter.id or any(row.evidence.get(key) != resolved[key] for key in keys):
                    reason = "原文依据校验失败"
            except (DomainError, AttributeError, TypeError):
                reason = "原文依据校验失败"
        progress.append(dto.ThreadProgressOut(id=row.id, chapter_id=chapter.id, version_id=row.version_id,
            chapter_title=chapter.title, chapter_position=chapter.position, paragraph_ordinal=ordinal, stage=row.stage,
            evidence=row.evidence, note=row.note, voided=row.voided, valid=not reason,
            invalid_reason=reason, created_at=row.created_at))
    progress.sort(key=lambda item: (item.chapter_position, item.paragraph_ordinal, item.created_at, item.id))
    state = "planned"
    for item in progress:
        if not item.valid:
            continue
        allowed = state == "planned" if item.stage == "planted" else state in {"planted", "advanced"}
        if not allowed:
            item.valid = False
            item.invalid_reason = "缺少有效埋设，或此前已经回收"
        else:
            state = item.stage
    if any(not item.valid and not item.voided for item in progress):
        state = "needs_review"
    return dto.ThreadOut(entity=dto.EntityOut.model_validate(entity), revision=track.revision if track else 0,
        target_chapter_id=target.id if target else None, target_chapter_title=target.title if target else None,
        target_position=target.position if target else None, intent=track.intent if track else "",
        paused=track.paused if track else False, status=state, progress=progress)


def _writable(session: Session, entity: Entity, revision: int) -> ThreadTrack:
    track = session.get(ThreadTrack, entity.id)
    if revision != (track.revision if track else 0):
        raise DomainError("THREAD_CONFLICT", "伏笔跟进已在其他窗口更新，输入已保留，请读取最新记录后比较。", 409)
    if track is None:
        track = ThreadTrack(entity_id=entity.id, revision=0, intent="", paused=False)
        session.add(track)
        session.flush()
    return track


def _changed(session: Session, entity: Entity, track: ThreadTrack):
    track.revision += 1
    novel = require_novel(session, entity.novel_id)
    novel.settings_revision += 1
    novel.updated_at = now()
    session.flush()


class ThreadTracking:
    def __init__(self, workspace: Workspace):
        self.ws = workspace

    def list(self, novel_id: str) -> list[dto.ThreadOut]:
        with self.ws.session() as session:
            require_novel(session, novel_id)
            return [thread_view(session, entity) for entity in session.scalars(select(Entity).where(
                Entity.novel_id == novel_id, Entity.kind == "thread").order_by(Entity.updated_at.desc(), Entity.id)).all()]

    def save_plan(self, novel_id: str, entity_id: str, data: dto.ThreadPlanInput) -> dto.ThreadOut:
        with self.ws.session(write=True) as session:
            entity = require_thread(session, novel_id, entity_id)
            if data.target_chapter_id:
                require_chapter(session, novel_id, data.target_chapter_id)
            track = _writable(session, entity, data.base_revision)
            track.target_chapter_id, track.intent, track.paused = data.target_chapter_id, data.intent.strip(), data.paused
            _changed(session, entity, track)
            return thread_view(session, entity)

    def add(self, novel_id: str, entity_id: str, data: dto.ThreadProgressInput) -> dto.ThreadOut:
        with self.ws.session(write=True) as session:
            entity = require_thread(session, novel_id, entity_id)
            request_hash = digest(data.model_dump())
            previous = session.scalar(select(ThreadProgress).where(ThreadProgress.entity_id == entity_id,
                ThreadProgress.operation_id == data.operation_id))
            if previous:
                if previous.request_hash != request_hash:
                    raise DomainError("OPERATION_REUSED", "此保存请求已用于其他内容，请读取最新记录。", 409)
                return thread_view(session, entity)
            track = _writable(session, entity, data.base_revision)
            chapter = require_chapter(session, novel_id, data.chapter_id)
            if chapter.review_state != "confirmed" or chapter.accepted_version_id != data.version_id:
                raise DomainError("THREAD_SOURCE_STALE", "请先将该章节定稿，再关联当前定稿版本的原文。", 409)
            version = session.get(Version, data.version_id)
            if not version or version.chapter_id != chapter.id:
                raise DomainError("THREAD_SOURCE_STALE", "原文版本不属于指定章节。", 409)
            evidence = resolve_evidence(data.evidence.model_dump(), [source_for(version, chapter, p) for p in version.paragraphs])
            valid_before = {item.id for item in thread_view(session, entity).progress if item.valid}
            row = ThreadProgress(id=uid("thread_step"), entity_id=entity.id, chapter_id=chapter.id,
                version_id=version.id, stage=data.stage, evidence=evidence, note=data.note.strip(),
                operation_id=data.operation_id, request_hash=request_hash)
            session.add(row)
            session.flush()
            view = thread_view(session, entity)
            valid_after = {item.id for item in view.progress if item.valid}
            if row.id not in valid_after or not valid_before.issubset(valid_after):
                raise DomainError("THREAD_ORDER", "请先关联更早的埋设，再推进或回收；已回收的伏笔不能重复埋设或继续推进。", 409)
            _changed(session, entity, track)
            return thread_view(session, entity)

    def change(self, novel_id: str, entity_id: str, progress_id: str, data: dto.ThreadProgressChange) -> dto.ThreadOut:
        with self.ws.session(write=True) as session:
            entity = require_thread(session, novel_id, entity_id)
            track = _writable(session, entity, data.base_revision)
            row = session.get(ThreadProgress, progress_id)
            if row is None or row.entity_id != entity_id:
                raise DomainError("THREAD_PROGRESS_NOT_FOUND", "找不到这条跟进记录。", 404)
            valid_before = {item.id for item in thread_view(session, entity).progress if item.valid}
            row.voided = data.voided
            session.flush()
            if not data.voided:
                valid_after = {item.id for item in thread_view(session, entity).progress if item.valid}
                if row.id not in valid_after:
                    raise DomainError("THREAD_SOURCE_STALE", "这条记录的原文或前置进展已失效，请重新关联有效原文。", 409)
                if not valid_before.issubset(valid_after):
                    raise DomainError("THREAD_ORDER", "恢复这条记录会与现有进展冲突，请先核对并撤销需要替换的关联。", 409)
            _changed(session, entity, track)
            return thread_view(session, entity)


def thread_context(session: Session, novel_id: str, chapter_position: int,
                   required_ids: set[str]) -> tuple[list[dto.ThreadGuidance], list[dict]]:
    guidance, sources = [], {}
    entities = session.scalars(select(Entity).join(ThreadTrack, ThreadTrack.entity_id == Entity.id).where(
        Entity.novel_id == novel_id, Entity.kind == "thread", Entity.status == "author", ThreadTrack.paused.is_(False))
        .order_by(Entity.id)).all()
    for entity in entities:
        view = thread_view(session, entity, chapter_position)
        due = view.target_position is not None and view.target_position <= chapter_position and view.status != "resolved"
        if not due and entity.id not in required_ids:
            continue
        valid = [item for item in view.progress if item.valid]
        # Preserve the planting and the latest developments; disclose omitted middle records.
        selected = valid if len(valid) <= 4 else [valid[0], *valid[-3:]]
        guidance.append(dto.ThreadGuidance(entity_id=entity.id, name=entity.name, status=view.status,
            author_plan=view.intent, target_chapter_title=view.target_chapter_title, due=due,
            progress=selected, omitted_records=len(valid) - len(selected)))
        for item in selected:
            version = session.get(Version, item.version_id)
            chapter = require_chapter(session, novel_id, item.chapter_id)
            paragraph = next(p for p in version.paragraphs if p["paragraph_id"] == item.evidence.paragraph_id)
            source = source_for(version, chapter, paragraph)
            sources[source["source_id"]] = {**source, "pinned": True}
    return guidance, list(sources.values())
