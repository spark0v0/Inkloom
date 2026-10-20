"""Persistent jobs, fenced commits, replayable events and explicit adoption."""

from __future__ import annotations

import asyncio
import json
import time
from contextlib import suppress
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select

from . import schemas as dto
from .context import build_context, context_current, validate_result
from .domain import ACTIVE_JOB_STATES, DomainError, digest, now, splice_document, text_document, uid
from .library import (
    mark_dirty,
    new_version,
    require_chapter,
    require_job,
    require_novel,
    version_out,
)
from .models import Attempt, Job, JobEvent, Provider, Setting, Version
from .providers import ProviderFailure, completion_cost, normalize_endpoint, stream_completion
from .storage import Workspace


def emit(session, job: Job, kind: str, data: dict[str, Any]) -> None:
    seq = (session.scalar(select(func.max(JobEvent.seq)).where(JobEvent.job_id == job.id)) or 0) + 1
    session.add(JobEvent(job_id=job.id, seq=seq, kind=kind, data=data))
    job.updated_at = now()
    session.flush()


def public_job(session, job: Job, detail: bool = False):
    values = {key: getattr(job, key) for key in dto.JobOut.model_fields}
    if detail:
        values["context"] = job.context["preview"]
        values["attempts"] = [dto.AttemptOut.model_validate(a) for a in session.scalars(
            select(Attempt).where(Attempt.job_id == job.id).order_by(Attempt.number)).all()]
        return dto.JobDetail(**values)
    return dto.JobOut(**values)


class Generation:
    def __init__(self, workspace: Workspace):
        self.ws = workspace
        self.owner = uid("worker")
        self.worker_task: asyncio.Task | None = None
        with self.ws.session(write=True) as s:
            if not s.get(Provider, "demo"):
                s.add(Provider(id="demo", name="演示模型", kind="demo", model="demo-local",
                               context_window=200000, max_output_tokens=4000,
                               input_price=0.0, output_price=0.0))
            if not s.get(Setting, "roles"):
                s.add(Setting(key="roles", value={"writer": "demo", "planner": "demo",
                                                 "extractor": "demo", "reviewer": "demo"}))

    def providers(self) -> list[dto.ProviderOut]:
        with self.ws.session() as s:
            return [self._provider_out(p) for p in s.scalars(select(Provider)).all()]

    def _provider_out(self, provider: Provider) -> dto.ProviderOut:
        values = {key: getattr(provider, key) for key in dto.ProviderOut.model_fields
                  if key not in {"has_key", "secret_persistent"}}
        return dto.ProviderOut(**values,
            has_key=self.ws.db.secrets.has(provider.id, provider.key_env),
            secret_persistent=self.ws.db.secrets.persistent)

    def save_provider(self, data: dto.ProviderInput, provider_id: str | None = None):
        base_url = normalize_endpoint(data.base_url)
        if data.max_output_tokens + 1024 >= data.context_window:
            raise DomainError("INVALID_BUDGET", "上下文容量需要大于输出上限，并保留输入和安全余量。")
        if ((data.input_price is None) != (data.output_price is None)):
            raise DomainError("INVALID_PRICE", "输入与输出价格需要一起填写，或都留空。")
        if data.input_price is not None and not data.price_date:
            raise DomainError("PRICE_DATE_REQUIRED", "请填写手动配置价格的来源日期。")
        with self.ws.session(write=True) as s:
            provider = s.get(Provider, provider_id) if provider_id else None
            if provider_id and (provider is None or provider.kind == "demo"):
                raise DomainError("PROVIDER_NOT_EDITABLE", "此模型连接不能修改。", 404)
            values = data.model_dump(exclude={"api_key", "clear_key"})
            values["base_url"] = base_url
            if provider is None:
                provider = Provider(id=uid("provider"), **values)
                s.add(provider)
            else:
                for key, value in values.items():
                    setattr(provider, key, value)
                provider.revision += 1
            if data.clear_key:
                self.ws.db.secrets.set(provider.id, None)
            if data.api_key and data.api_key.get_secret_value():
                self.ws.db.secrets.set(provider.id, data.api_key.get_secret_value())
            s.flush()
            return self._provider_out(provider)

    def roles(self) -> dict[str, str]:
        with self.ws.session() as s:
            row = s.get(Setting, "roles")
            return row.value if row else {role: "demo" for role in ("writer", "planner", "extractor", "reviewer")}

    def save_roles(self, roles: dict[str, str]) -> dict[str, str]:
        if set(roles) != {"writer", "planner", "extractor", "reviewer"}:
            raise DomainError("INVALID_ROLES", "需要为规划、写作、提取和审稿指定模型。")
        with self.ws.session(write=True) as s:
            if any(s.get(Provider, value) is None for value in roles.values()):
                raise DomainError("PROVIDER_NOT_FOUND", "选择的模型连接不存在。")
            setting = s.get(Setting, "roles")
            if setting is None:
                s.add(Setting(key="roles", value=roles))
            else:
                setting.value = roles
            return roles

    def preview(self, novel_id: str, request: dto.ContextInput) -> dto.ContextOut:
        with self.ws.session() as s:
            return dto.ContextOut(**build_context(s, novel_id, request)["preview"])

    def create(self, novel_id: str, request: dto.JobInput) -> dto.JobDetail:
        request_hash = digest(request.model_dump())
        with self.ws.session(write=True) as s:
            existing = s.scalar(select(Job).where(Job.novel_id == novel_id,
                                                  Job.idempotency_key == request.idempotency_key))
            if existing:
                if existing.request_hash != request_hash:
                    raise DomainError("IDEMPOTENCY_CONFLICT", "同一次任务请求包含不同内容。", 409)
                return public_job(s, existing, True)
            if s.scalar(select(Job.id).where(Job.novel_id == novel_id, Job.state.in_(ACTIVE_JOB_STATES))):
                raise DomainError("JOB_ACTIVE", "本书已有生成任务，请等待完成或取消后再试。", 409)
            context = build_context(s, novel_id, request)
            config = context["provider"]
            if config["kind"] != "demo" and not self.ws.db.secrets.has(config["id"], config["key_env"]):
                raise DomainError("PROVIDER_KEY_MISSING", "请先配置模型密钥，或明确选择演示模型。")
            estimate = context["preview"]["estimated_max_cost"]
            if request.max_cost is not None and estimate is None:
                raise DomainError("PRICE_UNKNOWN", "未配置价格，无法执行金额上限。请补充价格或只设置调用次数。")
            if request.max_cost is not None and estimate > request.max_cost:
                raise DomainError("BUDGET_EXCEEDED", "本次调用的预留估算已超过你设置的预算。")
            job = Job(id=uid("job"), novel_id=novel_id, chapter_id=request.chapter_id,
                      task=request.task, instruction=request.instruction, provider_id=request.provider_id,
                      state="queued", idempotency_key=request.idempotency_key, request_hash=request_hash,
                      base_version_id=request.base_version_id, context=context,
                      selection=request.selection.model_dump() if request.selection else None,
                      max_attempts=request.max_attempts, max_cost=request.max_cost,
                      reserved_cost=estimate, is_demo=config["kind"] == "demo")
            s.add(job)
            s.flush()
            emit(s, job, "state", {"state": "queued"})
            return public_job(s, job, True)

    def get(self, novel_id: str, job_id: str) -> dto.JobDetail:
        with self.ws.session() as s:
            return public_job(s, require_job(s, novel_id, job_id), True)

    def list(self, novel_id: str | None = None) -> list[dto.JobOut]:
        with self.ws.session() as s:
            query = select(Job)
            if novel_id:
                require_novel(s, novel_id)
                query = query.where(Job.novel_id == novel_id)
            return [public_job(s, j) for j in s.scalars(query.order_by(Job.created_at.desc()).limit(150)).all()]

    def events(self, novel_id: str, job_id: str, after: int) -> tuple[list[dto.JobEventOut], str]:
        with self.ws.session() as s:
            job = require_job(s, novel_id, job_id)
            events = [dto.JobEventOut.model_validate(e) for e in s.scalars(select(JobEvent).where(
                JobEvent.job_id == job_id, JobEvent.seq > after).order_by(JobEvent.seq).limit(300)).all()]
            return events, job.state

    def control(self, novel_id: str, job_id: str, action: str) -> dto.JobDetail:
        with self.ws.session(write=True) as s:
            job = require_job(s, novel_id, job_id)
            if action == "cancel":
                if job.state in ACTIVE_JOB_STATES | {"paused"}:
                    job.state = "cancelled"
                    job.lease_epoch += 1
                    job.candidate_status = "partial"
                    attempt = s.scalar(select(Attempt).where(Attempt.job_id == job.id,
                        Attempt.number == job.attempt_count))
                    if attempt and not attempt.finished_at:
                        attempt.call_state = "cancelled_after_dispatch" if job.checkpoint == "dispatched" else "cancelled_before_dispatch"
                        attempt.finished_at = now()
                    emit(s, job, "state", {"state": "cancelled"})
            elif action == "pause":
                if job.state == "queued":
                    job.state = "paused"
                elif job.state == "running":
                    job.state = "pausing"
                else:
                    raise DomainError("INVALID_JOB_STATE", "此任务当前不能暂停。", 409)
                emit(s, job, "state", {"state": job.state})
            elif action in {"resume", "retry"}:
                allowed = {"paused"} if action == "resume" else {"failed", "interrupted_uncertain"}
                if job.state not in allowed:
                    raise DomainError("INVALID_JOB_STATE", "此任务当前不能继续或重试。", 409)
                if s.scalar(select(Job.id).where(Job.novel_id == novel_id, Job.id != job.id,
                                                Job.state.in_(ACTIVE_JOB_STATES))):
                    raise DomainError("JOB_ACTIVE", "本书还有其他活动任务。", 409)
                if job.checkpoint == "artifact_ready" and action == "resume":
                    job.state = "succeeded"
                else:
                    if job.attempt_count >= job.max_attempts:
                        raise DomainError("ATTEMPT_LIMIT", "已达到本任务的最大调用次数。", 409)
                    if (job.max_cost is not None and job.attempt_count > 0
                            and (job.cost is None or job.reserved_cost is None
                                 or job.cost + job.reserved_cost > job.max_cost)):
                        raise DomainError("BUDGET_UNCERTAIN", "历史调用费用未知或预算不足，请核实后创建新任务。", 409)
                    job.state = "queued"
                    job.output_text = ""
                    job.result = None
                    job.candidate_status = "partial"
                    job.checkpoint = "prepared"
                    job.error_code = job.error_message = None
                    job.lease_epoch += 1
                emit(s, job, "state", {"state": job.state, "author_action": action})
            elif action == "reject":
                if job.candidate_status not in {"ready", "needs_rebase"}:
                    raise DomainError("INVALID_CANDIDATE", "此候选稿不能拒绝。", 409)
                job.candidate_status = "rejected"
                emit(s, job, "candidate", {"status": "rejected"})
            else:
                raise DomainError("UNKNOWN_ACTION", "不支持的任务操作。")
            s.flush()
            return public_job(s, job, True)

    def adopt(self, novel_id: str, job_id: str, base_version_id: str) -> dto.VersionOut:
        with self.ws.session(write=True) as s:
            job = require_job(s, novel_id, job_id)
            chapter = require_chapter(s, novel_id, job.chapter_id)
            novel = require_novel(s, novel_id)
            if job.adopted_version_id:
                return version_out(s.get(Version, job.adopted_version_id))
            if job.task not in {"continue", "rewrite"} or job.state != "succeeded" or job.candidate_status != "ready":
                raise DomainError("CANDIDATE_NOT_READY", "只有完整且未失效的正文候选可直接采纳。", 409)
            if chapter.working_version_id != job.base_version_id or base_version_id != job.base_version_id:
                raise DomainError("VERSION_CONFLICT", "原稿已更新。请比较两份文字，再手动合并为新版本。", 409,
                                  current_version_id=chapter.working_version_id)
            if not context_current(s, job):
                raise DomainError("CONTEXT_STALE", "正史或设定已更新，请核对候选后手动合并或重新生成。", 409)
            current = s.get(Version, job.base_version_id)
            if job.task == "rewrite":
                selection = job.selection
                start, end = selection["start_codepoint"], selection["end_codepoint"]
                if current.text[start:end] != selection["text"]:
                    raise DomainError("SELECTION_CHANGED", "原选段已改变，未执行替换。", 409)
                body = current.text[:start] + job.output_text + current.text[end:]
            else:
                body = current.text + ("\n\n" if current.text.strip() else "") + job.output_text
            document = splice_document(current.editor_doc, start, end, job.output_text) if job.task == "rewrite" else None
            if job.task == "continue" and current.text.strip():
                document = {"type": "doc", "content": current.editor_doc["content"] + text_document(job.output_text)["content"]}
            version = new_version(s, chapter, body, "adopt:" + job.id, digest(body), document)
            if chapter.accepted_version_id:
                mark_dirty(s, novel, chapter.position)
            job.candidate_status = "adopted"
            job.adopted_version_id = version.id
            novel.updated_at = now()
            emit(s, job, "candidate", {"status": "adopted", "version_id": version.id})
            return version_out(version)

    def decide_finding(self, novel_id: str, job_id: str, decision: dto.FindingDecision):
        with self.ws.session(write=True) as s:
            job = require_job(s, novel_id, job_id)
            if not job.result or job.task != "review" or decision.index >= len(job.result["findings"]):
                raise DomainError("FINDING_NOT_FOUND", "找不到该审稿意见。", 404)
            result = json.loads(json.dumps(job.result))
            result["findings"][decision.index].update(decision=decision.decision, decision_note=decision.note)
            job.result = result
            emit(s, job, "review_decision", {"index": decision.index, "decision": decision.decision})
            return public_job(s, job, True)

    def claim(self) -> tuple[str, int, str] | None:
        with self.ws.session(write=True) as s:
            expired = s.scalars(select(Job).where(Job.state.in_({"running", "pausing"}),
                                                  Job.lease_until < time.time())).all()
            for job in expired:
                job.state = "interrupted_uncertain" if job.checkpoint == "dispatched" else "failed"
                job.error_code = "WORKER_INTERRUPTED"
                job.error_message = "执行进程中断，已保留片段；请核实上游费用后明确重试。"
                job.lease_epoch += 1
                attempt = s.scalar(select(Attempt).where(Attempt.job_id == job.id,
                    Attempt.number == job.attempt_count))
                if attempt and not attempt.finished_at:
                    attempt.call_state = job.state
                    attempt.error_code, attempt.finished_at = job.error_code, now()
                emit(s, job, "state", {"state": job.state, "code": job.error_code})
            job = s.scalar(select(Job).where(Job.state == "queued").order_by(Job.created_at).limit(1))
            if job is None:
                return None
            if not context_current(s, job):
                job.state, job.candidate_status = "failed", "needs_rebase"
                job.error_code, job.error_message = "CONTEXT_STALE", "原稿、正史或设定已更新。未调用模型，请准备新任务。"
                emit(s, job, "state", {"state": "failed", "code": job.error_code})
                return None
            provider = s.get(Provider, job.provider_id)
            if provider.revision != job.context["provider"]["revision"]:
                job.state = "failed"
                job.error_code, job.error_message = "PROVIDER_CHANGED", "模型配置已改变，请创建新任务。"
                emit(s, job, "state", {"state": "failed"})
                return None
            job.attempt_count += 1
            job.lease_epoch += 1
            job.lease_owner = self.owner
            job.lease_until = time.time() + 90
            job.state = "running"
            attempt = Attempt(id=uid("attempt"), job_id=job.id, number=job.attempt_count)
            s.add(attempt)
            emit(s, job, "state", {"state": "running", "attempt": job.attempt_count})
            return job.id, job.lease_epoch, attempt.id

    async def _execute(self, job_id: str, epoch: int, attempt_id: str) -> None:
        database = self.ws.db

        def active(session):
            job = session.get(Job, job_id)
            return job if (self.ws.db is database and job and job.lease_epoch == epoch
                           and job.state in {"running", "pausing"}) else None

        output = ""
        usage = None
        dispatched = False
        try:
            with self.ws.session(write=True) as s:
                job = active(s)
                if job is None:
                    return
                context = job.context
                key = self.ws.db.secrets.get(job.provider_id, context["provider"]["key_env"])
                job.checkpoint = "dispatched"
                s.get(Attempt, attempt_id).call_state = "dispatch_started"
                emit(s, job, "stage", {"stage": "生成候选" if job.task in {"continue", "rewrite"} else "整理结果"})
                dispatched = True
                task = job.task
            finish = None
            last_flush = time.monotonic()
            pending = ""
            async for part in stream_completion(context["provider"], key, context["messages"], task, context):
                output += part.text
                pending += part.text
                usage = part.usage if part.usage is not None else usage
                finish = part.finish if part.finish is not None else finish
                if len(output) > 200000:
                    raise ProviderFailure("OUTPUT_LIMIT", "输出超过单章大小限制，已保留片段。", True)
                if pending and (time.monotonic() - last_flush > .12 or len(pending) >= 256):
                    with self.ws.session(write=True) as s:
                        job = active(s)
                        if job is None:
                            return
                        job.output_text = output
                        attempt = s.get(Attempt, attempt_id)
                        attempt.output_text = output
                        attempt.call_state = "streaming"
                        emit(s, job, "delta", {"text": pending})
                    pending = ""
                    last_flush = time.monotonic()
            if finish != "stop":
                raise ProviderFailure("OUTPUT_TRUNCATED" if finish == "length" else "INCOMPLETE_OUTPUT",
                                      "模型未正常完成输出。片段已保留，不能直接作为完整候选采纳。")
            result = None
            if task in {"extract", "review", "plan", "handoff"}:
                try:
                    result = validate_result(task, json.loads(output), context)
                except (ValueError, ValidationError, DomainError) as exc:
                    raise ProviderFailure("INVALID_STRUCTURED_OUTPUT", "模型结果不符合结构或来源契约。原响应已保留，未写入正史。") from exc
            if not output.strip():
                raise ProviderFailure("EMPTY_OUTPUT", "服务没有返回正文，请检查模型与兼容设置。")
            with self.ws.session(write=True) as s:
                job = active(s)
                if job is None:
                    return
                attempt = s.get(Attempt, attempt_id)
                attempt.output_text, attempt.usage = output, usage
                attempt.cost = completion_cost(usage, context["provider"])
                attempt.call_state, attempt.finished_at = "completed", now()
                job.output_text, job.result = output, result
                job.candidate_status = "ready" if context_current(s, job) else "needs_rebase"
                job.checkpoint = "artifact_ready"
                attempts = s.scalars(select(Attempt).where(Attempt.job_id == job.id)).all()
                costs = [a.cost for a in attempts]
                job.cost = sum(costs) if all(c is not None for c in costs) else None
                job.state = "paused" if job.state == "pausing" else "succeeded"
                if pending:
                    emit(s, job, "delta", {"text": pending})
                emit(s, job, "state", {"state": job.state, "candidate_status": job.candidate_status})
        except asyncio.CancelledError:
            with self.ws.session(write=True) as s:
                job = active(s)
                if job:
                    job.state = "interrupted_uncertain" if dispatched else "failed"
                    job.error_code = "WORKER_STOPPED"
                    job.error_message = "工作进程已停止，保留已持久化的片段。请核实后继续。"
                    job.lease_epoch += 1
                    emit(s, job, "state", {"state": job.state})
            raise
        except (ProviderFailure, DomainError) as exc:
            uncertain = isinstance(exc, ProviderFailure) and exc.uncertain
            with self.ws.session(write=True) as s:
                job = active(s)
                if job is None:
                    return
                job.state = "interrupted_uncertain" if uncertain else "failed"
                job.output_text = output
                job.error_code, job.error_message = exc.code, exc.message
                attempt = s.get(Attempt, attempt_id)
                attempt.output_text, attempt.usage = output, usage
                attempt.cost = completion_cost(usage, context["provider"]) if dispatched else 0.0
                attempt.call_state = "interrupted_uncertain" if uncertain else "failed"
                attempt.error_code, attempt.finished_at = exc.code, now()
                job.cost = None
                emit(s, job, "state", {"state": job.state, "code": exc.code, "message": exc.message})
        except Exception:
            # A persistence/parser failure must never trigger a second paid request.
            # Keep diagnostics out of product errors: exception strings can contain manuscript data.
            with suppress(Exception):
                with self.ws.session(write=True) as s:
                    job = active(s)
                    if job:
                        job.state = "interrupted_uncertain" if dispatched else "failed"
                        job.error_code = "WORKER_ERROR"
                        job.error_message = "执行或持久化中断。已保存的片段仍保留，请核实调用记录后再重试。"
                        job.lease_epoch += 1
                        attempt = s.get(Attempt, attempt_id)
                        attempt.call_state, attempt.error_code, attempt.finished_at = job.state, job.error_code, now()
                        emit(s, job, "state", {"state": job.state, "code": job.error_code})

    async def run(self) -> None:
        running: asyncio.Task | None = None
        try:
            while True:
                try:
                    claimed = self.claim()
                except Exception:
                    await asyncio.sleep(1)
                    continue
                if not claimed:
                    await asyncio.sleep(.25)
                    continue
                job_id, epoch, attempt_id = claimed
                database = self.ws.db
                running = asyncio.create_task(self._execute(job_id, epoch, attempt_id))
                while not running.done():
                    await asyncio.wait({running}, timeout=.2)
                    try:
                        with self.ws.session(write=True) as s:
                            job = s.get(Job, job_id)
                            valid = self.ws.db is database and job and job.lease_epoch == epoch
                            if valid and job.state in {"running", "pausing"}:
                                job.lease_until = time.time() + 90
                            elif not running.done():
                                running.cancel()
                    except Exception:
                        if not running.done():
                            running.cancel()
                    if running.cancelled():
                        break
                with suppress(asyncio.CancelledError, Exception):
                    await running
                running = None
        finally:
            if running and not running.done():
                running.cancel()
                with suppress(asyncio.CancelledError, Exception):
                    await running
