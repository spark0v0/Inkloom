"""Provider catalog and transport boundaries, using only in-process HTTP mocks."""
import asyncio
import json

import httpx
import pytest

from app import providers


def mock_http(monkeypatch, handler):
    original = httpx.AsyncClient
    monkeypatch.setattr(providers.httpx, "AsyncClient", lambda **kwargs: original(
        **kwargs, transport=httpx.MockTransport(handler)))


def connection(client):
    response = client.post('/api/v1/providers', json={
        'name': '模拟服务', 'base_url': 'https://provider.invalid/v1', 'model': 'model-b',
        'api_key': 'test-only-not-a-real-key'})
    assert response.status_code == 200, response.text
    return response.json()['id']


def test_missing_provider_is_not_successful_demo(client):
    response = client.post('/api/v1/providers/missing/check')
    assert response.status_code == 404
    assert response.json()['code'] == 'PROVIDER_NOT_FOUND'
    assert client.post('/api/v1/providers/demo/check').json()['reachable'] is True


@pytest.mark.parametrize('payload', [[], {'data': None}, {'data': 'not-a-list'}])
def test_invalid_catalog_returns_safe_error(client, monkeypatch, payload):
    provider_id = connection(client)
    mock_http(monkeypatch, lambda _: httpx.Response(200, json=payload))
    response = client.post(f'/api/v1/providers/{provider_id}/check')
    assert response.status_code == 400
    assert response.json()['code'] == 'PROVIDER_CHECK_FAILED'
    assert 'test-only' not in response.text


def test_model_catalog_returns_deduplicated_choices_without_generation(client, monkeypatch):
    provider_id = connection(client)
    requests = []

    def handle(request):
        requests.append((request.method, request.url.path))
        return httpx.Response(200, json={'data': [
            {'id': 'model-b'}, {'id': 'model-a'}, {'id': 'model-b'}, {'id': ''}, None]})
    mock_http(monkeypatch, handle)
    result = client.post(f'/api/v1/providers/{provider_id}/check').json()
    assert result['models'] == ['model-a', 'model-b']
    assert result['model_listed'] is True
    assert requests == [('GET', '/v1/models')]


class Chunks(httpx.AsyncByteStream):
    def __init__(self, chunks):
        self.chunks, self.consumed, self.closed = chunks, 0, False

    async def __aiter__(self):
        for chunk in self.chunks:
            self.consumed += 1
            yield chunk

    async def aclose(self):
        self.closed = True


def config(stream=False):
    return {'kind': 'compatible', 'model': 'test-model', 'stream': stream, 'include_usage': True,
            'json_mode': False, 'token_parameter': 'max_tokens', 'max_output_tokens': 1000,
            'base_url': 'https://provider.invalid/v1'}


def collect(settings):
    async def run():
        return [part async for part in providers.stream_completion(settings, 'test-only', [], 'continue', {})]
    return asyncio.run(run())


@pytest.mark.parametrize('task,json_mode,expected', [
    ('inspiration', True, True), ('discuss', True, True),
    ('review', True, True), ('continue', True, False), ('inspiration', False, False),
])
def test_structured_tasks_share_json_wire_contract(monkeypatch, task, json_mode, expected):
    payloads = []

    def handle(request):
        payloads.append(json.loads(request.content))
        return httpx.Response(200, json={'choices': [{'message': {'content': '{}'}, 'finish_reason': 'stop'}]})
    mock_http(monkeypatch, handle)
    settings = {**config(), 'json_mode': json_mode}

    async def run():
        return [part async for part in providers.stream_completion(settings, 'test-only', [], task, {})]
    asyncio.run(run())
    assert len(payloads) == 1
    assert ('response_format' in payloads[0]) == expected
    if expected:
        assert payloads[0]['response_format'] == {'type': 'json_object'}


def test_non_streaming_stops_reading_when_size_limit_is_reached(monkeypatch):
    body = Chunks([b'x' * 600_000] * 12)
    mock_http(monkeypatch, lambda _: httpx.Response(200, stream=body))
    with pytest.raises(providers.ProviderFailure) as error:
        collect(config())
    assert error.value.code == 'RESPONSE_TOO_LARGE'
    assert error.value.uncertain is True
    assert body.consumed < 12
    assert body.closed


@pytest.mark.parametrize('payload', [[], {'choices': [None]}, {'choices': [{'message': []}]}])
def test_malformed_completion_is_classified_without_parser_crash(monkeypatch, payload):
    mock_http(monkeypatch, lambda _: httpx.Response(200, json=payload))
    with pytest.raises(providers.ProviderFailure) as error:
        collect(config())
    assert error.value.code == 'INVALID_RESPONSE'
    assert error.value.uncertain is True


def test_unterminated_multiline_event_is_bounded(monkeypatch):
    body = Chunks([b'data: ' + b'x' * 200_000 + b'\n'] * 12)
    mock_http(monkeypatch, lambda _: httpx.Response(200, stream=body))
    with pytest.raises(providers.ProviderFailure) as error:
        collect(config(True))
    assert error.value.code == 'RESPONSE_TOO_LARGE'
    assert body.consumed < 12
    assert body.closed


def test_stream_preserves_split_unicode_crlf_and_final_usage(monkeypatch):
    data = 'data: ' + json.dumps({'choices': [{'delta': {'content': '林舟😀'}, 'finish_reason': 'stop'}]}, ensure_ascii=False)
    raw = (data + '\r\n\r\ndata: {"choices":[],"usage":{"total_tokens":12}}\r\n\r\ndata: [DONE]\r\n\r\n').encode()
    body = Chunks([raw[i:i + 1] for i in range(len(raw))])
    mock_http(monkeypatch, lambda _: httpx.Response(200, stream=body))
    parts = collect(config(True))
    assert ''.join(part.text for part in parts) == '林舟😀'
    assert parts[-1].usage == {'total_tokens': 12}
    assert body.closed


def test_catalog_stops_reading_oversized_response(client, monkeypatch):
    provider_id = connection(client)
    body = Chunks([b'x' * 600_000] * 12)
    mock_http(monkeypatch, lambda _: httpx.Response(200, stream=body))
    response = client.post(f'/api/v1/providers/{provider_id}/check')
    assert response.status_code == 400
    assert response.json()['code'] == 'PROVIDER_CHECK_FAILED'
    assert body.consumed < 12
    assert body.closed


def test_catalog_redirect_does_not_send_key_to_another_host(client, monkeypatch):
    provider_id = connection(client)
    visited = []

    def handle(request):
        visited.append(request.url.host)
        return httpx.Response(302, headers={'location': 'https://other.invalid/models'})
    mock_http(monkeypatch, handle)
    response = client.post(f'/api/v1/providers/{provider_id}/check')
    assert response.status_code == 400
    assert visited == ['provider.invalid']
    assert 'test-only-not-a-real-key' not in response.text


@pytest.mark.parametrize('endpoint', ['http://[broken', 'https://example.com:bad/v1',
                                    'https://example.com:99999/v1', 'http://bad host/v1'])
def test_invalid_endpoint_is_reported_without_server_error(client, endpoint):
    response = client.post('/api/v1/providers', json={
        'name': '无效地址', 'base_url': endpoint, 'model': 'test'})
    assert response.status_code == 400
    assert response.json()['code'] == 'INVALID_ENDPOINT'


def test_catalog_truncation_is_explicit_and_membership_uses_full_list(client, monkeypatch):
    provider_id = connection(client)
    mock_http(monkeypatch, lambda _: httpx.Response(200, json={
        'data': [{'id': f'a-model-{i:04d}'} for i in range(1001)] + [{'id': 'model-b'}]}))
    response = client.post(f'/api/v1/providers/{provider_id}/check').json()
    assert len(response['models']) == 1000
    assert response['models_truncated'] is True
    assert response['model_listed'] is True
