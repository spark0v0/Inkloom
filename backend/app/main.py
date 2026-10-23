"""Local-only HTTP application. Every write is guarded before reading its payload."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from urllib.parse import quote, urlsplit

import httpx
from fastapi import FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import SQLAlchemyError
from starlette.middleware.base import BaseHTTPMiddleware

from . import schemas as dto
from .domain import TERMINAL_JOB_STATES, DomainError, split_manuscript
from .jobs import Generation
from .library import Library
from .models import Provider
from .seed import create_demo
from .storage import PROJECT_DIR, Workspace
from .workspace_io import activate_original, activate_restore, backup, restore

logger = logging.getLogger("story_workshop")


class LocalSessionMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, session_token: str, port: int):
        super().__init__(app)
        self.token = session_token
        self.allowed_ports = {port, 5173, 4173}

    def local_url(self, value: str, origin: bool = False) -> bool:
        try:
            parsed = urlsplit(value if origin else "http://" + value)
            return (parsed.hostname in {"127.0.0.1", "localhost", "::1"}
                    and (parsed.port or 80) in self.allowed_ports
                    and (not origin or parsed.scheme == "http"))
        except ValueError:
            return False

    async def dispatch(self, request: Request, call_next):
        if not self.local_url(request.headers.get("host", "")):
            return JSONResponse({"code": "INVALID_HOST", "message": "仅允许本机工作区地址。", "details": {}}, status_code=403)
        if not request.url.path.startswith("/api/"):
            return await call_next(request)
        origin = request.headers.get("origin")
        if origin is not None and not self.local_url(origin, True):
            return JSONResponse({"code": "INVALID_ORIGIN", "message": "不允许此网页访问本机工作区。", "details": {}}, status_code=403)
        if request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse({"code": "CROSS_SITE_REQUEST", "message": "已阻止跨站访问。", "details": {}}, status_code=403)
        bootstrap = request.method == "GET" and request.url.path == "/api/v1/health"
        if not bootstrap and not secrets.compare_digest(request.cookies.get("story_session", ""), self.token):
            return JSONResponse({"code": "SESSION_REQUIRED", "message": "本地会话已更新，请刷新页面。", "details": {}}, status_code=401)
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            if not origin or not self.local_url(origin, True):
                return JSONResponse({"code": "ORIGIN_REQUIRED", "message": "写入操作需要本地页面来源。", "details": {}}, status_code=403)
            maximum = 64 * 1024 * 1024 if request.url.path == "/api/v1/workspace/restore" else 8 * 1024 * 1024
            try:
                declared = int(request.headers.get("content-length", "0"))
            except ValueError:
                declared = maximum + 1
            if declared > maximum:
                return JSONResponse({"code": "BODY_TOO_LARGE", "message": "请求内容超过限制。", "details": {}}, status_code=413)
            body = await request.body()
            if len(body) > maximum:
                return JSONResponse({"code": "BODY_TOO_LARGE", "message": "请求内容超过限制。", "details": {}}, status_code=413)
        response = await call_next(request)
        if bootstrap:
            response.set_cookie("story_session", self.token, httponly=True, samesite="strict", path="/api")
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        return response


def create_app(data_dir: Path | None = None, *, worker: bool = True, port: int = 8765) -> FastAPI:
    root = data_dir or Path(os.environ.get("STORY_WORKSHOP_DATA_DIR", str(PROJECT_DIR / "data")))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        workspace = Workspace(root)
        app.state.workspace = workspace
        app.state.library = Library(workspace)
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
    def edit_novel(novel_id: str, data: dto.NovelPatch, request: Request):
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
    def edit_chapter(novel_id: str, chapter_id: str, data: dto.ChapterPatch, request: Request):
        return request.app.state.library.edit_chapter(novel_id, chapter_id, data)

    @app.post(prefix + "/novels/{novel_id}/chapters/{chapter_id}/versions", response_model=dto.VersionOut)
    def save_version(novel_id: str, chapter_id: str, data: dto.SaveInput, request: Request):
        return request.app.state.library.save(novel_id, chapter_id, data)

    @app.get(prefix + "/novels/{novel_id}/chapters/{chapter_id}/versions", response_model=list[dto.VersionSummary])
    def list_versions(novel_id: str, chapter_id: str, request: Request):
        return request.app.state.library.versions(novel_id, chapter_id)

    @app.get(prefix + "/novels/{novel_id}/chapters/{chapter_id}/versions/{version_id}", response_model=dto.VersionOut)
    def get_version(novel_id: str, chapter_id: str, version_id: str, request: Request):
        return request.app.state.library.version(novel_id, chapter_id, version_id)

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
    def edit_entity(novel_id: str, entity_id: str, data: dto.EntityInput, request: Request):
        return request.app.state.library.put_entity(novel_id, data, entity_id)

    @app.get(prefix + "/novels/{novel_id}/plans", response_model=list[dto.PlanOut])
    def plans(novel_id: str, request: Request):
        return request.app.state.library.plans(novel_id)

    @app.post(prefix + "/novels/{novel_id}/plans", response_model=dto.PlanOut)
    def create_plan(novel_id: str, data: dto.PlanInput, request: Request):
        return request.app.state.library.put_plan(novel_id, data)

    @app.put(prefix + "/novels/{novel_id}/plans/{plan_id}", response_model=dto.PlanOut)
    def edit_plan(novel_id: str, plan_id: str, data: dto.PlanInput, request: Request):
        return request.app.state.library.put_plan(novel_id, data, plan_id)

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
    def jobs(request: Request, novel_id: str | None = None):
        return request.app.state.generation.list(novel_id)

    @app.get(prefix + "/jobs/{job_id}", response_model=dto.JobDetail)
    def job(job_id: str, novel_id: str, request: Request):
        return request.app.state.generation.get(novel_id, job_id)

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
        generation.get(novel_id, job_id)

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
        workspace = request.app.state.workspace
        with workspace.session() as session:
            provider = session.get(Provider, provider_id)
            if provider is None or provider.kind == "demo":
                return dto.ConnectionOut(reachable=True, model_listed=True, message="演示模型在本机运行，不调用外部服务。")
            key = workspace.db.secrets.get(provider.id, provider.key_env)
            url, model = provider.base_url, provider.model
        if not key:
            raise DomainError("PROVIDER_KEY_MISSING", "请先配置密钥。")
        try:
            async with httpx.AsyncClient(timeout=12, follow_redirects=False, trust_env=False) as client:
                response = await client.get(url.rstrip("/") + "/models", headers={"Authorization": "Bearer " + key})
                if response.status_code != 200:
                    raise DomainError("PROVIDER_CHECK_FAILED", f"模型目录返回 HTTP {response.status_code}。此检查不调用正文生成。")
                if len(response.content) > 2_000_000:
                    raise DomainError("PROVIDER_CHECK_FAILED", "模型目录响应过大。")
                listed = any(item.get("id") == model for item in response.json().get("data", []) if isinstance(item, dict))
                return dto.ConnectionOut(reachable=True, model_listed=listed,
                    message="模型目录可访问。此结果不代表流式生成或结构化输出已验证。" + ("" if listed else "填写的模型未出现在目录中。"))
        except (httpx.HTTPError, ValueError) as exc:
            raise DomainError("PROVIDER_CHECK_FAILED", "无法读取模型目录，请检查服务与本机网络。") from exc

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

    @app.get(prefix + "/novels/{novel_id}/export")
    def export(novel_id: str, request: Request, format: str = "md", confirmed: bool = False):
        if format not in {"md", "txt", "zip"}:
            raise DomainError("INVALID_EXPORT", "支持 Markdown、TXT 和按章 TXT 压缩包。")
        library = request.app.state.library
        title = library.novel(novel_id).title
        if format == "zip":
            filename = quote(title.replace("/", "_").replace("\\", "_") + "-章节.zip")
            return Response(library.export_chapters(novel_id, confirmed), media_type="application/zip",
                headers={"Content-Disposition": "attachment; filename*=UTF-8''" + filename})
        body = library.export(novel_id, confirmed, format == "md")
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
