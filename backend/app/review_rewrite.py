"""A selected review finding can prepare one verified paragraph, never edit prose."""
from sqlalchemy.orm import Session

from . import schemas as dto
from .domain import DomainError, char_count, digest, resolve_evidence, source_for
from .library import require_chapter, require_job
from .models import Chapter, Job, Version


def _finding(session: Session, novel_id: str, job_id: str, chapter_id: str,
             version_id: str, index: int) -> tuple[Version, dto.Finding]:
    job = require_job(session, novel_id, job_id)
    chapter = require_chapter(session, novel_id, chapter_id)
    if job.task != "review" or job.chapter_id != chapter_id or job.state != "succeeded" or not job.result:
        raise DomainError("REVIEW_NOT_READY", "请选择本章已经完成的审稿意见。", 409)
    from .context import context_current
    if (chapter.working_version_id != version_id or job.base_version_id != version_id
            or job.candidate_status != "ready" or job.context["preview"].get("review_reference")
            or not context_current(session, job)):
        raise DomainError("REVIEW_STALE", "正文或参考已变化，请重新审稿后再准备改写。", 409)
    result = dto.ReviewResult.model_validate(job.result)
    if index >= len(result.findings):
        raise DomainError("FINDING_NOT_FOUND", "找不到这条审稿意见。", 404)
    finding = result.findings[index]
    if finding.decision in {"intentional", "false_positive"}:
        raise DomainError("REVIEW_DECISION", "此项已标为有意安排或误报，请先调整作者判断再准备改写。", 409)
    version = session.get(Version, version_id)
    sources = [source_for(version, chapter, paragraph) for paragraph in version.paragraphs]
    finding.target = dto.Evidence(**resolve_evidence(finding.target.model_dump(), sources))
    # Re-check selected prior evidence against immutable original text, not model prose.
    verified = []
    for evidence in finding.source_evidence:
        prior = session.get(Chapter, evidence.chapter_id)
        source_version = session.get(Version, evidence.version_id)
        if (prior is None or prior.novel_id != novel_id or source_version is None
                or source_version.chapter_id != prior.id
                or (prior.id != chapter.id and prior.position >= chapter.position)
                or (prior.id == chapter.id and source_version.id != version.id)
                or (prior.id != chapter.id and (prior.review_state != "confirmed"
                    or prior.accepted_version_id != source_version.id))):
            raise DomainError("REVIEW_STALE", "审稿依据已变化，请重新审稿。", 409)
        verified.append(dto.Evidence(**resolve_evidence(evidence.model_dump(),
            [source_for(source_version, prior, p) for p in source_version.paragraphs])))
    finding.source_evidence = verified
    return version, finding


def _paragraph_selection(version: Version, target: dto.Evidence) -> dto.Selection:
    paragraphs = iter(version.paragraphs)
    offset = 0
    for line in version.text.split("\n"):
        if line.strip():
            paragraph = next(paragraphs)
            if paragraph["paragraph_id"] == target.paragraph_id:
                if paragraph["text"] != line:
                    break
                return dto.Selection(start_codepoint=offset, end_codepoint=offset + len(line), text=line)
        offset += len(line) + 1
    raise DomainError("REVIEW_STALE", "无法定位审稿段落，请重新审稿。", 409)


def prepare_rewrite(session: Session, novel_id: str, job_id: str,
                    data: dto.ReviewRewriteInput) -> dto.ReviewRewritePreparation:
    job = require_job(session, novel_id, job_id)
    version, finding = _finding(session, novel_id, job_id, job.chapter_id, data.base_version_id, data.index)
    selection = _paragraph_selection(version, finding.target)
    return dto.ReviewRewritePreparation(base_version_id=version.id,
        reference=dto.ReviewReference(job_id=job_id, finding_index=data.index, finding_hash=digest(finding.model_dump())),
        selection=selection, finding=finding,
        suggested_target_chars=min(6000, max(100, char_count(selection.text))))


def review_guidance(session: Session, novel_id: str, request: dto.ContextInput) -> dict | None:
    reference = request.review_reference
    if reference is None:
        return None
    if request.task != "rewrite" or request.inspiration is not None:
        raise DomainError("INVALID_REVIEW_TASK", "审稿建议只能单独用于对应段落的改写。")
    version, finding = _finding(session, novel_id, reference.job_id, request.chapter_id,
                                request.base_version_id, reference.finding_index)
    if digest(finding.model_dump()) != reference.finding_hash:
        raise DomainError("REVIEW_CHANGED", "审稿建议或作者判断已变化，请重新选择这条意见。", 409)
    if request.selection != _paragraph_selection(version, finding.target):
        raise DomainError("REVIEW_SELECTION_CHANGED", "修稿范围与审稿段落不一致，请重新准备改写。", 409)
    return {"status": "author_selected_review_suggestion", "reference": reference.model_dump(),
            "finding": finding.model_dump()}


def review_reference_current(session: Session, job: Job) -> bool:
    raw = job.context["preview"].get("review_reference")
    if raw is None:
        return True
    try:
        reference = dto.ReviewReference.model_validate(raw)
        version, finding = _finding(session, job.novel_id, reference.job_id, job.chapter_id,
                                    job.base_version_id, reference.finding_index)
        selection = dto.Selection.model_validate(job.selection)
        return (digest(finding.model_dump()) == reference.finding_hash
                and selection == _paragraph_selection(version, finding.target))
    except (DomainError, ValueError):
        return False
