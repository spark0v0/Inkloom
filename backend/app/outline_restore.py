"""Validate immutable outline history before activating an uploaded workspace."""
import json

from .chapter_outlines import DOCUMENT, render_document, stored_document
from .domain import DomainError, digest


def validate_restored_outlines(connection, *, required):
    columns = {r[1] for r in connection.execute("PRAGMA table_info(chapters)")}
    table = connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='outline_revisions'").fetchone()
    if not required:
        if "outline_revision" in columns or table:
            raise DomainError("INVALID_DATABASE", "备份细纲结构与声明的迁移版本不符。")
        return
    if "outline_revision" not in columns or not table:
        raise DomainError("INVALID_DATABASE", "备份缺少细纲修订或历史表。")
    chapters = {r[0]: r for r in connection.execute("SELECT id,novel_id,title,goal,outline_revision FROM chapters")}
    structures = {}
    for novel_id, raw in connection.execute("SELECT novel_id,structure FROM plans WHERE level='chapter'"):
        structure = json.loads(raw)
        if not isinstance(structure, dict):
            raise DomainError("INVALID_DATABASE", "细纲结构必须是对象。")
        chapter_id = structure.get("chapter_id")
        if chapter_id:
            if chapter_id not in chapters or chapters[chapter_id][1] != novel_id or chapter_id in structures:
                raise DomainError("INVALID_DATABASE", "章节细纲关联归属无效或重复。")
            structures[chapter_id] = structure
    histories = {}
    for novel_id, chapter_id, revision, title, raw, content_hash in connection.execute(
            "SELECT novel_id,chapter_id,revision,title,document,content_hash FROM outline_revisions"):
        document = DOCUMENT.validate_python(json.loads(raw))
        if (chapter_id not in chapters or chapters[chapter_id][1] != novel_id or document.title != title
                or digest(document.model_dump()) != content_hash or type(revision) is not int or revision < 0):
            raise DomainError("INVALID_DATABASE", "细纲历史归属、字段或内容哈希无效。")
        history = histories.setdefault(chapter_id, {})
        if revision in history:
            raise DomainError("INVALID_DATABASE", "细纲历史修订号重复。")
        history[revision] = document
    for chapter_id, (_id, _novel_id, title, body, revision) in chapters.items():
        history = histories.get(chapter_id, {})
        if type(revision) is not int or revision < 0 or (revision == 0 and history):
            raise DomainError("INVALID_DATABASE", "细纲修订号无效。")
        if revision:
            if len(history) != revision + 1 or sorted(history) != list(range(revision + 1)):
                raise DomainError("INVALID_DATABASE", "细纲历史不连续。")
            current = stored_document(title, body, structures.get(chapter_id, {}))
            if history[revision] != current or render_document(history[revision]) != body:
                raise DomainError("INVALID_DATABASE", "当前细纲与历史投影不一致。")
