"""Local-only HTTP application. Every write is guarded before reading its payload."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Annotated
from urllib.parse import quote, urlsplit

from fastapi import FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import SQLAlchemyError
from starlette.datastructures import MutableHeaders
from starlette.requests import ClientDisconnect
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import schemas as dto
from .chapter_outlines import ChapterOutlines
from .discussions import Discussions
from .domain import TERMINAL_JOB_STATES, DomainError, split_manuscript
from .jobs import Generation
from .library import Library
from .references import ChapterReferences
from .seed import create_demo
from .storage import PROJECT_DIR, Workspace, expected_workspace
from .threads import ThreadTracking
from .workspace_io import MAX_ARCHIVE, activate_original, activate_restore, backup, restore
from .writing_preferences import save_writing_style

logger = logging.getLogger("story_workshop")


class LocalSessionMiddleware:
    def __init__(self, app: ASGIApp, session_token: str, port: int):
        self.app = app
        self.token = session_token
        self.allowed_ports = {port, 5173, 4173}
        cookie = Response()
        cookie.set_cookie("story_session", self.token, httponly=True, samesite="strict", path="/api")
        self.cookie_header = cookie.headers["set-cookie"]

    def local_url(self, value: str, origin: bool = False) -> bool:
        try:
            parsed = urlsplit(value if origin else "http://" + value)
            return (parsed.hostname in {"127.0.0.1", "localhost", "::1"}
                    and (parsed.port or 80) in self.allowed_ports
                    and (not origin or parsed.scheme == "http"))
        except ValueError:
            return False

    def authorize(self, request: Request) -> Response | None:
        if not self.local_url(request.headers.get("host", "")):
            return JSONResponse({"code": "INVALID_HOST", "message": "仅允许本机工作区地址。", "details": {}}, status_code=403)
        if not request.url.path.startswith("/api/"):
            return None
        origin = request.headers.get("origin")
        if origin is not None and not self.local_url(origin, True):
            return JSONResponse({"code": "INVALID_ORIGIN", "message": "不允许此网页访问本机工作区。", "details": {}}, status_code=403)
        if request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse({"code": "CROSS_SITE_REQUEST", "message": "已阻止跨站访问。", "details": {}}, status_code=403)
        bootstrap = request.method == "GET" and request.url.path == "/api/v1/health"
        cookie = request.cookies.get("story_session", "")
        if not bootstrap and (not cookie.isascii() or not secrets.compare_digest(cookie, self.token)):
            return JSONResponse({"code": "SESSION_REQUIRED", "message": "本地会话已更新，请刷新页面。", "details": {}}, status_code=401)
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            if not origin or not self.local_url(origin, True):
                return JSONResponse({"code": "ORIGIN_REQUIRED", "message": "写入操作需要本地页面来源。", "details": {}}, status_code=403)
        return None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request = Request(scope, receive)
        if denied := self.authorize(request):
            await denied(scope, receive, send)
            return
        if not request.url.path.startswith("/api/"):
            await self.app(scope, receive, send)
            return

        body_receive = receive
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            maximum = MAX_ARCHIVE if request.url.path == "/api/v1/workspace/restore" else 8 * 1024 * 1024
            try:
                declared = int(request.headers.get("content-length", "0"))
            except ValueError:
                declared = maximum + 1
            too_large = JSONResponse({"code": "BODY_TOO_LARGE", "message": "请求内容超过限制。", "details": {}}, status_code=413)
            if declared < 0 or declared > maximum:
                await too_large(scope, receive, send)
                return
            buffered = bytearray()
            size = 0
            try:
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > maximum:
                        await too_large(scope, receive, send)
                        return
                    buffered.extend(chunk)
            except ClientDisconnect:
                return  # The author disconnected before a complete write was received.
            body = bytes(buffered)
            replayed = False

            async def body_receive() -> Message:
                nonlocal replayed
                if not replayed:
                    replayed = True
                    return {"type": "http.request", "body": body, "more_body": False}
                return await receive()

        bootstrap = request.method == "GET" and request.url.path == "/api/v1/health"

        async def send_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Content-Type-Options"] = "nosniff"
                headers["Cache-Control"] = "no-store"
                if bootstrap:
                    headers.append("set-cookie", self.cookie_header)
            await send(message)

        token = expected_workspace.set(None if bootstrap else request.headers.get("x-inkloom-workspace"))
        try:
            await self.app(scope, body_receive, send_headers)
        finally:
            expected_workspace.reset(token)


def create_app(data_dir: Path | None = None, *, worker: bool = True, port: int = 8765) -> FastAPI:
    root = data_dir or Path(os.environ.get("STORY_WORKSHOP_DATA_DIR", str(PROJECT_DIR / "data")))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        workspace = Workspace(root)
        app.state.workspace = workspace
        app.state.library = Library(workspace)
        app.state.references = ChapterReferences(workspace)
        app.state.threads = ThreadTracking(workspace)
        app.state.outlines = ChapterOutlines(workspace)
        app.state.discussions = Discussions(workspace)
        app.state.generation = Generation(workspace)
        task = asyncio.create_task(app.state.generation.run()) if worker else None
        app.state.worker_task = task
        try:
            yield
        finally:
            if task:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
            workspace.close()

    app = FastAPI(title="Inkloom API", version="0.2.0", lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(LocalSessionMiddleware, session_token=secrets.token_urlsafe(40), port=port)

    @app.exception_handler(DomainError)
    async def domain_error(_: Request, exc: DomainError):
        return JSONResponse({"code": exc.code, "message": exc.message, "details": exc.details}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, exc: RequestValidationError):
        # Never echo input values: a malformed provider form may contain a real credential.
        fields = [".".join(map(str, item["loc"])) for item in exc.errors()]
        return JSONResponse({"code": "VALIDATION_ERROR", "message": "输入格式不正确，请检查相关字段。",
                             "details": {"fields": fields}}, status_code=422)

    @app.exception_handler(SQLAlchemyError)
    async def database_error(_: Request, exc: SQLAlchemyError):
        logger.error("Database operation failed (%s)", type(exc).__name__)
        return JSONResponse({"code": "WORKSPACE_STORAGE_ERROR", "message": "工作区写入或读取失败，内容未确认保存。请检查磁盘与权限。",
                             "details": {"retryable": True}}, status_code=503)

    prefix = "/api/v1"

    @app.put(prefix + "/novels/{novel_id}/writing-style", response_model=dto.NovelOut)
    def writing_style(novel_id: str, data: dto.WritingStyleInput, request: Request):
        return save_writing_style(request.app.state.workspace, novel_id, data)

    @app.get(prefix + "/health", response_model=dto.HealthOut)
    def health(request: Request):
        ws = request.app.state.workspace
        task = request.app.state.worker_task
        return dto.HealthOut(status="ok" if task is None or not task.done() else "worker_unavailable",
            workspace_id=ws.db.workspace_id, workspace_name=ws.db.root.name, version="0.2.0",
            is_restored=ws.db.root != ws.home)

    @app.get(prefix + "/novels", response_model=list[dto.NovelOut])
    def list_novels(request: Request, archived: bool = False):
        return request.app.state.library.novels(archived)

    @app.post(prefix + "/novels", response_model=dto.NovelOut, status_code=201)
    def create_novel(data: dto.NovelInput, request: Request):
        return request.app.state.library.create_novel(data)

    @app.post(prefix + "/demo", response_model=dto.NovelOut)
    def seed_demo(request: Request):
        return create_demo(request.app.state.library)

    @app.get(prefix + "/novels/{novel_id}", response_model=dto.NovelOut)
    def get_novel(novel_id: str, request: Request):
        return request.app.state.library.novel(novel_id)

    @app.patch(prefix + "/novels/{novel_id}", response_model=dto.NovelOut)
    def edit_novel(novel_id: str, data: dto.NovelUpdate, request: Request):
        return request.app.state.library.edit_novel(novel_id, data)

    @app.get(prefix + "/novels/{novel_id}/chapters", response_model=list[dto.ChapterSummary])
    def chapters(novel_id: str, request: Request):
        return request.app.state.library.chapters(novel_id)

    @app.post(prefix + "/novels/{novel_id}/chapters", response_model=dto.ChapterOut, status_code=201)
    def create_chapter(novel_id: str, data: dto.ChapterInput, request: Request):
        return request.app.state.library.create_chapter(novel_id, data)

    @app.get(prefix + "/novels/{novel_id}/chapters/{chapter_id}", response_model=dto.ChapterOut)
    def get_chapter(novel_id: str, chapter_id: str, request: Request):
        return request.app.state.library.chapter(novel_id, chapter_id)

    @app.patch(prefix + "/novels/{novel_id}/chapters/{chapter_id}", response_model=dto.ChapterOut)
    def edit_chapter(novel_id: str, chapter_id: str, data: dto.ChapterUpdate, request: Request):
        return request.app.state.library.edit_chapter(novel_id, chapter_id, data)

    @app.get(prefix + "/novels/{novel_id}/chapters/{chapter_id}/references", response_model=dto.ReferenceState)
    def get_references(novel_id: str, chapter_id: str, request: Request):
        return request.app.state.references.get(novel_id, chapter_id)

    @app.get(prefix + "/novels/{novel_id}/chapters/{chapter_id}/outline", response_model=dto.OutlineState)
    def chapter_outline(novel_id: str, chapter_id: str, request: Request):
        return request.app.state.outlines.get(novel_id, chapter_id)

    @app.put(prefix + "/novels/{novel_id}/chapters/{chapter_id}/outline", response_model=dto.OutlineState)
    def save_outline(novel_id: str, chapter_id: str, data: dto.OutlineUpdate, request: Request):
        return request.app.state.outlines.save(novel_id, chapter_id, data)

    @app.get(prefix + "/novels/{novel_id}/chapters/{chapter_id}/outline/history", response_model=dto.OutlineHistoryPage)
    def outline_history(novel_id: str, chapter_id: str, request: Request, before: int | None = Query(default=None, ge=0)):
        return request.app.state.outlines.history(novel_id, chapter_id, before)

    @app.get(prefix + "/novels/{novel_id}/chapters/{chapter_id}/outline/history/{revision}", response_model=dto.OutlineRevisionOut)
    def outline_revision(novel_id: str, chapter_id: str, revision: int, request: Request):
        return request.app.state.outlines.revision(novel_id, chapter_id, revision)

    @app.post(prefix + "/novels/{novel_id}/chapters/{chapter_id}/outline/history/{revision}/restore", response_model=dto.OutlineState)
    def restore_outline(novel_id: str, chapter_id: str, revision: int, data: dto.OutlineRestoreInput, request: Request):
        return request.app.state.outlines.restore(novel_id, chapter_id, revision, data)

    @app.put(prefix + "/novels/{novel_id}/chapters/{chapter_id}/references", response_model=dto.ReferenceState)
    def save_references(novel_id: str, chapter_id: str, data: dto.ReferenceUpdate, request: Request):
        return request.app.state.references.save(novel_id, chapter_id, data)

    @app.post(prefix + "/novels/{novel_id}/chapters/{chapter_id}/versions", response_model=dto.VersionOut)
    def save_version(novel_id: str, chapter_id: str, data: dto.SaveInput, request: Request):
        return request.app.state.library.save(novel_id, chapter_id, data)

    @app.get(prefix + "/novels/{novel_id}/chapters/{chapter_id}/versions", response_model=list[dto.VersionSummary])
    def list_versions(novel_id: str, chapter_id: str, request: Request):
        return request.app.state.library.versions(novel_id, chapter_id)

    @app.get(prefix + "/novels/{novel_id}/chapters/{chapter_id}/versions-page", response_model=dto.VersionHistoryPage)
    def version_history(novel_id: str, chapter_id: str, request: Request,
                        before: str | None = Query(default=None, min_length=1, max_length=160)):
        return request.app.state.library.version_history(novel_id, chapter_id, before)

    @app.get(prefix + "/novels/{novel_id}/chapters/{chapter_id}/versions/{version_id}", response_model=dto.VersionOut)
    def get_version(novel_id: str, chapter_id: str, version_id: str, request: Request):
        return request.app.state.library.version(novel_id, chapter_id, version_id)

    @app.get(prefix + "/novels/{novel_id}/chapters/{chapter_id}/canon", response_model=dto.CanonPreparation)
    def prepare_canon(novel_id: str, chapter_id: str, request: Request):
        return request.app.state.library.prepare_canon(novel_id, chapter_id)

    @app.get(prefix + "/novels/{novel_id}/review-impact", response_model=dto.ReviewImpactPage)
    def review_impact(novel_id: str, request: Request, after: int = Query(default=0, ge=0),
                      fingerprint: str | None = Query(default=None, max_length=64),
                      limit: int = Query(default=30, ge=1, le=50)):
        from .review_impact import review_impact as read_impact
        with request.app.state.workspace.session() as session:
            return read_impact(session, novel_id, after, fingerprint, limit)

    @app.post(prefix + "/novels/{novel_id}/chapters/{chapter_id}/canon", response_model=dto.CanonOut)
    def confirm(novel_id: str, chapter_id: str, data: dto.CanonInput, request: Request):
        return request.app.state.library.confirm(novel_id, chapter_id, data)

    @app.get(prefix + "/novels/{novel_id}/entities", response_model=list[dto.EntityOut])
    def entities(novel_id: str, request: Request):
        return request.app.state.library.entities(novel_id)

    @app.post(prefix + "/novels/{novel_id}/entities", response_model=dto.EntityOut)
    def create_entity(novel_id: str, data: dto.EntityInput, request: Request):
        return request.app.state.library.put_entity(novel_id, data)

    @app.put(prefix + "/novels/{novel_id}/entities/{entity_id}", response_model=dto.EntityOut)
    def edit_entity(novel_id: str, entity_id: str, data: dto.EntityUpdate, request: Request):
        return request.app.state.library.put_entity(novel_id, data, entity_id)

    @app.get(prefix + "/novels/{novel_id}/relations", response_model=list[dto.RelationOut])
    def relations(novel_id: str, request: Request, entity_id: str | None = None):
        return request.app.state.library.relations(novel_id, entity_id)

    @app.post(prefix + "/novels/{novel_id}/relations", response_model=dto.RelationOut)
    def create_relation(novel_id: str, data: dto.RelationInput, request: Request):
        return request.app.state.library.create_relation(novel_id, data)

    @app.put(prefix + "/novels/{novel_id}/relations/{relation_id}", response_model=dto.RelationOut)
    def edit_relation(novel_id: str, relation_id: str, data: dto.RelationUpdate, request: Request):
        return request.app.state.library.update_relation(novel_id, relation_id, data)

    @app.delete(prefix + "/novels/{novel_id}/relations/{relation_id}")
    def remove_relation(novel_id: str, relation_id: str, request: Request):
        request.app.state.library.delete_relation(novel_id, relation_id)
        return {"ok": True}

    @app.get(prefix + "/novels/{novel_id}/threads", response_model=list[dto.ThreadOut])
    def threads(novel_id: str, request: Request):
        return request.app.state.threads.list(novel_id)

    @app.put(prefix + "/novels/{novel_id}/threads/{entity_id}", response_model=dto.ThreadOut)
    def thread_plan(novel_id: str, entity_id: str, data: dto.ThreadPlanInput, request: Request):
        return request.app.state.threads.save_plan(novel_id, entity_id, data)

    @app.post(prefix + "/novels/{novel_id}/threads/{entity_id}/progress", response_model=dto.ThreadOut)
    def thread_progress(novel_id: str, entity_id: str, data: dto.ThreadProgressInput, request: Request):
        return request.app.state.threads.add(novel_id, entity_id, data)

    @app.patch(prefix + "/novels/{novel_id}/threads/{entity_id}/progress/{progress_id}", response_model=dto.ThreadOut)
    def change_thread_progress(novel_id: str, entity_id: str, progress_id: str, data: dto.ThreadProgressChange, request: Request):
        return request.app.state.threads.change(novel_id, entity_id, progress_id, data)

    @app.get(prefix + "/novels/{novel_id}/plans", response_model=list[dto.PlanOut])
    def plans(novel_id: str, request: Request):
        return request.app.state.library.plans(novel_id)

    @app.post(prefix + "/novels/{novel_id}/plans", response_model=dto.PlanOut)
    def create_plan(novel_id: str, data: dto.PlanInput, request: Request):
        return request.app.state.library.put_plan(novel_id, data)

    @app.put(prefix + "/novels/{novel_id}/plans/{plan_id}", response_model=dto.PlanOut)
    def edit_plan(novel_id: str, plan_id: str, data: dto.PlanUpdate, request: Request):
        return request.app.state.library.put_plan(novel_id,
            dto.PlanInput(**data.model_dump(exclude={"base_updated_at"})), plan_id, base_updated_at=data.base_updated_at)

    @app.get(prefix + "/novels/{novel_id}/plans/{plan_id}", response_model=dto.PlanOut)
    def read_plan(novel_id: str, plan_id: str, request: Request):
        return request.app.state.library.plan(novel_id, plan_id)

    @app.get(prefix + "/novels/{novel_id}/facts", response_model=list[dto.FactOut])
    def facts(novel_id: str, request: Request, include_inactive: bool = False):
        return request.app.state.library.facts(novel_id, include_inactive)

    @app.get(prefix + "/novels/{novel_id}/search", response_model=list[dto.SearchResult])
    def search(novel_id: str, request: Request, q: str = Query(max_length=200)):
        return request.app.state.library.search(novel_id, q)

    @app.post(prefix + "/novels/{novel_id}/context", response_model=dto.ContextOut)
    def context_preview(novel_id: str, data: dto.ContextInput, request: Request):
        return request.app.state.generation.preview(novel_id, data)

    @app.post(prefix + "/novels/{novel_id}/jobs", response_model=dto.JobDetail, status_code=202)
    def create_job(novel_id: str, data: dto.JobInput, request: Request):
        return request.app.state.generation.create(novel_id, data)

    @app.get(prefix + "/jobs", response_model=list[dto.JobOut])
    def jobs(request: Request, novel_id: str | None = None, chapter_id: str | None = None,
             task: dto.TaskName | None = None):
        return request.app.state.generation.list(novel_id, chapter_id, task)

    @app.get(prefix + "/jobs/page", response_model=dto.JobHistoryPage)
    def job_history(request: Request, novel_id: str | None = None, chapter_id: str | None = None,
                    task: dto.TaskName | None = None, state: dto.JobStateName | None = None,
                    query: str = Query(default="", max_length=200), cursor: str | None = Query(default=None, max_length=1024),
                    limit: int = Query(default=30, ge=1, le=100),
                    tasks: Annotated[list[dto.TaskName] | None, Query(min_length=1, max_length=11)] = None,
                    volume_plan_id: str | None = None, base_version_id: str | None = None,
                    pending_only: bool = False):
        return request.app.state.generation.history(novel_id=novel_id, chapter_id=chapter_id,
            task=task, state=state, query=query, cursor=cursor, limit=limit, tasks=tasks,
            volume_plan_id=volume_plan_id, base_version_id=base_version_id, pending_only=pending_only)

    @app.get(prefix + "/jobs/{job_id}", response_model=dto.JobDetail)
    def job(job_id: str, novel_id: str, request: Request):
        return request.app.state.generation.get(novel_id, job_id)

    @app.get(prefix + "/jobs/{job_id}/progress", response_model=dto.JobProgress)
    def job_progress(job_id: str, novel_id: str, request: Request):
        return request.app.state.generation.progress(novel_id, job_id)

    @app.get(prefix + "/jobs/{job_id}/events")
    async def events(job_id: str, novel_id: str, request: Request, after: int = Query(default=0, ge=0),
                     last_event_id: str | None = Header(default=None)):
        cursor = after
        if last_event_id:
            try:
                cursor = max(cursor, int(last_event_id))
            except ValueError as exc:
                raise DomainError("INVALID_EVENT_CURSOR", "事件序号无效。") from exc
        generation = request.app.state.generation
        generation.state(novel_id, job_id)

        async def stream():
            nonlocal cursor
            while not await request.is_disconnected():
                batch, state = generation.events(novel_id, job_id, cursor)
                for event in batch:
                    cursor = event.seq
                    yield f"id: {event.seq}\ndata: {event.model_dump_json()}\n\n"
                if state in TERMINAL_JOB_STATES | {"paused"} and len(batch) < 300:
                    yield f"event: complete\ndata: {json.dumps({'state': state})}\n\n"
                    break
                yield ": heartbeat\n\n"
                await asyncio.sleep(.35)
        return StreamingResponse(stream(), media_type="text/event-stream",
                                 headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"})

    @app.post(prefix + "/jobs/{job_id}/adopt", response_model=dto.VersionOut)
    def adopt(job_id: str, novel_id: str, data: dto.AdoptInput, request: Request):
        return request.app.state.generation.adopt(novel_id, job_id, data.base_version_id)

    @app.post(prefix + "/jobs/{job_id}/review-decision", response_model=dto.JobDetail)
    def review_decision(job_id: str, novel_id: str, data: dto.FindingDecision, request: Request):
        return request.app.state.generation.decide_finding(novel_id, job_id, data)

    @app.post(prefix + "/jobs/{job_id}/apply-plan", response_model=dto.ProductionApplyOut)
    def apply_plan(job_id: str, novel_id: str, request: Request):
        return request.app.state.generation.apply_plan(novel_id, job_id)

    @app.post(prefix + "/jobs/{job_id}/apply-outline-edit", response_model=dto.OutlineState)
    def apply_outline_edit(job_id: str, novel_id: str, data: dto.OutlineApplyInput, request: Request):
        return request.app.state.outlines.adopt(novel_id, job_id, data)

    @app.post(prefix + "/jobs/{job_id}/prepare-rewrite", response_model=dto.ReviewRewritePreparation)
    def prepare_rewrite(job_id: str, novel_id: str, data: dto.ReviewRewriteInput, request: Request):
        return request.app.state.generation.prepare_rewrite(novel_id, job_id, data)

    @app.post(prefix + "/jobs/{job_id}/{action}", response_model=dto.JobDetail)
    def control(job_id: str, action: str, novel_id: str, request: Request):
        return request.app.state.generation.control(novel_id, job_id, action)

    @app.get(prefix + "/providers", response_model=list[dto.ProviderOut])
    def providers(request: Request):
        return request.app.state.generation.providers()

    @app.post(prefix + "/providers", response_model=dto.ProviderOut)
    def create_provider(data: dto.ProviderInput, request: Request):
        return request.app.state.generation.save_provider(data)

    @app.put(prefix + "/providers/{provider_id}", response_model=dto.ProviderOut)
    def edit_provider(provider_id: str, data: dto.ProviderInput, request: Request):
        return request.app.state.generation.save_provider(data, provider_id)

    @app.post(prefix + "/providers/{provider_id}/check", response_model=dto.ConnectionOut)
    async def check_provider(provider_id: str, request: Request):
        return await request.app.state.generation.check_provider(provider_id)

    @app.get(prefix + "/roles", response_model=dto.RoleConfig)
    def roles(request: Request):
        return request.app.state.generation.roles()

    @app.put(prefix + "/roles", response_model=dto.RoleConfig)
    def save_roles(data: dto.RoleConfig, request: Request):
        return request.app.state.generation.save_roles(data.model_dump())

    @app.post(prefix + "/import-preview", response_model=list[dto.ImportChapter])
    def import_preview(data: dto.ImportPreviewInput):
        return split_manuscript(data.text)

    @app.post(prefix + "/import", response_model=dto.NovelOut)
    def import_manuscript(data: dto.ImportInput, request: Request):
        return request.app.state.library.import_manuscript(data)

    @app.get(prefix + "/novels/{novel_id}/discussions", response_model=list[dto.ConversationOut])
    def discussions(novel_id: str, request: Request):
        return request.app.state.discussions.list(novel_id)

    @app.post(prefix + "/novels/{novel_id}/discussions", response_model=dto.ConversationOut, status_code=201)
    def create_discussion(novel_id: str, data: dto.ConversationInput, request: Request):
        return request.app.state.discussions.create(novel_id, data)

    @app.get(prefix + "/novels/{novel_id}/discussions/{conversation_id}", response_model=dto.DiscussionPage)
    def discussion(novel_id: str, conversation_id: str, request: Request,
                   before: str | None = Query(default=None, min_length=1, max_length=160)):
        return request.app.state.discussions.get(novel_id, conversation_id, before)

    @app.post(prefix + "/novels/{novel_id}/jobs/{job_id}/discussion-proposal", response_model=dto.OutlineState)
    def adopt_discussion(novel_id: str, job_id: str, data: dto.OutlineApplyInput, request: Request):
        return request.app.state.discussions.adopt(novel_id, job_id, data)

    @app.get(prefix + "/novels/{novel_id}/export-preview", response_model=dto.ExportPreviewOut)
    def export_preview(novel_id: str, request: Request, confirmed: bool = True,
                       start_position: int | None = Query(default=None, ge=1, le=2147483647),
                       end_position: int | None = Query(default=None, ge=1, le=2147483647)):
        return request.app.state.library.export_preview(
            novel_id, confirmed, start_position, end_position)

    @app.get(prefix + "/novels/{novel_id}/export")
    def export(novel_id: str, request: Request, format: str = "md", confirmed: bool = False,
               start_position: int | None = Query(default=None, ge=1, le=2147483647),
               end_position: int | None = Query(default=None, ge=1, le=2147483647),
               expected_fingerprint: str | None = Query(default=None, pattern=r"^[a-f0-9]{64}$")):
        if format not in {"md", "txt", "zip"}:
            raise DomainError("INVALID_EXPORT", "支持 Markdown、TXT 和按章 TXT 压缩包。")
        library = request.app.state.library
        title = library.novel(novel_id).title
        if format == "zip":
            filename = quote(title.replace("/", "_").replace("\\", "_") + "-章节.zip")
            return Response(library.export_chapters(novel_id, confirmed, start_position,
                            end_position, expected_fingerprint), media_type="application/zip",
                headers={"Content-Disposition": "attachment; filename*=UTF-8''" + filename})
        body = library.export(novel_id, confirmed, format == "md", start_position,
                              end_position, expected_fingerprint)
        filename = quote(title.replace("/", "_").replace("\\", "_") + "." + format)
        return Response(body, media_type="text/plain; charset=utf-8",
                        headers={"Content-Disposition": "attachment; filename*=UTF-8''" + filename})

    @app.get(prefix + "/workspace/backup")
    def create_backup(request: Request):
        contents = backup(request.app.state.workspace)
        return Response(contents, media_type="application/zip", headers={
            "Content-Disposition": 'attachment; filename="story-workshop-backup.zip"'})

    @app.post(prefix + "/workspace/restore", response_model=dto.RestoreOut)
    async def restore_backup(request: Request):
        return restore(request.app.state.workspace, await request.body())

    @app.post(prefix + "/workspace/activate", response_model=dto.HealthOut)
    def activate(data: dto.ActivateInput, request: Request):
        activate_restore(request.app.state.workspace, data.restore_id)
        return health(request)

    @app.post(prefix + "/workspace/use-original", response_model=dto.HealthOut)
    def original_workspace(request: Request):
        activate_original(request.app.state.workspace)
        return health(request)

    dist = PROJECT_DIR / "frontend/dist"
    if dist.is_dir():
        assets = dist / "assets"
        if assets.is_dir():
            app.mount("/assets", StaticFiles(directory=assets), name="assets")

        @app.get("/")
        def index():
            return FileResponse(dist / "index.html")
    else:
        @app.get("/")
        def development_info():
            return JSONResponse({"message": "开发模式：请打开 http://127.0.0.1:5173；或先构建前端再打开此地址。"})
    return app
