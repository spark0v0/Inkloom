"""Read-only, conservative review navigation; never infers that a chapter is safe."""
from sqlalchemy import select
from sqlalchemy.orm import load_only

from . import schemas as dto
from .domain import DomainError, digest
from .library import require_novel
from .models import Chapter


def review_impact(session, novel_id, after=0, fingerprint=None, limit=30):
    novel = require_novel(session, novel_id)
    if type(after) is not int or after < 0 or not 1 <= limit <= 50:
        raise DomainError("INVALID_PAGE", "复核清单位置无效。")
    if after and fingerprint is None:
        raise DomainError("INVALID_PAGE", "请从复核清单第一页读取。")
    # Hash only metadata. Reading the list must not load historical manuscripts.
    rows = session.execute(select(Chapter.id, Chapter.title, Chapter.position, Chapter.working_version_id,
        Chapter.accepted_version_id, Chapter.review_state, Chapter.references_revision).where(
        Chapter.novel_id == novel_id).order_by(Chapter.position)).mappings().all()
    signature = digest({"novel": novel_id, "canon": novel.canon_revision, "chapters": [dict(row) for row in rows]})
    if fingerprint is not None and fingerprint != signature:
        raise DomainError("REVIEW_IMPACT_CHANGED", "章节或定稿状态已变化，请刷新复核清单。", 409)
    pending = [row for row in rows if row["review_state"] == "needs_review" and row["accepted_version_id"]]
    selected = [row for row in pending if row["position"] > after][:limit + 1]
    by_id = {row["id"]: row for row in rows}
    references = {row.id: row.references for row in session.scalars(select(Chapter).options(
        load_only(Chapter.id, Chapter.references)).where(Chapter.id.in_([item["id"] for item in selected[:limit]]))).all()}
    items = []
    for row in selected[:limit]:
        changed = []
        for item in references[row["id"]].get("chapters", []):
            prior = by_id.get(item["chapter_id"])
            if prior is not None and (prior["review_state"] != "confirmed" or prior["accepted_version_id"] != item["version_id"]):
                changed.append(dto.ReviewImpactReference(chapter_id=prior["id"], title=prior["title"],
                    selected_version_id=item["version_id"], current_version_id=prior["accepted_version_id"],
                    review_state=prior["review_state"]))
        items.append(dto.ReviewImpactItem(chapter_id=row["id"], title=row["title"], position=row["position"],
            working_version_id=row["working_version_id"], accepted_version_id=row["accepted_version_id"],
            manuscript_changed=row["working_version_id"] != row["accepted_version_id"], references=changed))
    return dto.ReviewImpactPage(total=len(pending), items=items, source_fingerprint=signature,
        next_after=items[-1].position if len(selected) > limit else None,
        first_chapter_id=pending[0]["id"] if pending else None)
