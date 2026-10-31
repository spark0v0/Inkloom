"""Consistent, credential-free backups and validated restore into a new directory."""

from __future__ import annotations

import io
import json
import sqlite3
import zipfile
import zlib

from . import schemas as dto
from .domain import (
    ACTIVE_JOB_STATES,
    DomainError,
    char_count,
    digest,
    normalize,
    now,
    resolve_evidence,
    uid,
    validate_document,
)
from .references import validate_restored_references
from .storage import Workspace

FORMAT_VERSION = 1
SCHEMA_REVISIONS = ("924486b5f963", "a12c7e604bc9", "b73d2f809a61", "c84e3a190b72",
                    "d95f4b207c83", "e06a5c318d94", "f17b6d429ea5", "1b8c6e431fa7")
SCHEMA_REVISION = SCHEMA_REVISIONS[-1]
SUPPORTED_REVISIONS = set(SCHEMA_REVISIONS)
MAX_ARCHIVE = 64 * 1024 * 1024
MAX_DATABASE = 256 * 1024 * 1024
MAX_MANIFEST = 32000


def schema_includes(revision: str, introduced: str) -> bool:
    """The supported migrations form one chain; later heads retain earlier checks."""
    return SCHEMA_REVISIONS.index(revision) >= SCHEMA_REVISIONS.index(introduced)


def read_backup_entry(archive: zipfile.ZipFile, name: str, maximum: int) -> bytes:
    """Bound each inflate as well as the result; ZIP metadata is untrusted."""
    result = bytearray()
    with archive.open(name) as entry:
        while chunk := entry.read(min(64 * 1024, maximum - len(result) + 1)):
            result.extend(chunk)
            if len(result) > maximum:
                raise DomainError("INVALID_ARCHIVE", "备份解压内容超过限制，未恢复。")
    return bytes(result)


def backup(workspace: Workspace) -> bytes:
    with workspace.lock:
        workspace.ensure_current()
        source = sqlite3.connect(workspace.db.path)
        snapshot = sqlite3.connect(":memory:")
        try:
            source.backup(snapshot)
            database = snapshot.serialize()
            novel_count = snapshot.execute("SELECT count(*) FROM novels").fetchone()[0]
            chapter_count = snapshot.execute("SELECT count(*) FROM chapters").fetchone()[0]
        finally:
            source.close()
            snapshot.close()
    if len(database) > MAX_DATABASE:
        raise DomainError("BACKUP_TOO_LARGE", "工作区超出当前备份大小限制，请联系维护者扩展容量。", 413)
    import hashlib
    manifest = {"format": "story-workshop-backup", "format_version": FORMAT_VERSION,
                "schema_revision": SCHEMA_REVISION, "created_at": now(),
                "novel_count": novel_count, "chapter_count": chapter_count,
                "files": {"workspace.db": {"bytes": len(database),
                           "sha256": hashlib.sha256(database).hexdigest()}},
                "credentials_included": False}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        archive.writestr("workspace.db", database)
    contents = buffer.getvalue()
    if len(contents) > MAX_ARCHIVE:
        raise DomainError("BACKUP_TOO_LARGE", "压缩后的备份超过当前恢复上限，未生成不可恢复的下载文件。请联系维护者扩展备份容量。", 413)
    return contents


def restore(workspace: Workspace, contents: bytes) -> dict:
    if len(contents) > MAX_ARCHIVE:
        raise DomainError("ARCHIVE_TOO_LARGE", "备份包超过 64 MB 限制。", 413)
    try:
        with zipfile.ZipFile(io.BytesIO(contents)) as archive:
            names = archive.namelist()
            if set(names) != {"manifest.json", "workspace.db"} or len(names) != 2:
                raise DomainError("INVALID_ARCHIVE", "备份文件清单不符合工作区格式，未解压。")
            for info in archive.infolist():
                if info.file_size > MAX_DATABASE or info.is_dir() or info.external_attr >> 16 & 0o170000 == 0o120000:
                    raise DomainError("INVALID_ARCHIVE", "备份包含过大文件或链接。")
                if info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
                    raise DomainError("INVALID_ARCHIVE", "备份包含不支持的压缩方式。")
            if archive.getinfo("manifest.json").file_size > MAX_MANIFEST:
                raise DomainError("INVALID_ARCHIVE", "备份清单过大。")
            manifest = json.loads(read_backup_entry(archive, "manifest.json", MAX_MANIFEST))
            if not isinstance(manifest, dict):
                raise DomainError("INVALID_ARCHIVE", "备份清单必须是对象。")
            if (manifest.get("format") != "story-workshop-backup"
                    or manifest.get("format_version") != FORMAT_VERSION
                    or manifest.get("schema_revision") not in SUPPORTED_REVISIONS):
                raise DomainError("UNSUPPORTED_BACKUP", "备份格式或数据库版本不受支持，原工作区未改变。")
            raw = read_backup_entry(archive, "workspace.db", MAX_DATABASE)
            import hashlib
            expected = manifest["files"]["workspace.db"]
            if expected["bytes"] != len(raw) or expected["sha256"] != hashlib.sha256(raw).hexdigest():
                raise DomainError("BACKUP_HASH_MISMATCH", "备份数据库校验失败，未覆盖任何数据。")
            if not raw.startswith(b"SQLite format 3\x00"):
                raise DomainError("INVALID_DATABASE", "备份中的数据库格式不正确。")
    except DomainError:
        raise
    except (ValueError, KeyError, TypeError, zipfile.BadZipFile, zlib.error, RuntimeError, OSError) as exc:
        raise DomainError("INVALID_ARCHIVE", "备份包已损坏或不属于叙事工坊。") from exc
    restore_id = uid("restored")
    target = (workspace.home / "restored" / restore_id).resolve()
    if not target.is_relative_to(workspace.home / "restored"):
        raise DomainError("RESTORE_PATH_INVALID", "恢复目录无效。")
    target.mkdir(parents=True, exist_ok=False)
    path = target / "workspace.db"
    path.write_bytes(raw)
    connection = sqlite3.connect(path)
    try:
        connection.execute("PRAGMA trusted_schema=OFF")
        if connection.execute("SELECT name FROM sqlite_master WHERE type IN ('trigger','view') LIMIT 1").fetchone():
            raise DomainError("INVALID_DATABASE", "备份包含本应用不使用的触发器或视图，未执行恢复。")
        connection.execute("PRAGMA foreign_keys=ON")
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise DomainError("INVALID_DATABASE", "恢复库完整性检查失败。")
        if connection.execute("PRAGMA foreign_key_check").fetchall():
            raise DomainError("INVALID_DATABASE", "恢复库中存在无效引用。")
        revision = connection.execute("SELECT version_num FROM alembic_version").fetchone()
        if revision is None or revision[0] != manifest["schema_revision"]:
            raise DomainError("UNSUPPORTED_BACKUP", "备份库迁移版本不匹配。")
        for body, content_hash, editor_doc, raw_paragraphs, chars in connection.execute(
                "SELECT text, content_hash, editor_doc, paragraphs, char_count FROM versions"):
            if digest(normalize(body)) != content_hash:
                raise DomainError("MANUSCRIPT_HASH_MISMATCH", "正文版本校验失败。")
            validate_document(body, json.loads(editor_doc))
            paragraphs = json.loads(raw_paragraphs)
            if ([p["text"] for p in paragraphs] != [line for line in normalize(body).split("\n") if line.strip()]
                    or len({p["paragraph_id"] for p in paragraphs}) != len(paragraphs)
                    or any(p["ordinal"] != i for i, p in enumerate(paragraphs))
                    or chars != char_count(body)):
                raise DomainError("MANUSCRIPT_HASH_MISMATCH", "正文段落或字数校验失败。")
        if connection.execute("SELECT c.id FROM chapters c LEFT JOIN versions v ON c.working_version_id=v.id "
                              "WHERE v.id IS NULL OR v.chapter_id!=c.id").fetchone():
            raise DomainError("INVALID_DATABASE", "当前正文版本引用无效。")
        if connection.execute("SELECT c.id FROM chapters c LEFT JOIN versions v ON c.accepted_version_id=v.id "
                              "WHERE c.accepted_version_id IS NOT NULL AND (v.id IS NULL OR v.chapter_id!=c.id)").fetchone():
            raise DomainError("INVALID_DATABASE", "正史版本引用无效。")
        validate_restored_references(connection, required=schema_includes(revision[0], "b73d2f809a61"))
        from .thread_restore import validate_restored_threads
        validate_restored_threads(connection, required=schema_includes(revision[0], "c84e3a190b72"))
        from .writing_preferences import validate_restored_writing_preferences
        validate_restored_writing_preferences(connection, required=schema_includes(revision[0], "d95f4b207c83"))
        from .outline_restore import validate_restored_outlines
        validate_restored_outlines(connection, required=schema_includes(revision[0], "e06a5c318d94"))
        # Restored connections must be configured again, including environment references.
        connection.execute("UPDATE providers SET key_env='', revision=revision+1 WHERE kind!='demo'")
        for job_id, raw_context in connection.execute("SELECT id,context FROM jobs").fetchall():
            context = json.loads(raw_context)
            dto.ContextOut.model_validate(context["preview"])
            context["provider"]["key_env"] = ""
            connection.execute("UPDATE jobs SET context=? WHERE id=?", (json.dumps(context, ensure_ascii=False), job_id))
        for row in connection.execute("SELECT f.novel_id,f.chapter_id,f.version_id,f.evidence,f.known_by,"
                                      "f.active,c.novel_id,c.review_state,c.accepted_version_id,v.chapter_id,"
                                      "v.content_hash,v.paragraphs FROM facts f JOIN chapters c ON f.chapter_id=c.id "
                                      "JOIN versions v ON f.version_id=v.id").fetchall():
            nid, cid, vid, evidence_json, known_json, active, chapter_nid, state, accepted, version_cid, content_hash, raw_paragraphs = row
            if nid != chapter_nid or cid != version_cid or (active and (state != "confirmed" or accepted != vid)):
                raise DomainError("INVALID_DATABASE", "事实记录的作品或正史版本不匹配。")
            sources = [{"source_id": f"{vid}:{p['paragraph_id']}", "novel_id": nid, "chapter_id": cid,
                        "version_id": vid, "paragraph_id": p["paragraph_id"], "content_hash": content_hash,
                        "text": p["text"]} for p in json.loads(raw_paragraphs)]
            for item in json.loads(evidence_json):
                evidence = dto.Evidence.model_validate(item).model_dump()
                resolved = resolve_evidence(evidence, sources)
                if any(evidence.get(key) != resolved[key] for key in resolved):
                    raise DomainError("INVALID_DATABASE", "事实引用范围或版本校验失败。")
            characters = {r[0] for r in connection.execute("SELECT id FROM entities WHERE novel_id=? AND kind='character'", (nid,))}
            if any(character not in characters for character in json.loads(known_json)):
                raise DomainError("INVALID_DATABASE", "人物知识引用不属于当前作品。")
        if schema_includes(revision[0], "f17b6d429ea5"):
            from .discussions import validate_restored_discussions
            validate_restored_discussions(connection)
        if schema_includes(revision[0], "1b8c6e431fa7"):
            for row in connection.execute("SELECT r.novel_id, r.source_id, r.target_id, e1.novel_id, e2.novel_id FROM entity_relations r "
                                          "LEFT JOIN entities e1 ON r.source_id=e1.id "
                                          "LEFT JOIN entities e2 ON r.target_id=e2.id").fetchall():
                r_nid, s_id, t_id, e1_nid, e2_nid = row
                if e1_nid != r_nid or e2_nid != r_nid or s_id == t_id:
                    raise DomainError("INVALID_DATABASE", "人物关系引用的实体不匹配或跨作品。")
        connection.execute("UPDATE jobs SET state='interrupted_uncertain', lease_epoch=lease_epoch+1, "
                           "error_code='RESTORED_TASK', error_message='从备份恢复；需要作者明确重试。' "
                           "WHERE state IN ('queued','running','pausing','cancelling','paused')")
        connection.execute("DELETE FROM story_search")
        rows = connection.execute("SELECT c.novel_id,c.id,v.id,v.paragraphs FROM chapters c "
                                  "JOIN versions v ON c.accepted_version_id=v.id "
                                  "WHERE c.review_state='confirmed'").fetchall()
        for novel_id, chapter_id, version_id, raw_paragraphs in rows:
            for paragraph in json.loads(raw_paragraphs):
                connection.execute("INSERT INTO story_search(novel_id,chapter_id,version_id,paragraph_id,body) "
                                   "VALUES(?,?,?,?,?)", (novel_id, chapter_id, version_id,
                                                        paragraph["paragraph_id"], paragraph["text"]))
        connection.commit()
        novel_count = connection.execute("SELECT count(*) FROM novels").fetchone()[0]
        chapter_count = connection.execute("SELECT count(*) FROM chapters").fetchone()[0]
    except DomainError:
        raise
    except (sqlite3.Error, ValueError, KeyError, TypeError, AttributeError) as exc:
        raise DomainError("INVALID_DATABASE", "备份库无法验证，原工作区未改变。") from exc
    finally:
        connection.close()
    if revision[0] != SCHEMA_REVISION:
        # Only after the untrusted database has passed validation may local migrations run.
        from .storage import Database
        migrated = Database(target)
        migrated.engine.dispose()
    workspace.restores[restore_id] = target
    return {"restore_id": restore_id, "novel_count": novel_count, "chapter_count": chapter_count,
            "message": "已在新目录校验正文、版本和引用。切换后需重新配置密钥，历史任务不会自动执行。"}


def activate_restore(workspace: Workspace, restore_id: str) -> None:
    from sqlalchemy import select

    from .models import Job
    with workspace.lock:
        with workspace.session() as session:
            if session.scalar(select(Job.id).where(Job.state.in_(ACTIVE_JOB_STATES))):
                raise DomainError("WORKSPACE_BUSY", "请先等待或取消活动任务，再切换工作区。", 409)
        target = workspace.restores.get(restore_id)
        if target is None or not target.is_dir():
            raise DomainError("RESTORE_NOT_FOUND", "找不到已验证的恢复目录，请重新上传备份。", 404)
        workspace.activate(target)


def activate_original(workspace: Workspace) -> None:
    from sqlalchemy import select

    from .models import Job
    with workspace.lock:
        with workspace.session() as session:
            if session.scalar(select(Job.id).where(Job.state.in_(ACTIVE_JOB_STATES))):
                raise DomainError("WORKSPACE_BUSY", "请先等待或取消活动任务，再返回原工作区。", 409)
        workspace.activate(workspace.home)
