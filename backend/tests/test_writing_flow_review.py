"""Regressions from the author-path review, using isolated SQLite and HTTP mocks."""
import asyncio
import json

import httpx
import pytest

from app import schemas as dto
from app.context import build_context
from app.domain import DomainError, uid
from app.models import Provider
from app.providers import ProviderFailure, stream_completion


def test_unconfirmed_previous_chapter_allows_scene_draft_without_promoting_its_text(library, generation):
    novel = library.create_novel(dto.NovelInput(title="连续草拟"))
    first = library.create_chapter(novel.id, dto.ChapterInput(title="前章"))
    library.save(novel.id, first.id, dto.SaveInput(base_version_id=first.working_version_id,
        operation_id=uid("save"), text="尚未确认的秘密不能当作记忆。"))
    current = library.create_chapter(novel.id, dto.ChapterInput(title="后章"))
    request = dto.JobInput(task="continue", chapter_id=current.id,
        base_version_id=current.working_version_id, scene=dto.SceneIntent(goal="客栈问路"),
        idempotency_key=uid("scene"))
    preview = generation.preview(novel.id, request)
    assert not any(source.chapter_id == first.id for source in preview.sources)
    assert any("未定稿" in notice for notice in preview.notices)
    assert generation.create(novel.id, request).state == "queued"
    with pytest.raises(DomainError):
        library.confirm(novel.id, current.id, dto.CanonInput(
            version_id=current.working_version_id, operation_id=uid("confirm")))


def test_automatic_relation_neighbor_yields_to_required_author_material(library, generation):
    novel = library.create_novel(dto.NovelInput(title="邻居预算"))
    hero = library.put_entity(novel.id, dto.EntityInput(kind="character", name="林舟"))
    neighbor = library.put_entity(novel.id, dto.EntityInput(kind="character", name="守塔人",
        body="遥远的身世与旁支经历。" * 1000))
    library.create_relation(novel.id, dto.RelationInput(source_id=hero.id,
        target_id=neighbor.id, relation_type="旧识", description="多年前见过一面。"))
    current = library.create_chapter(novel.id, dto.ChapterInput(title="问路", goal="林舟寻找客栈。"))
    with library.ws.session(write=True) as session:
        provider = session.get(Provider, "demo")
        provider.context_window, provider.max_output_tokens = 10000, 1000
    with library.ws.session() as session:
        context = build_context(session, novel.id, dto.ContextInput(task="continue",
            chapter_id=current.id, base_version_id=current.working_version_id))
    sent = json.loads(context["messages"][1]["content"])
    assert {item["id"] for item in context["preview"]["entities"]} == {hero.id}
    assert not context["preview"]["character_relations"]
    assert not sent.get("character_relations")
    assert context["preview"]["estimated_input_tokens"] <= 8200


def test_optional_relations_are_trimmed_with_their_entity_cards(library, generation):
    novel = library.create_novel(dto.NovelInput(title="关系预算同步"))
    people = [library.put_entity(novel.id, dto.EntityInput(kind="character", name=name))
        for name in ("甲某", "乙某", "丙某", "丁某")]
    for first, second in zip(people, people[1:], strict=False):
        library.create_relation(novel.id, dto.RelationInput(source_id=first.id,
            target_id=second.id, relation_type="旁支关系", description="无关的旧事。" * 300))
    current = library.create_chapter(novel.id, dto.ChapterInput(title="静室"))
    with library.ws.session(write=True) as session:
        provider = session.get(Provider, "demo")
        provider.context_window, provider.max_output_tokens = 7000, 1000
    with library.ws.session() as session:
        context = build_context(session, novel.id, dto.ContextInput(task="continue",
            chapter_id=current.id, base_version_id=current.working_version_id))
    included = {item["id"] for item in context["preview"]["entities"]}
    relations = context["preview"]["character_relations"]
    assert all(row["source_id"] in included and row["target_id"] in included for row in relations)
    assert len(relations) < 3
    sent = json.loads(context["messages"][1]["content"])
    assert len(sent.get("character_relations", [])) == len(relations)


def test_local_keyless_connection_can_check_and_create_but_cloud_still_requires_key(client, monkeypatch):
    original = httpx.AsyncClient
    reads = []

    def handle(request):
        reads.append(request)
        return httpx.Response(200, json={"data": [{"id": "local-test"}]})
    monkeypatch.setattr("app.providers.httpx.AsyncClient", lambda **kwargs: original(
        **kwargs, transport=httpx.MockTransport(handle)))
    for endpoint, local in (("http://127.0.0.1:11434/v1", True), ("https://provider.invalid/v1", False)):
        response = client.post("/api/v1/providers", json={"name": "测试连接", "base_url": endpoint,
            "model": "local-test"})
        assert response.status_code == 200
        provider = response.json()
        assert provider["requires_key"] is not local
        checked = client.post(f"/api/v1/providers/{provider['id']}/check")
        assert checked.status_code == (200 if local else 400)
        novel = client.post("/api/v1/novels", json={"title": "仅工程验证"}).json()
        chapter = client.post(f"/api/v1/novels/{novel['id']}/chapters", json={"title": "首章"}).json()
        created = client.post(f"/api/v1/novels/{novel['id']}/jobs", json={"task": "continue",
            "chapter_id": chapter["id"], "base_version_id": chapter["working_version_id"],
            "provider_id": provider["id"], "idempotency_key": uid("job")})
        assert created.status_code == (202 if local else 400)
    assert len(reads) == 1 and "authorization" not in reads[0].headers


def test_changing_endpoint_requires_fresh_credentials_and_keeps_old_connection_on_rejection(client):
    original = {"name": "原服务", "base_url": "https://first.invalid/v1", "model": "test-model"}
    provider = client.post("/api/v1/providers", json={**original, "api_key": "test-only-key"}).json()
    changed = {**original, "base_url": "https://second.invalid/v1"}
    response = client.put(f"/api/v1/providers/{provider['id']}", json=changed)
    assert response.status_code == 409
    assert response.json()["code"] == "PROVIDER_CREDENTIAL_SCOPE"
    stored = next(p for p in client.get("/api/v1/providers").json() if p["id"] == provider["id"])
    assert stored["base_url"] == original["base_url"] and stored["has_key"]
    cleared = client.put(f"/api/v1/providers/{provider['id']}", json={**changed, "clear_key": True})
    assert cleared.status_code == 200 and not cleared.json()["has_key"]


def test_provider_change_between_claim_and_dispatch_does_not_send_a_new_key_to_old_endpoint(library, generation, monkeypatch):
    novel = library.create_novel(dto.NovelInput(title="派发前连接变更"))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title="首章"))
    config = dto.ProviderInput(name="模拟连接", base_url="http://127.0.0.1:1234/v1", model="local-test",
        api_key="test-only-old-key")
    provider = generation.save_provider(config)
    job = generation.create(novel.id, dto.JobInput(task="continue", chapter_id=chapter.id,
        base_version_id=chapter.working_version_id, provider_id=provider.id, idempotency_key=uid("job")))
    claimed = generation.claim()
    generation.save_provider(dto.ProviderInput(name="模拟连接", base_url="http://127.0.0.1:5678/v1",
        model="local-test", api_key="test-only-new-key"), provider.id)
    calls = []

    async def complete(*args):
        calls.append(args)
        if False:
            yield
    monkeypatch.setattr("app.jobs.stream_completion", complete)
    asyncio.run(generation._execute(*claimed))
    result = generation.get(novel.id, job.id)
    assert result.state == "failed" and result.error_code == "PROVIDER_CHANGED"
    assert not calls


def test_short_selection_preview_uses_the_same_target_contract_as_the_toolbar(client):
    novel = client.post("/api/v1/novels", json={"title": "短选段"}).json()
    path = f"/api/v1/novels/{novel['id']}"
    chapter = client.post(path + "/chapters", json={"title": "首章"}).json()
    version = client.post(path + f"/chapters/{chapter['id']}/versions", json={
        "base_version_id": chapter["working_version_id"], "operation_id": uid("save"), "text": "他推开门。"}).json()
    body = {"task": "rewrite", "chapter_id": chapter["id"], "base_version_id": version["id"],
        "target_chars": 50, "selection": {"text": "他推开门。", "start_codepoint": 0, "end_codepoint": 5}}
    response = client.post(path + "/context", json=body)
    assert response.status_code == 200, response.text
    assert response.json()["target_chars"] == 50


@pytest.mark.parametrize("endpoint,local", [
    ("http://localhost:1234/v1", True), ("http://[::1]:1234/v1", True),
    ("http://127.0.0.1.example.com/v1", False), ("http://192.168.1.2:1234/v1", False),
])
def test_keyless_transport_is_limited_to_explicit_loopback_endpoints(monkeypatch, endpoint, local):
    original = httpx.AsyncClient
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(200, json={"choices": [{"message": {"content": "测试片段"}, "finish_reason": "stop"}]})
    monkeypatch.setattr("app.providers.httpx.AsyncClient", lambda **kwargs: original(
        **kwargs, transport=httpx.MockTransport(handle)))
    settings = {"kind": "compatible", "base_url": endpoint, "model": "local-test", "stream": False,
        "include_usage": False, "json_mode": False, "token_parameter": "max_tokens", "max_output_tokens": 100}

    async def run():
        return [part async for part in stream_completion(settings, "", [], "continue", {})]
    if local:
        assert asyncio.run(run())[0].text == "测试片段"
        assert "authorization" not in requests[0].headers
    else:
        with pytest.raises(ProviderFailure, match="密钥"):
            asyncio.run(run())
        assert not requests
