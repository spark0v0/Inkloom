"""Bounded summary queries and scope-bound keyset cursors for complete history."""
import base64
import json
from datetime import datetime
from typing import get_args

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from . import schemas as dto
from .domain import DomainError, digest
from .library import require_chapter, require_novel
from .models import Chapter, Job, Novel, Plan, Version


def history_page(session: Session, novel_id: str | None = None, chapter_id: str | None = None,
                 task: dto.TaskName | None = None, state: dto.JobStateName | None = None,
                 query: str = "", cursor: str | None = None, limit: int = 30,
                 tasks: list[dto.TaskName] | None = None, volume_plan_id: str | None = None,
                 base_version_id: str | None = None, pending_only: bool = False) -> dto.JobHistoryPage:
    if not 1 <= limit <= 100 or len(query) > 200:
        raise DomainError("INVALID_PAGE", "请缩小查询范围。")
    if novel_id:
        require_novel(session, novel_id)
    if chapter_id:
        if not novel_id:
            raise DomainError("NOVEL_REQUIRED", "按章节查询记录时需要指定作品。")
        require_chapter(session, novel_id, chapter_id)
    if tasks is not None and (not 1 <= len(tasks) <= 11 or not set(tasks) <= set(get_args(dto.TaskName))):
        raise DomainError("INVALID_PAGE", "任务类型范围无效。")
    if volume_plan_id:
        volume = session.get(Plan, volume_plan_id)
        if not novel_id or volume is None or volume.novel_id != novel_id or volume.level != "volume":
            raise DomainError("VOLUME_NOT_FOUND", "分卷不属于当前作品。", 404)
    if base_version_id and (not chapter_id or not session.scalar(select(Version.id).where(
            Version.id == base_version_id, Version.chapter_id == chapter_id))):
        raise DomainError("VERSION_NOT_FOUND", "版本不属于当前章节。", 404)
    query = query.strip()
    scope_values = {"novel": novel_id, "chapter": chapter_id, "task": task, "state": state, "query": query}
    for key, value in {"tasks": sorted(set(tasks)) if tasks else None, "volume": volume_plan_id,
                       "version": base_version_id, "pending": pending_only or None}.items():
        if value is not None:
            scope_values[key] = value
    scope = digest(scope_values)
    statement = select(Job.id, Job.novel_id, Job.chapter_id, Job.base_version_id, Novel.title.label("novel_title"),
        Chapter.title.label("chapter_title"), Job.task, Job.state,
        func.substr(Job.instruction, 1, 240).label("instruction_preview"), Job.candidate_status,
        Job.attempt_count, Job.max_attempts, Job.is_demo, Job.created_at).select_from(Job).join(
            Novel, Novel.id == Job.novel_id).join(Chapter, Chapter.id == Job.chapter_id)
    if novel_id:
        statement = statement.where(Job.novel_id == novel_id)
    if chapter_id:
        statement = statement.where(Job.chapter_id == chapter_id)
    if task:
        statement = statement.where(Job.task == task)
    if tasks:
        statement = statement.where(Job.task.in_(tasks))
    if volume_plan_id:
        statement = statement.where(Job.task == "outline",
            Job.context["input"]["production"]["volume_plan_id"].as_string() == volume_plan_id)
    if base_version_id:
        statement = statement.where(Job.base_version_id == base_version_id)
    if pending_only:
        statement = statement.where(Job.candidate_status.not_in(["adopted", "rejected"]), Job.state != "cancelled")
    if state:
        statement = statement.where(Job.state == state)
    if query:
        statement = statement.where(or_(Job.instruction.contains(query, autoescape=True),
            Chapter.title.contains(query, autoescape=True), Novel.title.contains(query, autoescape=True)))
    if cursor is not None:
        try:
            if not cursor or len(cursor) > 1024:
                raise ValueError
            raw = json.loads(base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True))
            if not isinstance(raw, dict) or set(raw) != {"v", "scope", "at", "id"} or type(raw["v"]) is not int or raw["v"] != 1:
                raise ValueError
            if not isinstance(raw["scope"], str) or len(raw["scope"]) != 64:
                raise ValueError
            if not isinstance(raw["id"], str) or not 1 <= len(raw["id"]) <= 160:
                raise ValueError
            if not isinstance(raw["at"], str) or len(raw["at"]) > 60 or datetime.fromisoformat(raw["at"]).tzinfo is None:
                raise ValueError
        except (ValueError, TypeError, KeyError, UnicodeError) as error:
            raise DomainError("INVALID_CURSOR", "记录位置无效，请重新筛选后读取。") from error
        if raw["scope"] != scope:
            raise DomainError("CURSOR_SCOPE", "筛选条件已变化，请从第一页重新读取。")
        statement = statement.where(or_(Job.created_at < raw["at"],
            and_(Job.created_at == raw["at"], Job.id < raw["id"])))
    rows = session.execute(statement.order_by(Job.created_at.desc(), Job.id.desc()).limit(limit + 1)).mappings().all()
    items = [dto.JobHistoryItem.model_validate(dict(row)) for row in rows[:limit]]
    next_cursor = None
    if len(rows) > limit:
        last = items[-1]
        next_cursor = base64.urlsafe_b64encode(json.dumps({"v": 1, "scope": scope,
            "at": last.created_at, "id": last.id}, separators=(",", ":")).encode()).decode().rstrip("=")
    return dto.JobHistoryPage(items=items, next_cursor=next_cursor)
