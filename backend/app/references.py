"""Resolve explicit chapter context; reference material never becomes canon."""
from sqlalchemy import update
from sqlalchemy.orm import Session

from . import schemas as dto
from .domain import DomainError, now, source_for
from .library import require_chapter, require_novel
from .models import Chapter, Entity, Job, Version
from .storage import Workspace


def resolve_references(session: Session, chapter: Chapter, selection: dto.ReferenceSelection):
    entities = []
    for entity_id in selection.entity_ids:
        entity = session.get(Entity, entity_id)
        if entity is None or entity.novel_id != chapter.novel_id:
            raise DomainError("REFERENCE_NOT_FOUND", "所选设定不属于本书，请移除或重新选择。", 404)
        if entity.status != "author":
            raise DomainError("REFERENCE_STALE", f"《{entity.name}》尚未确认为作者设定，请先确认或移除。", 409)
        entities.append(entity)
    sources = []
    for pin in selection.chapters:
        prior = session.get(Chapter, pin.chapter_id)
        if prior is None or prior.novel_id != chapter.novel_id:
            raise DomainError("REFERENCE_NOT_FOUND", "所选章节不属于本书，请移除或重新选择。", 404)
        if prior.position >= chapter.position:
            raise DomainError("REFERENCE_ORDER", "前文参考只能使用当前章之前的定稿章节。")
        if prior.review_state != "confirmed" or prior.accepted_version_id != pin.version_id:
            raise DomainError("REFERENCE_STALE", f"《{prior.title}》已修改，请重新确认本章参考或移除。", 409)
        version = session.get(Version, pin.version_id)
        if version is None or version.chapter_id != prior.id:
            raise DomainError("REFERENCE_STALE", "前文参考版本无效，请重新选择。", 409)
        sources.extend({**source_for(version, prior, paragraph), "pinned": True} for paragraph in version.paragraphs)
    return entities, sources


def reference_state(chapter: Chapter) -> dto.ReferenceState:
    return dto.ReferenceState(chapter_id=chapter.id, revision=chapter.references_revision,
                              selection=dto.ReferenceSelection.model_validate(chapter.references))


class ChapterReferences:
    def __init__(self, workspace: Workspace):
        self.ws = workspace

    def get(self, novel_id: str, chapter_id: str) -> dto.ReferenceState:
        with self.ws.session() as session:
            return reference_state(require_chapter(session, novel_id, chapter_id))

    def save(self, novel_id: str, chapter_id: str, data: dto.ReferenceUpdate) -> dto.ReferenceState:
        with self.ws.session(write=True) as session:
            novel = require_novel(session, novel_id)
            chapter = require_chapter(session, novel_id, chapter_id)
            current = reference_state(chapter)
            # Replaying an accepted write is safe; a newer, different edit is not.
            if current.selection == data.selection and current.revision >= data.base_revision:
                return current
            if current.revision != data.base_revision:
                raise DomainError("REFERENCE_CONFLICT", "本章参考已在其他窗口更新。当前选择已保留，请比较后重新载入。", 409,
                                  current_revision=current.revision)
            resolve_references(session, chapter, data.selection)
            chapter.references = data.selection.model_dump()
            chapter.references_revision += 1
            chapter.updated_at = novel.updated_at = now()
            session.execute(update(Job).where(Job.novel_id == novel_id, Job.chapter_id == chapter_id,
                Job.candidate_status == "ready").values(candidate_status="needs_rebase"))
            session.flush()
            return reference_state(chapter)


def validate_restored_references(connection, *, required: bool = False) -> None:
    """Validate ownership even when a legitimate saved pin has become stale."""
    columns = {row[1] for row in connection.execute("PRAGMA table_info(chapters)")}
    reference_columns = {"references", "references_revision"}
    if not reference_columns.issubset(columns):
        if required or reference_columns & columns:
            raise DomainError("INVALID_DATABASE", "备份缺少本章参考字段，原工作区未改变。")
        # Supported pre-feature backups are migrated only after validation.
        return
    import json
    for _chapter_id, novel_id, position, revision, raw in connection.execute(
            'SELECT id,novel_id,position,references_revision,"references" FROM chapters').fetchall():
        selection = dto.ReferenceSelection.model_validate(json.loads(raw))
        if not isinstance(revision, int) or revision < 0:
            raise DomainError("INVALID_DATABASE", "本章参考修订无效。")
        for entity_id in selection.entity_ids:
            if not connection.execute("SELECT 1 FROM entities WHERE id=? AND novel_id=?", (entity_id, novel_id)).fetchone():
                raise DomainError("INVALID_DATABASE", "本章参考设定不属于本书。")
        for pin in selection.chapters:
            if not connection.execute("SELECT 1 FROM chapters c JOIN versions v ON v.chapter_id=c.id "
                    "WHERE c.id=? AND c.novel_id=? AND c.position<? AND v.id=?",
                    (pin.chapter_id, novel_id, position, pin.version_id)).fetchone():
                raise DomainError("INVALID_DATABASE", "本章参考章节版本或作品归属无效。")
