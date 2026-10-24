"""Resolve an author's chosen direction without promoting suggestions to facts."""

from sqlalchemy.orm import Session

from . import schemas as dto
from .domain import DomainError
from .library import require_job


def chosen_direction(session: Session, novel_id: str, request: dto.ContextInput) -> dict | None:
    if request.inspiration is None:
        return None
    if request.task not in {"continue", "rewrite"}:
        raise DomainError("INVALID_INSPIRATION_TASK", "剧情方向只能用于续写或改写。")
    job = require_job(session, novel_id, request.inspiration.job_id)
    if (job.chapter_id != request.chapter_id or job.task != "inspiration"
            or job.state != "succeeded" or job.candidate_status != "ready" or not job.result):
        raise DomainError("INSPIRATION_NOT_READY", "请选择本章已完成且仍有效的剧情方向。", 409)
    from .context import context_current
    if job.base_version_id != request.base_version_id or not context_current(session, job):
        raise DomainError("INSPIRATION_STALE", "正文或设定已更新，请重新找灵感后选择方向。", 409)
    result = dto.InspirationResult.model_validate(job.result)
    option = result.options[request.inspiration.option_index]
    return {"job_id": job.id, "option_index": request.inspiration.option_index,
            "status": "author_selected_future_suggestion", "direction": option.model_dump()}
