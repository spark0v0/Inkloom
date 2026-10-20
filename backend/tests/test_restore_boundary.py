import hashlib
import io
import json
import sqlite3
import zipfile

import pytest

from app import schemas as dto
from app.domain import DomainError
from app.workspace_io import activate_original, activate_restore, backup, restore


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
