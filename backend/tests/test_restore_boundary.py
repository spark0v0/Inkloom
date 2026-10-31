import hashlib
import io
import json
import sqlite3
import struct
import zipfile
import zlib

import pytest
from alembic.config import Config
from sqlalchemy import create_engine

from alembic import command
from app import schemas as dto
from app.domain import DomainError
from app.storage import BACKEND_DIR
from app.workspace_io import activate_original, activate_restore, backup, restore


def test_forged_uncompressed_size_cannot_cause_an_unbounded_inflate(workspace, monkeypatch):
    prefix = b'{}'
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('manifest.json', prefix + b' ' * (4 * 1024 * 1024))
        archive.writestr('workspace.db', b'unused')
    contents = bytearray(output.getvalue())
    with zipfile.ZipFile(io.BytesIO(contents)) as archive:
        local = archive.getinfo('manifest.json').header_offset
        central = archive.start_dir
    # Forge both ZIP headers to claim only the harmless two-byte prefix is present.
    for offset in (local + 14, central + 16):
        struct.pack_into('<I', contents, offset, zlib.crc32(prefix))
    for offset in (local + 22, central + 24):
        struct.pack_into('<I', contents, offset, len(prefix))
    original_decompressor = zlib.decompressobj
    inflated = []

    class ObservedDecompressor:
        def __init__(self, *args, **kwargs):
            self.decoder = original_decompressor(*args, **kwargs)

        def decompress(self, data, max_length=0):
            result = self.decoder.decompress(data, max_length)
            inflated.append(len(result))
            return result

        def __getattr__(self, name):
            return getattr(self.decoder, name)

    monkeypatch.setattr(zlib, 'decompressobj', ObservedDecompressor)
    original = workspace.db.workspace_id
    with pytest.raises(DomainError):
        restore(workspace, bytes(contents))
    assert inflated and max(inflated) <= 64 * 1024
    assert workspace.db.workspace_id == original


@pytest.mark.parametrize('compression', [zipfile.ZIP_BZIP2, zipfile.ZIP_LZMA])
def test_restore_rejects_compression_not_used_by_inkloom(workspace, compression):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=compression) as archive:
        archive.writestr('manifest.json', '{}')
        archive.writestr('workspace.db', b'unused')
    with pytest.raises(DomainError) as error:
        restore(workspace, output.getvalue())
    assert error.value.code == 'INVALID_ARCHIVE'


@pytest.mark.parametrize('entry', ['manifest.json', 'workspace.db'])
def test_corrupt_deflate_is_a_rejected_backup_not_an_unhandled_error(library, workspace, entry):
    novel = library.create_novel(dto.NovelInput(title='损坏备份不影响原书'))
    original = workspace.db.workspace_id
    contents = bytearray(backup(workspace))
    with zipfile.ZipFile(io.BytesIO(contents)) as archive:
        info = archive.getinfo(entry)
        assert info.compress_type == zipfile.ZIP_DEFLATED
    name_length, extra_length = struct.unpack_from('<HH', contents, info.header_offset + 26)
    data_start = info.header_offset + 30 + name_length + extra_length
    contents[data_start] = 0x07  # Reserved DEFLATE block type: decompression must fail.
    with pytest.raises(DomainError) as error:
        restore(workspace, bytes(contents))
    assert error.value.code == 'INVALID_ARCHIVE'
    assert workspace.db.workspace_id == original
    assert library.novel(novel.id).title == '损坏备份不影响原书'


@pytest.mark.parametrize('missing', ['style', 'threads', 'references'])
def test_new_head_keeps_previous_backup_feature_requirements(library, workspace, tmp_path, missing):
    novel = library.create_novel(dto.NovelInput(title='旧备份必需结构'))
    library.create_chapter(novel.id, dto.ChapterInput(title='第一章'))
    original_id = workspace.db.workspace_id
    with zipfile.ZipFile(io.BytesIO(backup(workspace))) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        path = tmp_path / 'old-backup.db'
        path.write_bytes(archive.read('workspace.db'))
    engine = create_engine('sqlite:///' + path.as_posix())
    config = Config(str(BACKEND_DIR / 'alembic.ini'))
    config.set_main_option('script_location', str(BACKEND_DIR / 'alembic'))
    with engine.begin() as connection:
        config.attributes['connection'] = connection
        command.downgrade(config, 'e06a5c318d94')
    engine.dispose()
    statements = {
        'style': ['ALTER TABLE novels DROP COLUMN writing_preferences'],
        'threads': ['DROP TABLE thread_progress', 'DROP TABLE thread_tracks'],
        'references': ['ALTER TABLE chapters DROP COLUMN "references"',
                       'ALTER TABLE chapters DROP COLUMN references_revision'],
    }
    with sqlite3.connect(path) as connection:
        for statement in statements[missing]:
            connection.execute(statement)
        connection.commit()
        raw = connection.serialize()
    manifest['schema_revision'] = 'e06a5c318d94'
    manifest['files']['workspace.db'] = {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        archive.writestr('manifest.json', json.dumps(manifest))
        archive.writestr('workspace.db', raw)
    with pytest.raises(DomainError) as error:
        restore(workspace, output.getvalue())
    assert error.value.code == 'INVALID_DATABASE'
    assert workspace.db.workspace_id == original_id


def test_restore_rejects_schema_code_before_applying_updates(library, workspace, tmp_path):
    library.create_novel(dto.NovelInput(title="保留原工作区"))
    original_id = workspace.db.workspace_id
    with zipfile.ZipFile(io.BytesIO(backup(workspace))) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        database = archive.read("workspace.db")
    # WAL snapshots need a real file for subsequent writes; deserialize into :memory: is read-only here.
    database_path = tmp_path / "tampered.db"
    database_path.write_bytes(database)
    conn = sqlite3.connect(database_path)
    try:
        conn.execute("CREATE TRIGGER unexpected AFTER UPDATE ON providers BEGIN DELETE FROM novels; END")
        conn.commit()
        modified = conn.serialize()
    finally:
        conn.close()
    manifest["files"]["workspace.db"] = {"bytes": len(modified), "sha256": hashlib.sha256(modified).hexdigest()}
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("workspace.db", modified)
    with pytest.raises(DomainError, match="触发器"):
        restore(workspace, output.getvalue())
    assert workspace.db.workspace_id == original_id
    assert library.novels()[0].title == "保留原工作区"


def test_restore_does_not_reactivate_environment_credentials(library, generation, workspace, monkeypatch):
    monkeypatch.setenv("STORY_WORKSHOP_TEST_CANARY", "test-only-environment-canary")
    provider = generation.save_provider(dto.ProviderInput(name="环境变量连接", model="test",
        base_url="http://127.0.0.1:9/v1", key_env="STORY_WORKSHOP_TEST_CANARY"))
    assert provider.has_key
    original_id = workspace.db.workspace_id
    restored = restore(workspace, backup(workspace))
    activate_restore(workspace, restored["restore_id"])
    recovered = next(p for p in generation.providers() if p.id == provider.id)
    assert recovered.key_env == ""
    assert recovered.has_key is False
    activate_original(workspace)
    assert workspace.db.workspace_id == original_id
    assert next(p for p in generation.providers() if p.id == provider.id).has_key
