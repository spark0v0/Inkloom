"""Validate thread ownership and immutable evidence before activating a backup."""
import json
from types import SimpleNamespace

from . import schemas as dto
from .domain import DomainError, resolve_evidence, source_for


def validate_restored_threads(connection, *, required: bool):
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    expected = {"thread_tracks", "thread_progress"}
    if not expected.issubset(tables):
        if required or expected & tables:
            raise DomainError("INVALID_DATABASE", "备份缺少伏笔跟进表，原工作区未改变。")
        return
    for entity_id, revision, target_id, intent, paused in connection.execute(
            "SELECT entity_id,revision,target_chapter_id,intent,paused FROM thread_tracks").fetchall():
        entity = connection.execute("SELECT novel_id,kind FROM entities WHERE id=?", (entity_id,)).fetchone()
        if not entity or entity[1] != "thread" or type(revision) is not int or revision < 0 or paused not in {0, 1}:
            raise DomainError("INVALID_DATABASE", "伏笔类型或修订无效。")
        dto.ThreadPlanInput(base_revision=revision, target_chapter_id=target_id, intent=intent, paused=paused)
        if target_id and not connection.execute("SELECT 1 FROM chapters WHERE id=? AND novel_id=?", (target_id, entity[0])).fetchone():
            raise DomainError("INVALID_DATABASE", "伏笔目标章节不属于本书。")
    for row in connection.execute("SELECT entity_id,chapter_id,version_id,stage,evidence,note,voided,operation_id,request_hash,created_at FROM thread_progress").fetchall():
        entity_id, chapter_id, version_id, stage, raw_evidence, note, voided, operation_id, request_hash, created_at = row
        owner = connection.execute("SELECT e.novel_id FROM entities e JOIN thread_tracks t ON e.id=t.entity_id WHERE e.id=?", (entity_id,)).fetchone()
        chapter = connection.execute("SELECT novel_id,title,position,accepted_version_id FROM chapters WHERE id=?", (chapter_id,)).fetchone()
        version = connection.execute("SELECT chapter_id,content_hash,paragraphs FROM versions WHERE id=?", (version_id,)).fetchone()
        if not owner or not chapter or not version or owner[0] != chapter[0] or version[0] != chapter_id or voided not in {0, 1}:
            raise DomainError("INVALID_DATABASE", "伏笔依据不属于本书或指定章节。")
        evidence = dto.Evidence.model_validate(json.loads(raw_evidence)).model_dump()
        dto.ThreadProgressInput(base_revision=0, operation_id=operation_id, chapter_id=chapter_id,
            version_id=version_id, stage=stage, evidence=evidence, note=note)
        if not isinstance(request_hash, str) or len(request_hash) != 64 or not isinstance(created_at, str):
            raise DomainError("INVALID_DATABASE", "伏笔记录元数据无效。")
        version_obj = SimpleNamespace(id=version_id, content_hash=version[1])
        chapter_obj = SimpleNamespace(id=chapter_id, novel_id=owner[0], title=chapter[1], position=chapter[2], accepted_version_id=version_id)
        resolved = resolve_evidence(evidence, [source_for(version_obj, chapter_obj, p) for p in json.loads(version[2])])
        # Chapter names may change; immutable identity, range and original text may not.
        for key in ("novel_id", "chapter_id", "version_id", "paragraph_id", "content_hash", "start_codepoint", "end_codepoint"):
            if evidence.get(key) != resolved[key]:
                raise DomainError("INVALID_DATABASE", "伏笔原文范围或版本校验失败。")
