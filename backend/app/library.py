"""Author operations: every mutation is a short transaction with explicit version checks."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session

from . import schemas as dto
from .domain import (
    DomainError,
    char_count,
    digest,
    normalize,
    now,
    paragraphs,
    resolve_evidence,
    source_for,
    uid,
    validate_document,
)
from .models import CanonRevision, Chapter, Entity, Fact, Job, Novel, Plan, Version
from .storage import Workspace


def require_novel(session: Session, novel_id: str) -> Novel:
    item = session.get(Novel, novel_id)
    if item is None:
        raise DomainError("NOVEL_NOT_FOUND", "作品不存在。", 404)
    return item


def require_chapter(session: Session, novel_id: str, chapter_id: str) -> Chapter:
    item = session.get(Chapter, chapter_id)
    if item is None or item.novel_id != novel_id:
        raise DomainError("CHAPTER_NOT_FOUND", "此作品中没有该章节。", 404)
    return item


def require_job(session: Session, novel_id: str, job_id: str) -> Job:
    item = session.get(Job, job_id)
    if item is None or item.novel_id != novel_id:
        raise DomainError("JOB_NOT_FOUND", "此作品中没有该任务。", 404)
    return item


def version_out(version: Version) -> dto.VersionOut:
    return dto.VersionOut.model_validate(version)


def chapter_out(session: Session, chapter: Chapter, detail: bool = True):
    version = session.get(Version, chapter.working_version_id)
    values = {name: getattr(chapter, name) for name in dto.ChapterSummary.model_fields
              if name != "char_count"}
    values["char_count"] = version.char_count
    if detail:
        return dto.ChapterOut(**values, version=version_out(version),
                              references=dto.ReferenceSelection.model_validate(chapter.references),
                              references_revision=chapter.references_revision)
    return dto.ChapterSummary(**values)


def novel_out(session: Session, novel: Novel) -> dto.NovelOut:
    chapters = session.scalars(select(Chapter).where(Chapter.novel_id == novel.id)).all()
    total = session.scalar(select(func.coalesce(func.sum(Version.char_count), 0)).where(
        Version.id.in_([c.working_version_id for c in chapters])))
    return dto.NovelOut(**{name: getattr(novel, name) for name in dto.NovelOut.model_fields
                           if name not in {"chapter_count", "accepted_count", "total_chars"}},
                        chapter_count=len(chapters), total_chars=total or 0,
                        accepted_count=sum(c.review_state == "confirmed" for c in chapters))


def new_version(session: Session, chapter: Chapter, body: str, operation_id: str,
                request_hash: str, doc: dict[str, Any] | None = None) -> Version:
    previous = session.get(Version, chapter.working_version_id) if chapter.working_version_id else None
    body = normalize(body)
    document = validate_document(body, doc)
    version = Version(id=uid("version"), chapter_id=chapter.id,
                      parent_id=previous.id if previous else None,
                      operation_id=operation_id, request_hash=request_hash,
                      text=body, editor_doc=document,
                      paragraphs=paragraphs(body, previous.paragraphs if previous else None),
                      content_hash=digest(body), char_count=char_count(body))
    session.add(version)
    session.flush()
    chapter.working_version_id = version.id
    chapter.updated_at = now()
    return version


def mark_dirty(session: Session, novel: Novel, position: int) -> None:
    novel.dirty_from_order = min(novel.dirty_from_order or position, position)
    affected = session.scalars(select(Chapter).where(Chapter.novel_id == novel.id,
                                Chapter.position >= position,
                                Chapter.accepted_version_id.is_not(None))).all()
    ids = [c.id for c in affected]
    for chapter in affected:
        chapter.review_state = "needs_review"
    if ids:
        session.execute(update(Fact).where(Fact.chapter_id.in_(ids)).values(active=False))
        for chapter_id in ids:
            session.execute(text("DELETE FROM story_search WHERE chapter_id = :id"),
                            {"id": chapter_id})
    session.execute(update(Job).where(Job.novel_id == novel.id,
                    Job.candidate_status == "ready").values(candidate_status="needs_rebase"))


class Library:
    def __init__(self, workspace: Workspace):
        self.ws = workspace

    def novels(self, archived: bool = False) -> list[dto.NovelOut]:
        with self.ws.session() as s:
            return [novel_out(s, n) for n in s.scalars(select(Novel).where(
                Novel.archived == archived).order_by(Novel.updated_at.desc())).all()]

    def novel(self, novel_id: str) -> dto.NovelOut:
        with self.ws.session() as s:
            return novel_out(s, require_novel(s, novel_id))

    def create_novel(self, data: dto.NovelInput, is_demo: bool = False) -> dto.NovelOut:
        if not data.title.strip():
            raise DomainError("TITLE_REQUIRED", "请填写作品名。")
        with self.ws.session(write=True) as s:
            novel = Novel(id=uid("novel"), **data.model_dump(), is_demo=is_demo)
            s.add(novel)
            s.flush()
            return novel_out(s, novel)

    def edit_novel(self, novel_id: str, data: dto.NovelPatch) -> dto.NovelOut:
        with self.ws.session(write=True) as s:
            novel = require_novel(s, novel_id)
            values = data.model_dump(exclude_none=True, exclude={"base_settings_revision"})
            if all(getattr(novel, key) == value for key, value in values.items()):
                return novel_out(s, novel)
            if isinstance(data, dto.NovelUpdate) and novel.settings_revision != data.base_settings_revision:
                raise DomainError("NOVEL_CONFLICT", "作品或文风已在其他窗口更新。你的输入已保留，请读取最新作品信息后比较。", 409)
            for key, value in values.items():
                if key == "title" and not value.strip():
                    raise DomainError("TITLE_REQUIRED", "请填写作品名。")
                setattr(novel, key, value)
            if data.title is not None:
                for plan in s.scalars(select(Plan).where(Plan.novel_id == novel_id, Plan.level == "book")).all():
                    if plan.title != novel.title:
                        plan.title, plan.updated_at = novel.title, now()
                    if plan.structure.get("kind") == "blueprint":
                        plan.structure = {**plan.structure, "title": novel.title}
            novel.settings_revision += 1
            novel.updated_at = now()
            s.flush()
            return novel_out(s, novel)

    def chapters(self, novel_id: str) -> list[dto.ChapterSummary]:
        with self.ws.session() as s:
            require_novel(s, novel_id)
            return [chapter_out(s, c, False) for c in s.scalars(select(Chapter).where(
                Chapter.novel_id == novel_id).order_by(Chapter.position)).all()]

    def create_chapter(self, novel_id: str, data: dto.ChapterInput) -> dto.ChapterOut:
        with self.ws.session(write=True) as s:
            novel = require_novel(s, novel_id)
            position = (s.scalar(select(func.max(Chapter.position)).where(
                Chapter.novel_id == novel_id)) or 0) + 1
            chapter = Chapter(id=uid("chapter"), novel_id=novel_id, position=position,
                              working_version_id="", **data.model_dump())
            s.add(chapter)
            s.flush()
            new_version(s, chapter, "", uid("initial"), digest(""))
            novel.updated_at = now()
            s.flush()
            return chapter_out(s, chapter)

    def chapter(self, novel_id: str, chapter_id: str) -> dto.ChapterOut:
        with self.ws.session() as s:
            return chapter_out(s, require_chapter(s, novel_id, chapter_id))

    def edit_chapter(self, novel_id: str, chapter_id: str, data: dto.ChapterPatch):
        with self.ws.session(write=True) as s:
            novel = require_novel(s, novel_id)
            chapter = require_chapter(s, novel_id, chapter_id)
            values = data.model_dump(exclude_none=True, exclude={"base_outline_revision", "base_volume"})
            if not any(getattr(chapter, key) != value for key, value in values.items()):
                return chapter_out(s, chapter)
            if isinstance(data, dto.ChapterUpdate) and (
                    data.base_outline_revision != chapter.outline_revision or data.base_volume != chapter.volume):
                raise DomainError("CHAPTER_CONFLICT", "章节信息或细纲已在其他窗口更新。你的输入已保留，请读取最新内容后比较。", 409)
            from .chapter_outlines import current_document, linked_plan, write_outline
            document = current_document(s, chapter)
            title = data.title if data.title is not None else chapter.title
            if data.goal is not None and data.goal != chapter.goal:
                document = dto.TextOutline(kind="text", title=title, text=data.goal)
            else:
                document = document.model_copy(update={"title": title})
            write_outline(s, chapter, document, chapter.outline_revision, uid("outline_meta"), source="metadata")
            if data.volume is not None:
                chapter.volume = data.volume
                plan = linked_plan(s, chapter)
                if plan:
                    parent = s.scalar(select(Plan).where(Plan.novel_id == novel_id, Plan.level == "volume", Plan.title == data.volume))
                    plan.parent_id = parent.id if parent else None
            chapter.updated_at = now()
            novel.settings_revision += 1
            novel.updated_at = now()
            s.flush()
            return chapter_out(s, chapter)

    def save(self, novel_id: str, chapter_id: str, data: dto.SaveInput) -> dto.VersionOut:
        normalized = normalize(data.text)
        request_hash = digest({"base": data.base_version_id, "text": normalized,
                               "doc": data.editor_doc})
        with self.ws.session(write=True) as s:
            novel = require_novel(s, novel_id)
            chapter = require_chapter(s, novel_id, chapter_id)
            existing = s.scalar(select(Version).where(Version.chapter_id == chapter_id,
                                                     Version.operation_id == data.operation_id))
            if existing:
                if existing.request_hash != request_hash:
                    raise DomainError("IDEMPOTENCY_CONFLICT", "同一次保存请求包含了不同内容。", 409)
                return version_out(existing)
            if chapter.working_version_id != data.base_version_id:
                raise DomainError("VERSION_CONFLICT", "此章已有新版本，请比较后再保存。", 409,
                                  current_version_id=chapter.working_version_id)
            document = validate_document(normalized, data.editor_doc)
            version = new_version(s, chapter, normalized, data.operation_id, request_hash, document)
            novel.updated_at = now()
            if chapter.accepted_version_id:
                mark_dirty(s, novel, chapter.position)
            s.flush()
            return version_out(version)

    def versions(self, novel_id: str, chapter_id: str) -> list[dto.VersionSummary]:
        with self.ws.session() as s:
            require_chapter(s, novel_id, chapter_id)
            return [dto.VersionSummary.model_validate(v) for v in s.scalars(select(Version).where(
                Version.chapter_id == chapter_id).order_by(Version.created_at.desc())).all()]

    def version(self, novel_id: str, chapter_id: str, version_id: str) -> dto.VersionOut:
        with self.ws.session() as s:
            require_chapter(s, novel_id, chapter_id)
            version = s.get(Version, version_id)
            if version is None or version.chapter_id != chapter_id:
                raise DomainError("VERSION_NOT_FOUND", "此章中没有该版本。", 404)
            return version_out(version)

    def entities(self, novel_id: str) -> list[dto.EntityOut]:
        with self.ws.session() as s:
            require_novel(s, novel_id)
            return [dto.EntityOut.model_validate(e) for e in s.scalars(select(Entity).where(
                Entity.novel_id == novel_id).order_by(Entity.updated_at.desc())).all()]

    def put_entity(self, novel_id: str, data: dto.EntityInput, entity_id: str | None = None):
        values = data.model_dump(exclude={"base_updated_at"})
        with self.ws.session(write=True) as s:
            novel = require_novel(s, novel_id)
            entity = s.get(Entity, entity_id) if entity_id else None
            if entity_id and (entity is None or entity.novel_id != novel_id):
                raise DomainError("ENTITY_NOT_FOUND", "此作品中没有该档案。", 404)
            if entity is None:
                entity = Entity(id=uid("entity"), novel_id=novel_id, **values)
                s.add(entity)
            else:
                if isinstance(data, dto.EntityUpdate) and entity.updated_at != data.base_updated_at:
                    if all(getattr(entity, key) == value for key, value in values.items()):
                        return dto.EntityOut.model_validate(entity)
                    raise DomainError("ENTITY_CONFLICT", "档案已在其他窗口更新。你的输入已保留，请读取最新档案后比较。", 409)
                from .models import ThreadTrack
                if data.kind != "thread" and s.get(ThreadTrack, entity.id):
                    raise DomainError("TRACKED_THREAD", "这条伏笔已有跟进安排，请保留伏笔类型或另建其他档案。", 409)
                for key, value in values.items():
                    setattr(entity, key, value)
            entity.updated_at = now()
            novel.settings_revision += 1
            novel.updated_at = now()
            s.flush()
            return dto.EntityOut.model_validate(entity)

    def plans(self, novel_id: str) -> list[dto.PlanOut]:
        with self.ws.session() as s:
            require_novel(s, novel_id)
            return [dto.PlanOut.model_validate(p) for p in s.scalars(select(Plan).where(
                Plan.novel_id == novel_id).order_by(Plan.position)).all()]

    def plan(self, novel_id: str, plan_id: str):
        with self.ws.session() as session:
            plan = session.get(Plan, plan_id)
            if plan is None or plan.novel_id != novel_id:
                raise DomainError("PLAN_NOT_FOUND", "此作品中没有该规划。", 404)
            return dto.PlanOut.model_validate(plan)

    def put_plan(self, novel_id: str, data: dto.PlanInput, plan_id: str | None = None,
                 *, base_updated_at: str | None = None):
        with self.ws.session(write=True) as s:
            novel = require_novel(s, novel_id)
            plan = s.get(Plan, plan_id) if plan_id else None
            if plan_id and (plan is None or plan.novel_id != novel_id):
                raise DomainError("PLAN_NOT_FOUND", "此作品中没有该规划。", 404)
            if plan is None:
                if data.level == "volume" and s.scalar(select(Plan.id).where(
                        Plan.novel_id == novel_id, Plan.level == "volume", Plan.title == data.title)):
                    raise DomainError("DUPLICATE_VOLUME", "分卷名已存在，请使用不同名称。")
                position = (s.scalar(select(func.max(Plan.position)).where(
                    Plan.novel_id == novel_id)) or 0) + 1
                plan = Plan(id=uid("plan"), novel_id=novel_id, position=position, **data.model_dump())
                s.add(plan)
            else:
                if all(getattr(plan, key) == value for key, value in data.model_dump().items()):
                    return dto.PlanOut.model_validate(plan)
                if base_updated_at is not None and base_updated_at != plan.updated_at:
                    raise DomainError("PLAN_CONFLICT", "规划已在其他窗口更新。你的输入已保留，请读取最新内容后比较。", 409)
                if plan.level != data.level:
                    raise DomainError("PLAN_LEVEL_LOCKED", "已有规划的层级不能更改。")
                previous_title = plan.title
                if plan.level == "volume" and previous_title != data.title:
                    if s.scalar(select(Plan.id).where(Plan.novel_id == novel_id, Plan.level == "volume",
                                                     Plan.id != plan.id, Plan.title == data.title)):
                        raise DomainError("DUPLICATE_VOLUME", "分卷名已存在，请使用不同名称。")
                    for chapter in s.scalars(select(Chapter).where(Chapter.novel_id == novel_id,
                                                                  Chapter.volume == previous_title)).all():
                        chapter.volume, chapter.updated_at = data.title, now()
                if plan.structure.get("chapter_id"):
                    chapter = require_chapter(s, novel_id, plan.structure["chapter_id"])
                    from .chapter_outlines import current_document, write_outline
                    document = current_document(s, chapter)
                    document = (dto.TextOutline(kind="text", title=data.title, text=data.body) if data.body != chapter.goal
                        else document.model_copy(update={"title": data.title}))
                    write_outline(s, chapter, document, chapter.outline_revision, uid("outline_plan"), source="legacy")
                elif plan.level == "book" and plan.body != data.body:
                    plan.structure = {"kind": "author_book"}
                elif plan.level == "volume" and plan.body != data.body:
                    plan.structure = {"planned_chapters": plan.structure.get("planned_chapters", 30)}
                for key, value in data.model_dump().items():
                    setattr(plan, key, value)
            plan.updated_at = now()
            novel.settings_revision += 1
            novel.updated_at = now()
            s.flush()
            return dto.PlanOut.model_validate(plan)

    def facts(self, novel_id: str, include_inactive: bool = False) -> list[dto.FactOut]:
        with self.ws.session() as s:
            require_novel(s, novel_id)
            query = select(Fact).where(Fact.novel_id == novel_id)
            if not include_inactive:
                query = query.where(Fact.active.is_(True))
            return [dto.FactOut.model_validate(f) for f in s.scalars(query.order_by(
                Fact.created_at.desc())).all()]

    def confirm(self, novel_id: str, chapter_id: str, data: dto.CanonInput) -> dto.CanonOut:
        request_hash = digest({"chapter": chapter_id, **data.model_dump()})
        with self.ws.session(write=True) as s:
            novel = require_novel(s, novel_id)
            chapter = require_chapter(s, novel_id, chapter_id)
            previous = s.scalar(select(CanonRevision).where(
                CanonRevision.operation_id == data.operation_id))
            if previous:
                if previous.novel_id != novel_id or previous.request_hash != request_hash:
                    raise DomainError("IDEMPOTENCY_CONFLICT", "同一次正史确认包含了不同内容。", 409)
                return dto.CanonOut(revision=previous.revision, confirmed_chapter_id=chapter_id,
                                    dirty_from_order=novel.dirty_from_order,
                                    fact_count=len(previous.changes))
            if chapter.working_version_id != data.version_id:
                raise DomainError("VERSION_CONFLICT", "正文已更新，请重新审阅正史变更。", 409)
            before = s.scalars(select(Chapter).where(Chapter.novel_id == novel_id,
                                Chapter.position < chapter.position).order_by(Chapter.position)).all()
            if any(c.review_state != "confirmed" for c in before):
                raise DomainError("CANON_GAP", "请先复核并确认前面的章节，保持正史顺序清楚。", 409)
            version = s.get(Version, data.version_id)
            if not version.text.strip():
                raise DomainError("EMPTY_CHAPTER", "空白章节不能确认为正史。")
            sources = [source_for(version, chapter, p) for p in version.paragraphs]
            for source in sources:
                source["kind"] = "canon"
            entity_ids = set(s.scalars(select(Entity.id).where(Entity.novel_id == novel_id,
                                                              Entity.kind == "character")).all())
            changes = []
            for proposed in data.changes:
                if any(k not in entity_ids for k in proposed.known_by):
                    raise DomainError("UNKNOWN_CHARACTER", "人物知识记录引用了不属于本书的人物。")
                resolved = {**proposed.model_dump(), "evidence": [resolve_evidence(e.model_dump(), sources)
                            for e in proposed.evidence]}
                changes.append(resolved)
            if chapter.accepted_version_id and chapter.review_state == "confirmed":
                mark_dirty(s, novel, chapter.position)
            s.execute(update(Fact).where(Fact.chapter_id == chapter_id).values(active=False))
            novel.canon_revision += 1
            for change in changes:
                s.add(Fact(id=uid("fact"), novel_id=novel_id, chapter_id=chapter_id,
                           version_id=version.id, canon_revision=novel.canon_revision,
                           active=True, **change))
            chapter.accepted_version_id = version.id
            chapter.review_state = "confirmed"
            novel.updated_at = now()
            s.flush()
            pending = s.scalar(select(func.min(Chapter.position)).where(
                Chapter.novel_id == novel_id, Chapter.review_state == "needs_review"))
            novel.dirty_from_order = pending
            confirmed = s.scalars(select(Chapter).where(Chapter.novel_id == novel_id,
                                                       Chapter.review_state == "confirmed")).all()
            s.add(CanonRevision(id=uid("canon"), novel_id=novel_id, revision=novel.canon_revision,
                  operation_id=data.operation_id, request_hash=request_hash,
                  accepted_mapping={c.id: c.accepted_version_id for c in confirmed}, changes=changes))
            s.execute(text("DELETE FROM story_search WHERE chapter_id = :id"), {"id": chapter.id})
            for source in sources:
                s.execute(text("INSERT INTO story_search (novel_id,chapter_id,version_id,paragraph_id,body) "
                               "VALUES (:novel_id,:chapter_id,:version_id,:paragraph_id,:body)"),
                          {**source, "body": source["text"]})
            s.flush()
            return dto.CanonOut(revision=novel.canon_revision, confirmed_chapter_id=chapter.id,
                                dirty_from_order=pending, fact_count=len(changes))

    def search(self, novel_id: str, query: str, limit: int = 30) -> list[dto.SearchResult]:
        query = query.strip()
        if not query:
            return []
        with self.ws.session() as s:
            require_novel(s, novel_id)
            hits: list[tuple[str, str]] = []
            terms = [query]
            for entity in s.scalars(select(Entity).where(Entity.novel_id == novel_id,
                                                         Entity.status == "author")).all():
                if query.casefold() in {name.casefold() for name in [entity.name, *entity.aliases]}:
                    terms.extend([entity.name, *entity.aliases])
            for term in list(dict.fromkeys(terms))[:50]:
                term_hits = []
                if len(term) >= 3:
                    phrase = '"' + term.replace('"', '""') + '"'
                    rows = s.execute(text("SELECT version_id,paragraph_id FROM story_search "
                                          "WHERE story_search MATCH :q AND novel_id=:nid "
                                          "ORDER BY bm25(story_search) LIMIT :lim"),
                                     {"q": phrase, "nid": novel_id, "lim": limit}).all()
                    term_hits = [(r[0], r[1]) for r in rows]
                if not term_hits:
                    # FTS5 trigram cannot match one/two-character terms. Bound scope first.
                    rows = s.execute(text("SELECT version_id,paragraph_id FROM story_search "
                                          "WHERE novel_id=:nid AND instr(lower(body),lower(:q))>0 "
                                          "LIMIT :lim"), {"q": term, "nid": novel_id, "lim": limit}).all()
                    term_hits = [(r[0], r[1]) for r in rows]
                hits.extend(hit for hit in term_hits if hit not in hits)
                if len(hits) >= limit:
                    break
            hits = hits[:limit]
            match_kind = "名称与别名匹配" if len(terms) > 1 else "原文字面匹配"
            result = []
            for version_id, paragraph_id in hits:
                version = s.get(Version, version_id)
                chapter = s.get(Chapter, version.chapter_id) if version else None
                if not chapter or chapter.novel_id != novel_id or chapter.review_state != "confirmed":
                    continue
                if chapter.accepted_version_id != version_id:
                    continue
                paragraph = next((p for p in version.paragraphs if p["paragraph_id"] == paragraph_id), None)
                if paragraph:
                    result.append(dto.SearchResult(source=dto.Source(**source_for(version, chapter, paragraph)),
                                                   match_kind=match_kind))
            return result

    def export(self, novel_id: str, confirmed: bool = False, markdown: bool = True) -> str:
        with self.ws.session() as s:
            novel = require_novel(s, novel_id)
            parts = [("# " if markdown else "") + novel.title]
            chapters = s.scalars(select(Chapter).where(Chapter.novel_id == novel_id).order_by(
                Chapter.position)).all()
            for chapter in chapters:
                version_id = chapter.accepted_version_id if confirmed else chapter.working_version_id
                if confirmed and chapter.review_state != "confirmed":
                    continue
                if not version_id:
                    continue
                version = s.get(Version, version_id)
                if not version.text.strip():
                    continue
                parts.extend([("## " if markdown else "") + chapter.title, version.text])
            return "\n\n".join(parts) + "\n"

    def export_chapters(self, novel_id: str, confirmed: bool = True) -> bytes:
        import io
        import re
        import zipfile
        buffer = io.BytesIO()
        with self.ws.session() as s, zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            require_novel(s, novel_id)
            chapters = s.scalars(select(Chapter).where(Chapter.novel_id == novel_id).order_by(
                Chapter.position)).all()
            for chapter in chapters:
                if confirmed and chapter.review_state != "confirmed":
                    continue
                version_id = chapter.accepted_version_id if confirmed else chapter.working_version_id
                version = s.get(Version, version_id) if version_id else None
                if version is None or not version.text.strip():
                    continue
                title = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", chapter.title).strip(" .")[:90] or "章节"
                filename = f"{chapter.position:04d}_{title}.txt"
                archive.writestr(filename, chapter.title + "\n\n" + version.text + "\n")
            if not archive.namelist():
                raise DomainError("NO_EXPORT_CHAPTERS", "所选范围没有可导出的正文。请先写作或定稿章节。")
        return buffer.getvalue()

    def import_manuscript(self, data: dto.ImportInput) -> dto.NovelOut:
        # The full import is atomic; partial books are not left after a failed chapter.
        with self.ws.session(write=True) as s:
            novel = Novel(id=uid("novel"), title=data.title)
            s.add(novel)
            s.flush()
            for position, imported in enumerate(data.chapters, 1):
                chapter = Chapter(id=uid("chapter"), novel_id=novel.id, position=position,
                                  title=imported.title, volume="第一卷", working_version_id="")
                s.add(chapter)
                s.flush()
                new_version(s, chapter, imported.text, uid("import"), digest(imported.text))
            s.flush()
            return novel_out(s, novel)
