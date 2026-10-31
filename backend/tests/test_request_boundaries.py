import asyncio

import pytest

from app.main import LocalSessionMiddleware


def run_request(chunks, *, extra_headers=(), cookie=b"valid-test-session"):
    received = 0
    downstream = []
    messages = []

    async def receive():
        nonlocal received
        if received < len(chunks):
            body = chunks[received]
            received += 1
            return {"type": "http.request", "body": body, "more_body": received < len(chunks)}
        await asyncio.sleep(0)
        return {"type": "http.disconnect"}

    async def endpoint(scope, receive, send):
        body = bytearray()
        while True:
            message = await receive()
            body.extend(message.get("body", b""))
            if not message.get("more_body", False):
                break
        downstream.append(bytes(body))
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": bytes(body)})

    async def send(message):
        messages.append(message)

    scope = {
        "type": "http", "asgi": {"version": "3.0", "spec_version": "2.4"},
        "http_version": "1.1", "method": "POST", "scheme": "http",
        "path": "/api/v1/novels", "raw_path": b"/api/v1/novels", "query_string": b"",
        "root_path": "", "server": ("127.0.0.1", 8765), "client": ("127.0.0.1", 1234),
        "headers": [(b"host", b"127.0.0.1:8765"), (b"origin", b"http://127.0.0.1:8765"),
                    (b"cookie", b"story_session=" + cookie), *extra_headers],
    }
    middleware = LocalSessionMiddleware(endpoint, session_token="valid-test-session", port=8765)
    asyncio.run(middleware(scope, receive, send))
    return received, downstream, messages


@pytest.mark.parametrize("headers", [(), ((b"content-length", b"1"),)])
def test_body_limit_stops_reading_chunked_or_underdeclared_payload(headers):
    received, downstream, messages = run_request([b"x" * (3 * 1024 * 1024)] * 4,
                                                  extra_headers=headers)
    assert messages[0]["status"] == 413
    assert received == 3  # Stop at the first chunk that crosses 8 MiB.
    assert downstream == []


def test_bounded_body_is_replayed_unchanged_to_the_endpoint():
    body = '{"title":"边界测试"}'.encode()
    received, downstream, messages = run_request([body[:5], body[5:]])
    assert received == 2
    assert downstream == [body]
    assert messages[0]["status"] == 200
    assert (b"cache-control", b"no-store") in messages[0]["headers"]


def test_non_ascii_session_is_rejected_before_reading_body():
    received, downstream, messages = run_request([b"secret body"], cookie=b"\xc3\xa9")
    assert messages[0]["status"] == 401
    assert received == 0
    assert downstream == []
