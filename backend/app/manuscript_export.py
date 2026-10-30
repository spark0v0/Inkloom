"""Read-only manuscript snapshots shared by preview and every export format."""

from __future__ import annotations

import io
import re
import zipfile

from sqlalchemy import and_, case, select

from . import schemas as dto
from .domain import DomainError, digest
from .models import Chapter, Novel, Version
from .storage import Workspace


def _snapshot(ws: Workspace, novel_id: str, confirmed: bool, start_position: int | None,
              end_position: int | None, *, with_text: bool = False):
    if ((start_position is not None and not 1 <= start_position <= 2147483647)
            or (end_position is not None and not 1 <= end_position <= 2147483647)
            or (start_position is not None and end_position is not None
                and start_position > end_position)):
        raise DomainError("INVALID_EXPORT_RANGE", "起始章不能大于结束章，章序须为正整数。")
    chapter_scope = [Chapter.novel_id == Novel.id]
    if start_position is not None:
        chapter_scope.append(Chapter.position >= start_position)
    if end_position is not None:
        chapter_scope.append(Chapter.position <= end_position)
    chosen_version = (case((Chapter.review_state == "confirmed", Chapter.accepted_version_id),
                           else_=Chapter.working_version_id) if confirmed else Chapter.working_version_id)
    columns = [Novel.title.label("novel_title"), Chapter.id, Chapter.title, Chapter.volume,
               Chapter.position, Chapter.review_state, Version.id.label("version_id"),
               Version.content_hash, Version.char_count]
    if with_text:
        text_scope = [Version.char_count > 0]
        if confirmed:
            text_scope.append(Chapter.review_state == "confirmed")
        columns.append(case((and_(*text_scope), Version.text), else_=None).label("text"))
    # One statement binds the book, directory, version metadata and (when requested) prose.
    # Outer joins preserve an existing book even when the selected range is empty.
    query = (select(*columns).select_from(Novel)
             .outerjoin(Chapter, and_(*chapter_scope))
             .outerjoin(Version, and_(Version.id == chosen_version, Version.chapter_id == Chapter.id))
             .where(Novel.id == novel_id).order_by(Chapter.position))
    with ws.session() as session:
        records = session.execute(query).mappings().all()
    if not records:
        raise DomainError("NOVEL_NOT_FOUND", "作品不存在。", 404)
    title = records[0]["novel_title"]
    chapters, versions, texts = [], [], []
    for row in records:
        if row["id"] is None:
            continue
        reason = None
        if not row["version_id"] or not row["char_count"]:
            reason = "empty"
        elif confirmed and row["review_state"] == "needs_review":
            reason = "needs_review"
        elif confirmed and row["review_state"] != "confirmed":
            reason = "unconfirmed"
        chapter = dto.ExportChapterOut(
            id=row["id"], title=row["title"], volume=row["volume"], position=row["position"],
            review_state=row["review_state"], char_count=row["char_count"] or 0,
            included=reason is None, excluded_reason=reason)
        chapters.append(chapter)
        versions.append([row["version_id"], row["content_hash"]])
        if with_text and chapter.included:
            texts.append((chapter, row["text"]))
    fingerprint = digest({"contract": "serial-export-v1", "novel_id": novel_id, "title": title,
                          "confirmed": confirmed, "start": start_position, "end": end_position,
                          "chapters": [chapter.model_dump() for chapter in chapters],
                          "versions": versions})
    included = [chapter for chapter in chapters if chapter.included]
    return dto.ExportPreviewOut(
        novel_id=novel_id, title=title, confirmed=confirmed, start_position=start_position,
        end_position=end_position, fingerprint=fingerprint, chapters=chapters,
        included_count=len(included), skipped_count=len(chapters) - len(included),
        total_chars=sum(chapter.char_count for chapter in included)), texts


def preview_export(ws: Workspace, novel_id: str, confirmed: bool = True,
                   start_position: int | None = None,
                   end_position: int | None = None) -> dto.ExportPreviewOut:
    return _snapshot(ws, novel_id, confirmed, start_position, end_position)[0]


def _export_snapshot(ws: Workspace, novel_id: str, confirmed: bool,
                     start_position: int | None, end_position: int | None,
                     expected_fingerprint: str | None):
    preview, chapters = _snapshot(ws, novel_id, confirmed, start_position, end_position, with_text=True)
    if expected_fingerprint is not None and expected_fingerprint != preview.fingerprint:
        raise DomainError("EXPORT_CHANGED", "稿件已变更，请刷新导出预览后再次下载。", 409)
    if not chapters:
        raise DomainError("NO_EXPORT_CHAPTERS", "所选范围没有可导出的正文。请先写作或定稿章节。")
    return preview, chapters


def export_text(ws: Workspace, novel_id: str, confirmed: bool, markdown: bool,
                start_position: int | None = None, end_position: int | None = None,
                expected_fingerprint: str | None = None) -> str:
    preview, chapters = _export_snapshot(
        ws, novel_id, confirmed, start_position, end_position, expected_fingerprint)
    parts = [("# " if markdown else "") + preview.title]
    for chapter, prose in chapters:
        parts.extend([("## " if markdown else "") + chapter.title, prose])
    return "\n\n".join(parts) + "\n"


def export_archive(ws: Workspace, novel_id: str, confirmed: bool,
                   start_position: int | None = None, end_position: int | None = None,
                   expected_fingerprint: str | None = None) -> bytes:
    _, chapters = _export_snapshot(
        ws, novel_id, confirmed, start_position, end_position, expected_fingerprint)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for chapter, prose in chapters:
            title = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", chapter.title).strip(" .")[:90] or "章节"
            filename = f"{chapter.position:04d}_{title}.txt"
            archive.writestr(filename, chapter.title + "\n\n" + prose + "\n")
    return buffer.getvalue()
