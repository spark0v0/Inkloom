def test_local_session_and_cross_site_security(client):
    assert client.post('/api/v1/novels', json={'title': '可保存作品'}).status_code == 201
    forbidden = client.post('/api/v1/novels', json={'title': '外站写入'},
                            headers={'Origin': 'https://example.com'})
    assert forbidden.status_code == 403
    assert client.get('/api/v1/novels', headers={'Host': 'evil.example:8765'}).status_code == 403
    assert client.post('/api/v1/novels', json={'title': ''}).status_code == 422


def test_provider_validation_never_echoes_credentials(client):
    canary = 'fake-key-that-must-never-appear-in-response'
    response = client.post('/api/v1/providers', json={
        'name': '测试服务', 'base_url': 'https://example.com/v1', 'model': 'test',
        'api_key': canary, 'max_output_tokens': -1})
    assert response.status_code == 422
    assert canary not in response.text


def test_manual_create_save_export_and_reopen(client):
    novel = client.post('/api/v1/novels', json={'title': '我的第一本'}).json()
    prefix = '/api/v1/novels/' + novel['id']
    chapter = client.post(prefix + '/chapters', json={'title': '第一章 出发'}).json()
    response = client.post(prefix + '/chapters/' + chapter['id'] + '/versions', json={
        'base_version_id': chapter['working_version_id'], 'operation_id': 'save-request-001',
        'text': '新的故事从这里开始。😀'})
    assert response.status_code == 200, response.text
    reopened = client.get(prefix + '/chapters/' + chapter['id']).json()
    assert reopened['version']['text'] == '新的故事从这里开始。😀'
    exported = client.get(prefix + '/export?format=md')
    assert exported.status_code == 200
    assert '新的故事从这里开始。😀' in exported.text
