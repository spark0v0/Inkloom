"""Explicit, version-bound manuscript and author-card material for discussion."""
import json

from . import schemas as dto
from .domain import DomainError, source_for
from .library import require_chapter
from .models import Entity, Version


def materials(session, novel_id, reference):
    if (len({item.chapter_id for item in reference.manuscripts}) != len(reference.manuscripts)
            or len(set(reference.entity_ids)) != len(reference.entity_ids)):
        raise DomainError("DISCUSSION_SCOPE", "正文与档案参考不能重复选择。")
    manuscripts, sources, entities = [], [], []
    for item in reference.manuscripts:
        chapter = require_chapter(session, novel_id, item.chapter_id)
        if item.version_id != chapter.working_version_id:
            raise DomainError("DISCUSSION_CONTEXT_CHANGED", "所选正文已更新，请重新查看资料后再发送。", 409)
        version = session.get(Version, item.version_id)
        if not version.text.strip():
            raise DomainError("DISCUSSION_EMPTY_MANUSCRIPT", "所选章节还没有正文，请取消该项参考。")
        manuscripts.append(dto.DiscussionManuscript(chapter_id=chapter.id, title=chapter.title,
            position=chapter.position, version_id=version.id, review_state=chapter.review_state,
            char_count=version.char_count).model_dump())
        for paragraph in version.paragraphs:
            source = source_for(version, chapter, paragraph)
            if chapter.review_state != "confirmed":
                source["kind"] = "draft"
            sources.append(source)
    for entity_id in reference.entity_ids:
        entity = session.get(Entity, entity_id)
        if entity is None or entity.novel_id != novel_id or entity.status != "author":
            raise DomainError("DISCUSSION_SCOPE", "请选择本书已确认的作者档案。")
        entities.append(dto.EntityOut.model_validate(entity).model_dump())
    return manuscripts, sources, entities


def validate_snapshot(connection, novel_id, reference, context):
    """Historical snapshots may be stale; ownership and immutable text must still match."""
    payload, preview = context["input"], context["preview"]
    modern = context.get("prompt_version") == "discuss-v2"
    if not modern and not reference.manuscripts and not reference.entity_ids:
        return
    if len({item.chapter_id for item in reference.manuscripts}) != len(reference.manuscripts):
        raise DomainError("INVALID_DATABASE", "讨论正文重复。")
    metas, sources, entities = payload["manuscripts"], payload["sources"], payload["entities"]
    if ([item["chapter_id"] for item in metas] != [item.chapter_id for item in reference.manuscripts]
            or preview["discussion_manuscripts"] != metas
            or preview["entities"] != entities):
        raise DomainError("INVALID_DATABASE", "讨论资料预览与实际快照不一致。")
    expected = []
    for item, raw in zip(reference.manuscripts, metas, strict=True):
        meta = dto.DiscussionManuscript.model_validate(raw)
        row = connection.execute("SELECT v.chapter_id,v.paragraphs,v.content_hash,v.char_count,c.novel_id "
            "FROM versions v JOIN chapters c ON c.id=v.chapter_id WHERE v.id=?", (item.version_id,)).fetchone()
        if (row is None or row[0] != item.chapter_id or row[4] != novel_id
                or meta.version_id != item.version_id or meta.char_count != row[3]):
            raise DomainError("INVALID_DATABASE", "讨论正文版本不属于当前作品或与快照不符。")
        for paragraph in json.loads(row[1]):
            expected.append({"source_id": f"{item.version_id}:{paragraph['paragraph_id']}", "novel_id": novel_id,
                "chapter_id": item.chapter_id, "chapter_title": meta.title, "chapter_position": meta.position,
                "version_id": item.version_id, "paragraph_id": paragraph["paragraph_id"],
                "content_hash": row[2], "text": paragraph["text"],
                "kind": "canon" if meta.review_state == "confirmed" else "draft"})
    if sources != expected or [dto.Source.model_validate(row).model_dump() for row in sources] != preview["sources"]:
        raise DomainError("INVALID_DATABASE", "讨论原文来源与不可变正文不一致。")
    if [item["id"] for item in entities] != reference.entity_ids or len(set(reference.entity_ids)) != len(reference.entity_ids):
        raise DomainError("INVALID_DATABASE", "讨论档案快照范围无效。")
    for raw in entities:
        entity = dto.EntityOut.model_validate(raw)
        row = connection.execute("SELECT novel_id FROM entities WHERE id=?", (entity.id,)).fetchone()
        if row is None or row[0] != novel_id or entity.novel_id != novel_id or entity.status != "author":
            raise DomainError("INVALID_DATABASE", "讨论档案不属于当前作品。")
