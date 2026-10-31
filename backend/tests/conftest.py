import hashlib
import io
import json
import sqlite3
import zipfile

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from alembic import command
from app.jobs import Generation
from app.library import Library
from app.main import create_app
from app.storage import BACKEND_DIR, Workspace
from app.workspace_io import backup


@pytest.fixture
def workspace(tmp_path):
    ws = Workspace(tmp_path / "workspace")
    yield ws
    ws.close()


@pytest.fixture
def library(workspace):
    return Library(workspace)


@pytest.fixture
def generation(workspace):
    return Generation(workspace)


@pytest.fixture
def backup_at_revision(workspace, tmp_path):
    """Downgrade only an isolated snapshot, using the same migrations as production."""
    def build(revision):
        with zipfile.ZipFile(io.BytesIO(backup(workspace))) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            database = tmp_path / f"legacy-{revision}.db"
            database.write_bytes(archive.read("workspace.db"))
        engine = create_engine("sqlite:///" + database.as_posix())
        config = Config(str(BACKEND_DIR / "alembic.ini"))
        config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
        try:
            with engine.begin() as connection:
                config.attributes["connection"] = connection
                command.downgrade(config, revision)
        finally:
            engine.dispose()
        with sqlite3.connect(database) as connection:
            raw = connection.serialize()
        manifest["schema_revision"] = revision
        manifest["files"]["workspace.db"] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            archive.writestr("manifest.json", json.dumps(manifest))
            archive.writestr("workspace.db", raw)
        return output.getvalue()
    return build


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path / "api-workspace", worker=False)
    with TestClient(app, base_url="http://127.0.0.1:8765",
                    headers={"Origin": "http://127.0.0.1:8765"}) as c:
        assert c.get("/api/v1/health").status_code == 200
        yield c
