"""Read the narrow chapter catalog and load confirmed paragraphs by version."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .domain import DomainError, source_for
from .models import Chapter, Fact, Version


def chapter_catalog(session: Session, novel_id: str) -> list[dict[str, Any]]:
    rows = session.execute(select(Chapter.id, Chapter.title, Chapter.volume, Chapter.goal,
        Chapter.position, Chapter.working_version_id.label("version")).where(
        Chapter.novel_id == novel_id).order_by(Chapter.position)).mappings()
    return [dict(row) for row in rows]


def confirmed_before(novel_id: str, position: int):
    return (Chapter.novel_id == novel_id, Chapter.position < position, Chapter.review_state == "confirmed")


def canon_checkpoint(session: Session, novel_id: str, position: int) -> dict[str, str]:
    return {row.id: row.accepted_version_id for row in session.execute(select(
        Chapter.id, Chapter.accepted_version_id).where(*confirmed_before(novel_id, position)))}


def prior_chapters(session: Session, novel_id: str, position: int):
    return session.execute(select(Chapter.id, Chapter.novel_id, Chapter.title,
        Chapter.position, Chapter.accepted_version_id).where(*confirmed_before(novel_id, position))
        .order_by(Chapter.position.desc())).all()


def prior_reading_sources(session: Session, novel_id: str, position: int, prior, ranked_ids: list[str],
                          facts: list[Fact], excluded: set[str]):
    recent_versions = {chapter.accepted_version_id for chapter in prior[:2]}
    needed_versions = (recent_versions | {source_id.split(":", 1)[0] for source_id in ranked_ids}
                       | {fact.version_id for fact in facts})
    if not needed_versions:
        return [], [], {}

    # Scope by both the chapter's current confirmation and the version's actual owner.
    rows = session.execute(select(Version.id, Version.chapter_id, Version.content_hash, Version.paragraphs)
        .join(Chapter, (Chapter.id == Version.chapter_id) & (Chapter.accepted_version_id == Version.id))
        .where(*confirmed_before(novel_id, position), Version.id.in_(needed_versions)))
    chapters = {chapter.id: chapter for chapter in prior}
    versions = {version.id: version for version in rows}
    paragraphs = {version.id: {p["paragraph_id"]: p for p in version.paragraphs}
                  for version in versions.values()}

    def load(source_id):
        version_id, _, paragraph_id = source_id.partition(":")
        paragraph = paragraphs.get(version_id, {}).get(paragraph_id)
        if paragraph is None:
            return None
        version = versions[version_id]
        return source_for(version, chapters[version.chapter_id], paragraph)

    recent = []
    for chapter in prior[:2]:
        version = versions.get(chapter.accepted_version_id)
        if version is not None:
            for paragraph in version.paragraphs:
                source = source_for(version, chapter, paragraph)
                if source["source_id"] not in excluded:
                    recent.append(source)
    relevant = [source for source_id in ranked_ids
                if source_id.partition(":")[0] not in recent_versions and source_id not in excluded
                if (source := load(source_id)) is not None]
    evidence = {}
    for fact in facts:
        for citation in fact.evidence:
            source_id = citation["source_id"]
            if source_id not in evidence:
                evidence[source_id] = load(source_id)
            source = evidence[source_id]
            if (source is None or source["version_id"] != fact.version_id
                    or source["chapter_id"] != fact.chapter_id or source["paragraph_id"] != citation["paragraph_id"]):
                raise DomainError("INVALID_EVIDENCE", "已确认记忆的原文依据无法读取，请复核相关章节后重试。", 409)
    return recent, relevant, evidence
