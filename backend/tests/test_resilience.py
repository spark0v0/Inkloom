"""Deterministic transport/fault tests; no real credentials or external model requests."""
import asyncio
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from pydantic import SecretStr

from app import schemas as dto
from app.domain import DomainError, document_text, splice_document, uid
from app.models import Attempt, Job


@pytest.fixture
def protocol_server():
    state = {"mode": "success", "requests": [], "first": threading.Event(), "release": threading.Event()}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            state["requests"].append(body)
            if state["mode"] == "limited":
                self.send_response(429)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()

            def event(payload):
                self.wfile.write(("data: " + json.dumps(payload, ensure_ascii=False) + "\n\n").encode())
                self.wfile.flush()

            try:
                output = "只返回这段正文。" * 40 if state["mode"] != "bad_json" else '{"kind":"extract","changes":[{"claim":"假的","evidence":[{"source_id":"another-book","quote":"不存在"}]}]}'
                event({"choices": [{"delta": {"content": output, "reasoning_content": "not-manuscript"}, "finish_reason": None}]})
                state["first"].set()
                if state["mode"] == "slow":
                    state["release"].wait(5)
                if state["mode"] == "drop":
                    return
                event({"choices": [{"delta": {}, "finish_reason": "length" if state["mode"] == "length" else "stop"}]})
                if state["mode"] != "no_usage":
                    event({"choices": [], "usage": {"prompt_tokens": 120, "completion_tokens": 80, "total_tokens": 200}})
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    state["url"] = f"http://127.0.0.1:{server.server_port}/v1"
    yield state
    state["release"].set()
    server.shutdown()
    server.server_close()
    thread.join(timeout=2)


def prepare(library, generation, server=None, **request_options):
    novel = library.create_novel(dto.NovelInput(title="协议回归"))
    chapter = library.create_chapter(novel.id, dto.ChapterInput(title="第一章"))
    version = library.save(novel.id, chapter.id, dto.SaveInput(base_version_id=chapter.version.id,
        operation_id=uid("save"), text="😀林舟收起地图。"))
    provider = generation.save_provider(dto.ProviderInput(name="仅本机测试服务", base_url=server["url"],
        model="test-model", api_key=SecretStr("test-only-not-a-real-key"),
        input_price=2, output_price=4, price_date="2026-10-20")) if server else None
    request = dto.JobInput(chapter_id=chapter.id, base_version_id=version.id,
        provider_id=provider.id if provider else "demo", task=request_options.pop("task", "continue"),
        idempotency_key=uid("job"), **request_options)
    return novel, chapter, version, request, generation.create(novel.id, request)


def run_one(generation):
    claimed = generation.claim()
    assert claimed
    asyncio.run(generation._execute(*claimed))


def test_real_http_stream_usage_final_chunk_and_idempotency(library, generation, protocol_server):
    novel, chapter, version, request, job = prepare(library, generation, protocol_server)
    run_one(generation)
    result = generation.get(novel.id, job.id)
    assert result.state == "succeeded"
    assert result.output_text == "只返回这段正文。" * 40
    assert result.attempts[0].usage["total_tokens"] == 200
    assert result.cost == pytest.approx((120 * 2 + 80 * 4) / 1_000_000)
    assert generation.create(novel.id, request).id == job.id
    assert len(protocol_server["requests"]) == 1
    assert protocol_server["requests"][0]["stream_options"] == {"include_usage": True}
    assert library.chapter(novel.id, chapter.id).version.id == version.id
    events, _ = generation.events(novel.id, job.id, 0)
    replay, _ = generation.events(novel.id, job.id, events[1].seq)
    assert [e.seq for e in replay] == [e.seq for e in events[2:]]


@pytest.mark.parametrize(("mode", "state", "code"), [
    ("drop", "interrupted_uncertain", "STREAM_INTERRUPTED"),
    ("limited", "failed", "PROVIDER_HTTP_429"),
    ("length", "failed", "OUTPUT_TRUNCATED"),
    ("bad_json", "failed", "INVALID_STRUCTURED_OUTPUT"),
])
def test_protocol_failures_never_become_canon(library, generation, protocol_server, mode, state, code):
    protocol_server["mode"] = mode
    novel, _, _, _, job = prepare(library, generation, protocol_server,
        task="extract" if mode == "bad_json" else "continue", max_attempts=1)
    run_one(generation)
    result = generation.get(novel.id, job.id)
    assert (result.state, result.error_code) == (state, code)
    assert result.candidate_status == "partial"
    assert len(protocol_server["requests"]) == 1
    assert library.facts(novel.id) == []
    with pytest.raises(DomainError, match="最大调用次数"):
        generation.control(novel.id, job.id, "retry")
    with pytest.raises(DomainError):
        generation.adopt(novel.id, job.id, result.base_version_id)


def test_unknown_usage_stays_unknown_and_uncertain_budget_blocks_retry(library, generation, protocol_server):
    protocol_server["mode"] = "no_usage"
    novel, _, _, _, job = prepare(library, generation, protocol_server)
    run_one(generation)
    assert generation.get(novel.id, job.id).cost is None
    protocol_server["mode"] = "drop"
    novel, _, _, _, job = prepare(library, generation, protocol_server, max_cost=1)
    run_one(generation)
    with pytest.raises(DomainError) as error:
        generation.control(novel.id, job.id, "retry")
    assert error.value.code == "BUDGET_UNCERTAIN"
    assert len(protocol_server["requests"]) == 2


def test_cancel_after_http_dispatch_fences_delayed_completion(library, generation, protocol_server):
    protocol_server["mode"] = "slow"
    novel, chapter, version, _, job = prepare(library, generation, protocol_server)
    claimed = generation.claim()

    async def scenario():
        task = asyncio.create_task(generation._execute(*claimed))
        assert await asyncio.to_thread(protocol_server["first"].wait, 3)
        generation.control(novel.id, job.id, "cancel")
        protocol_server["release"].set()
        await task
    asyncio.run(scenario())
    result = generation.get(novel.id, job.id)
    assert result.state == "cancelled"
    assert result.candidate_status != "ready"
    assert library.chapter(novel.id, chapter.id).version.id == version.id
    assert len(protocol_server["requests"]) == 1


def test_prior_canon_edit_during_call_invalidates_candidate(library, generation):
    novel, first, version, _, first_job = prepare(library, generation)
    generation.control(novel.id, first_job.id, "cancel")
    library.confirm(novel.id, first.id, dto.CanonInput(version_id=version.id, operation_id=uid("canon")))
    second = library.create_chapter(novel.id, dto.ChapterInput(title="第二章"))
    job = generation.create(novel.id, dto.JobInput(chapter_id=second.id,
        base_version_id=second.version.id, task="continue", idempotency_key=uid("job")))
    claimed = generation.claim()
    library.save(novel.id, first.id, dto.SaveInput(base_version_id=version.id,
        operation_id=uid("save"), text="林舟没有收起地图。"))
    asyncio.run(generation._execute(*claimed))
    assert generation.get(novel.id, job.id).candidate_status == "needs_rebase"
    with pytest.raises(DomainError):
        generation.adopt(novel.id, job.id, second.version.id)


def test_expired_dispatched_lease_is_not_automatically_reissued(library, generation, workspace):
    novel, _, _, _, job = prepare(library, generation)
    claimed = generation.claim()
    with workspace.session(write=True) as session:
        row = session.get(Job, job.id)
        row.checkpoint, row.lease_until = "dispatched", time.time() - 1
    assert generation.claim() is None
    result = generation.get(novel.id, job.id)
    assert result.state == "interrupted_uncertain"
    assert result.attempt_count == 1
    asyncio.run(generation._execute(*claimed))
    assert generation.get(novel.id, job.id).state == "interrupted_uncertain"
    with workspace.session() as session:
        assert session.get(Attempt, claimed[2]).call_state == "interrupted_uncertain"


def test_persistence_fault_does_not_kill_worker_or_reissue(library, generation, monkeypatch):
    from app import jobs
    novel, _, _, _, job = prepare(library, generation)
    original = jobs.emit
    injected = False

    def fail_once(session, current, kind, data):
        nonlocal injected
        if kind == "delta" and not injected:
            injected = True
            raise OSError("simulated disk failure")
        return original(session, current, kind, data)
    monkeypatch.setattr(jobs, "emit", fail_once)

    async def scenario():
        worker = asyncio.create_task(generation.run())
        try:
            async with asyncio.timeout(6):
                while generation.get(novel.id, job.id).state in {"queued", "running"}:
                    await asyncio.sleep(.05)
            assert generation.get(novel.id, job.id).state == "interrupted_uncertain"
            other, _, _, _, next_job = prepare(library, generation)
            async with asyncio.timeout(6):
                while generation.get(other.id, next_job.id).state in {"queued", "running"}:
                    await asyncio.sleep(.05)
            assert generation.get(other.id, next_job.id).state == "succeeded"
            assert generation.get(novel.id, job.id).attempt_count == 1
        finally:
            worker.cancel()
            with pytest.raises(asyncio.CancelledError):
                await worker
    asyncio.run(scenario())


def test_same_book_concurrent_creates_only_one_active_task(library, generation):
    novel, chapter, version, _, initial = prepare(library, generation)
    generation.control(novel.id, initial.id, "cancel")
    def submit(_):
        try:
            return generation.create(novel.id, dto.JobInput(chapter_id=chapter.id,
                base_version_id=version.id, task="continue", idempotency_key=uid("job"))).id
        except DomainError as error:
            return error.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(submit, range(2)))
    assert results.count("JOB_ACTIVE") == 1
    assert len([j for j in generation.list(novel.id) if j.state == "queued"]) == 1


def test_rewrite_keeps_formatting_outside_selected_codepoints():
    doc = {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "😀林舟", "marks": [{"type": "bold"}]},
        {"type": "text", "text": "收起地图。"}]}, {"type": "paragraph", "content": [
        {"type": "text", "text": "第二段。", "marks": [{"type": "italic"}]}]}]}
    result = splice_document(doc, 3, 5, "打开")
    assert document_text(result) == "😀林舟打开地图。\n\n第二段。"
    assert result["content"][0]["content"][0]["marks"] == [{"type": "bold"}]
    assert result["content"][1]["content"][0]["marks"] == [{"type": "italic"}]
