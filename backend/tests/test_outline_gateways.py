"""Late receipts and secondary editing routes cannot replace newer author work."""
import asyncio

from app.domain import uid
from app.providers import StreamPart, demo_text


def setup(client):
    novel = client.post('/api/v1/novels', json={'title': '回执与编辑入口验收'}).json()
    chapter = client.post(f"/api/v1/novels/{novel['id']}/chapters", json={'title': '第1章'}).json()
    path = f"/api/v1/novels/{novel['id']}/chapters/{chapter['id']}"
    return novel, chapter, path


def save(client, path, base, goal, operation=None):
    current = client.get(path + '/outline').json()
    body = {'base_revision': base, 'operation_id': operation or uid('save'),
        'document': {**current['document'], 'goal': goal}}
    response = client.put(path + '/outline', json=body)
    assert response.status_code == 200
    return body, response.json()


def test_late_save_and_restore_receipts_return_current_state(client):
    _novel, _chapter, path = setup(client)
    first, _ = save(client, path, 0, 'A 的目标')
    _, newer = save(client, path, 1, 'B 后保存的目标')
    receipt = client.put(path + '/outline', json=first).json()
    assert receipt['revision'] == newer['revision']
    assert receipt['document'] == newer['document']
    assert receipt['operation_revision'] == 1
    request = {'base_revision': 2, 'operation_id': uid('restore')}
    restored = client.post(path + '/outline/history/0/restore', json=request)
    assert restored.status_code == 200
    _, newest = save(client, path, 3, '恢复之后的新目标')
    receipt = client.post(path + '/outline/history/0/restore', json=request).json()
    assert receipt['revision'] == newest['revision'] and receipt['document'] == newest['document']
    assert receipt['operation_revision'] == 3


def test_secondary_http_routes_require_baselines(client):
    novel, _chapter, path = setup(client)
    save(client, path, 0, '已保存的结构化目标')
    assert client.patch(path, json={'title': '缺少基线的改名'}).status_code == 422
    plan = client.get(f"/api/v1/novels/{novel['id']}/plans").json()[0]
    body = {key: plan[key] for key in ('title', 'body', 'level')}
    body['body'] = '缺少基线的旧入口改纲'
    assert client.put(f"/api/v1/novels/{novel['id']}/plans/{plan['id']}", json=body).status_code == 422
    assert client.get(path + '/outline').json()['document']['goal'] == '已保存的结构化目标'


def test_secondary_routes_reject_stale_bases_but_prose_save_does_not_block_metadata(client):
    novel, chapter, path = setup(client)
    save(client, path, 0, '初始目标')
    plan = client.get(f"/api/v1/novels/{novel['id']}/plans").json()[0]
    save(client, path, 1, '别的窗口更新的目标')
    stale = client.patch(path, json={'title': '旧窗口改名', 'base_outline_revision': 1, 'base_volume': chapter['volume']})
    assert stale.status_code == 409 and stale.json()['code'] == 'CHAPTER_CONFLICT'
    stale_plan = client.put(f"/api/v1/novels/{novel['id']}/plans/{plan['id']}", json={
        **{key: plan[key] for key in ('title', 'body', 'level')}, 'title': '旧规划改名', 'base_updated_at': plan['updated_at']})
    assert stale_plan.status_code == 409 and stale_plan.json()['code'] == 'PLAN_CONFLICT'
    saved = client.post(path + '/versions', json={'base_version_id': chapter['working_version_id'], 'operation_id': uid('prose'), 'text': '新写下的正文。'})
    assert saved.status_code == 200
    current = client.get(path).json()
    renamed = client.patch(path, json={'title': '合法改名', 'base_outline_revision': current['outline_revision'], 'base_volume': current['volume']})
    assert renamed.status_code == 200
    assert renamed.json()['goal'] == current['goal'] and renamed.json()['version']['text'] == '新写下的正文。'
    same = client.patch(path, json={'title': '合法改名', 'base_outline_revision': current['outline_revision'], 'base_volume': current['volume']})
    assert same.status_code == 200  # Acknowledgement replay, no additional mutation.


def test_late_ai_adoption_receipt_returns_latest_outline(client, monkeypatch):
    novel, chapter, path = setup(client)
    save(client, path, 0, '初始目标')
    async def complete(_config, _key, _messages, task, context):
        yield StreamPart(text=demo_text(task, context))
        yield StreamPart(finish='stop')
    monkeypatch.setattr('app.jobs.stream_completion', complete)
    generation = client.app.state.generation
    created = client.post(f"/api/v1/novels/{novel['id']}/jobs", json={'task': 'outline_edit',
        'chapter_id': chapter['id'], 'base_version_id': chapter['working_version_id'],
        'outline_edit': {'base_revision': 1, 'fields': ['goal']}, 'idempotency_key': uid('job')})
    assert created.status_code == 202
    asyncio.run(generation._execute(*generation.claim()))
    job_id = created.json()['id']
    target = f"/api/v1/jobs/{job_id}/apply-outline-edit?novel_id={novel['id']}"
    body = {'base_revision': 1, 'operation_id': uid('adopt'), 'fields': ['goal']}
    assert client.post(target, json=body).status_code == 200
    _, newer = save(client, path, 2, 'AI 采纳后另存的新目标')
    receipt = client.post(target, json=body).json()
    assert receipt['revision'] == newer['revision'] and receipt['document'] == newer['document']
    assert receipt['operation_revision'] == 2
