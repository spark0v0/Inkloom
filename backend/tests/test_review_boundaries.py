import pytest

from app.domain import DomainError
from app.workspace_io import activate_restore, backup, restore


def test_entity_update_requires_baseline_and_preserves_concurrent_edit(client):
    novel = client.post('/api/v1/novels', json={'title': '档案冲突'}).json()
    path = f"/api/v1/novels/{novel['id']}/entities"
    initial = {'kind': 'character', 'name': '林舟', 'body': '旧档案', 'summary': '旧简介'}
    entity = client.post(path, json=initial).json()
    update_path = path + '/' + entity['id']
    assert client.put(update_path, json=initial).status_code == 422
    first = {**initial, 'body': 'A 保存的新档案', 'base_updated_at': entity['updated_at']}
    saved = client.put(update_path, json=first)
    assert saved.status_code == 200
    assert client.put(update_path, json=first).json()['updated_at'] == saved.json()['updated_at']
    second = {**initial, 'summary': 'B 尚未保存的简介', 'base_updated_at': entity['updated_at']}
    conflict = client.put(update_path, json=second)
    assert conflict.status_code == 409 and conflict.json()['code'] == 'ENTITY_CONFLICT'
    assert client.get(path).json()[0]['body'] == 'A 保存的新档案'
    second['base_updated_at'] = saved.json()['updated_at']
    assert client.put(update_path, json=second).status_code == 200


def test_old_workspace_requests_are_rejected_after_activation(client):
    original = client.get('/api/v1/health').json()['workspace_id']
    old_header = {'X-Inkloom-Workspace': original}
    client.post('/api/v1/novels', json={'title': '原工作区作品'}, headers=old_header)
    archive = client.get('/api/v1/workspace/backup', headers=old_header).content
    validated = client.post('/api/v1/workspace/restore', content=archive,
                            headers={**old_header, 'Content-Type': 'application/zip'}).json()
    switched = client.post('/api/v1/workspace/activate', json={'restore_id': validated['restore_id']}, headers=old_header)
    assert switched.status_code == 200
    current = switched.json()['workspace_id']
    assert current != original
    for method, path, kwargs in [
        ('get', '/api/v1/novels', {}),
        ('post', '/api/v1/novels', {'json': {'title': '迟到写入'}}),
        ('get', '/api/v1/workspace/backup', {}),
    ]:
        response = getattr(client, method)(path, headers=old_header, **kwargs)
        assert response.status_code == 409 and response.json()['code'] == 'WORKSPACE_CHANGED'
    assert client.get('/api/v1/health', headers=old_header).json()['workspace_id'] == current
    assert len(client.get('/api/v1/novels', headers={'X-Inkloom-Workspace': current}).json()) == 1
    assert len(client.get('/api/v1/novels').json()) == 1  # Legacy callers and context reset.


def test_backup_rejects_unrestorable_zip_and_small_backup_still_round_trips(workspace, monkeypatch):
    contents = backup(workspace)
    with monkeypatch.context() as limits:
        limits.setattr('app.workspace_io.MAX_ARCHIVE', 1)
        with pytest.raises(DomainError) as error:
            backup(workspace)
        assert error.value.code == 'BACKUP_TOO_LARGE'
    recovered = restore(workspace, contents)
    activate_restore(workspace, recovered['restore_id'])
    assert workspace.db.root != workspace.home
