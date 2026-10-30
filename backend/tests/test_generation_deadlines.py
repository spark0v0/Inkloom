"""Short, in-process transports exercise deadlines without any external request."""
import asyncio
import json

import httpx
import pytest
from pydantic import SecretStr

from app import providers
from app import schemas as dto
from app.domain import uid


class PulseStream(httpx.AsyncByteStream):
    def __init__(self, mode):
        self.mode, self.closed = mode, False

    async def __aiter__(self):
        if self.mode == "non_stream":
            raw = json.dumps({"choices": [{"message": {"content": "完整正文"}, "finish_reason": "stop"}]}).encode()
            for byte in raw:
                await asyncio.sleep(.01)
                yield bytes([byte])
        else:
            for _ in range(30):
                await asyncio.sleep(.01)
                if self.mode == "text":
                    yield ('data: ' + json.dumps({"choices": [{"delta": {"content": "正文"}}]}) + '\n\n').encode()
                else:
                    yield b': heartbeat\n\n'
            yield b'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'

    async def aclose(self):
        self.closed = True


def transport(monkeypatch, mode):
    body, calls = PulseStream(mode), []
    original = httpx.AsyncClient

    def handle(request):
        calls.append(request)
        return httpx.Response(200, stream=body)
    monkeypatch.setattr(providers.httpx, "AsyncClient", lambda **kwargs: original(
        **kwargs, transport=httpx.MockTransport(handle)))
    return body, calls


@pytest.mark.parametrize("mode,code,total", [
    ("heartbeats", "NO_CONTENT_PROGRESS", 1),
    ("text", "REQUEST_TIMEOUT", .09),
    ("non_stream", "NO_CONTENT_PROGRESS", 1),
])
def test_generation_is_bounded_even_while_bytes_keep_arriving(monkeypatch, mode, code, total):
    body, calls = transport(monkeypatch, mode)
    config = {"kind": "compatible", "model": "test", "stream": mode != "non_stream",
        "include_usage": False, "json_mode": False, "token_parameter": "max_tokens",
        "max_output_tokens": 1000, "base_url": "https://provider.invalid/v1",
        "request_timeout_seconds": total, "progress_timeout_seconds": .05}

    async def run():
        return [part async for part in providers.stream_completion(config, "test-only", [], "continue", {})]
    with pytest.raises(providers.ProviderFailure) as error:
        asyncio.run(run())
    assert error.value.code == code
    assert error.value.uncertain is True
    assert body.closed
    assert len(calls) == 1


def test_timeout_preserves_partial_text_and_releases_worker_without_retry(library, generation, monkeypatch):
    body, calls = transport(monkeypatch, "text")
    monkeypatch.setattr(providers, "request_limits", lambda: {
        "request_timeout_seconds": .09, "progress_timeout_seconds": .05})
    provider = generation.save_provider(dto.ProviderInput(name="模拟服务", model="test",
        base_url="https://provider.invalid/v1", api_key=SecretStr("test-only")))
    novel = library.create_novel(dto.NovelInput(title="超时恢复"))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title="首章"))
    request = dto.JobInput(chapter_id=chapter.id, base_version_id=chapter.working_version_id,
        task="continue", provider_id=provider.id, idempotency_key=uid("job"))
    job = generation.create(novel.id, request)
    assert job.context.is_demo is False
    # A later configuration change must not extend an already-created request.
    monkeypatch.setattr(providers, "request_limits", lambda: {
        "request_timeout_seconds": 1, "progress_timeout_seconds": 1})
    asyncio.run(generation._execute(*generation.claim()))
    finished = generation.get(novel.id, job.id)
    assert finished.state == "interrupted_uncertain"
    assert finished.error_code == "REQUEST_TIMEOUT"
    assert finished.output_text and set(finished.output_text) <= set("正文")
    assert finished.attempt_count == 1
    assert finished.attempts[0].output_text == finished.output_text
    assert finished.cost is None
    assert generation.claim() is None
    assert len(calls) == 1 and body.closed
    assert library.chapter(novel.id, chapter.id).working_version_id == chapter.working_version_id
    # Another explicitly created task can be claimed after the failed call releases its slot.
    other = generation.create(novel.id, request.model_copy(update={"idempotency_key": uid("next")}))
    assert generation.claim()[0] == other.id
