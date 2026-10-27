"""Author preferences are separate from story facts and stylistic reference text."""
import json

from . import schemas as dto
from .domain import DomainError, now
from .library import novel_out, require_novel
from .storage import Workspace


def save_writing_style(workspace: Workspace, novel_id: str, data: dto.WritingStyleInput) -> dto.NovelOut:
    preferences = data.preferences.model_copy(update={
        "avoid": data.preferences.avoid.strip(), "example": data.preferences.example.strip()})
    style = data.style.strip()
    with workspace.session(write=True) as session:
        novel = require_novel(session, novel_id)
        current = dto.WritingPreferences.model_validate(novel.writing_preferences)
        if novel.style == style and current == preferences:
            return novel_out(session, novel)
        if novel.settings_revision != data.base_settings_revision:
            raise DomainError("WRITING_STYLE_CONFLICT", "作品或文风已在其他窗口更新。你的输入已保留，请读取最新风格后比较。", 409)
        novel.style = style
        novel.writing_preferences = preferences.model_dump()
        novel.settings_revision += 1
        novel.updated_at = now()
        session.flush()
        return novel_out(session, novel)


def validate_restored_writing_preferences(connection, *, required: bool):
    columns = {row[1] for row in connection.execute("PRAGMA table_info(novels)")}
    if "writing_preferences" not in columns:
        if required:
            raise DomainError("INVALID_DATABASE", "备份缺少作品写作风格字段。")
        return
    for (raw,) in connection.execute("SELECT writing_preferences FROM novels"):
        dto.WritingPreferences.model_validate(json.loads(raw))
