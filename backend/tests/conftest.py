import pytest
from fastapi.testclient import TestClient

from app.jobs import Generation
from app.library import Library
from app.main import create_app
from app.storage import Workspace


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
def client(tmp_path):
    app = create_app(tmp_path / "api-workspace", worker=False)
    with TestClient(app, base_url="http://127.0.0.1:8765",
                    headers={"Origin": "http://127.0.0.1:8765"}) as c:
        assert c.get("/api/v1/health").status_code == 200
        yield c
