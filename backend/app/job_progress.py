"""Read-only projections for live progress; never load context or attempt prose."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import schemas as dto
from .domain import DomainError
from .models import Job


def missing_job():
    return DomainError("JOB_NOT_FOUND", "此作品中没有该任务。", 404)


def progress(session: Session, novel_id: str, job_id: str) -> dto.JobProgress:
    columns = [getattr(Job, name) for name in dto.JobProgress.model_fields]
    values = session.execute(select(*columns).where(Job.id == job_id, Job.novel_id == novel_id)).mappings().first()
    if values is None:
        raise missing_job()
    return dto.JobProgress.model_validate(values)


def job_state(session: Session, novel_id: str, job_id: str) -> str:
    value = session.scalar(select(Job.state).where(Job.id == job_id, Job.novel_id == novel_id))
    if value is None:
        raise missing_job()
    return value
