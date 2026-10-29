"""All public novel edits share the same author-settings concurrency boundary."""


def test_public_novel_edit_requires_settings_baseline(client):
    novel = client.post('/api/v1/novels', json={'title': '作品编辑验收'}).json()
    path = f"/api/v1/novels/{novel['id']}"
    assert client.patch(path, json={'genre': '悬疑'}).status_code == 422
    assert client.get(path).json()['settings_revision'] == novel['settings_revision']


def test_novel_edit_preserves_new_style_and_noop_receipts(client):
    novel = client.post('/api/v1/novels', json={'title': '作品编辑验收', 'style': '旧文风'}).json()
    path = f"/api/v1/novels/{novel['id']}"
    styled = client.put(path + '/writing-style', json={
        'base_settings_revision': novel['settings_revision'], 'style': '新文风'}).json()
    stale = client.patch(path, json={'base_settings_revision': novel['settings_revision'],
        'genre': '悬疑', 'style': '旧文风'})
    assert stale.status_code == 409
    assert stale.json()['code'] == 'NOVEL_CONFLICT'
    changed = client.patch(path, json={'base_settings_revision': styled['settings_revision'], 'genre': '悬疑'})
    assert changed.status_code == 200
    current = changed.json()
    assert current['style'] == '新文风'
    assert current['settings_revision'] == styled['settings_revision'] + 1
    same = client.patch(path, json={'base_settings_revision': styled['settings_revision'], 'genre': '悬疑'})
    assert same.status_code == 200
    assert same.json()['settings_revision'] == current['settings_revision']
    assert client.patch(path, json={'base_settings_revision': styled['settings_revision'],
        'archived': True}).status_code == 409
    archived = client.patch(path, json={'base_settings_revision': current['settings_revision'], 'archived': True})
    assert archived.status_code == 200
    assert archived.json()['archived'] is True
    assert archived.json()['style'] == '新文风'


def test_novel_rename_advances_linked_plan_baseline(client):
    novel = client.post('/api/v1/novels', json={'title': '旧作品名'}).json()
    path = f"/api/v1/novels/{novel['id']}"
    plan = client.post(path + '/plans', json={'level': 'book', 'title': '旧作品名', 'body': '原全书安排'}).json()
    base = client.get(path).json()['settings_revision']
    renamed = client.patch(path, json={'base_settings_revision': base, 'title': '新作品名'})
    assert renamed.status_code == 200
    current = client.get(path + '/plans/' + plan['id']).json()
    assert current['title'] == '新作品名'
    assert current['updated_at'] != plan['updated_at']
    stale = client.put(path + '/plans/' + plan['id'], json={'level': 'book',
        'title': plan['title'], 'body': '旧窗口的安排', 'base_updated_at': plan['updated_at']})
    assert stale.status_code == 409
    assert client.get(path + '/plans/' + plan['id']).json()['title'] == '新作品名'
