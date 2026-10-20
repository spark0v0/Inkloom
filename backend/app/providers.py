"""Bounded Chat Completions transport and an explicitly non-AI demo provider."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx

from .domain import DomainError


class ProviderFailure(Exception):
    def __init__(self, code: str, message: str, uncertain: bool = False):
        self.code, self.message, self.uncertain = code, message, uncertain
        super().__init__(message)


@dataclass
class StreamPart:
    text: str = ""
    usage: dict[str, int] | None = None
    finish: str | None = None


def normalize_endpoint(url: str) -> str:
    parsed = urlsplit(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise DomainError("INVALID_ENDPOINT", "请输入完整的 HTTP(S) API 基础地址。")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise DomainError("INVALID_ENDPOINT", "API 地址不能包含凭证、查询参数或片段。")
    path = parsed.path.rstrip("/")
    if path.endswith("/chat/completions"):
        path = path[:-len("/chat/completions")]
    return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


def safe_usage(raw: Any) -> dict[str, int] | None:
    if not isinstance(raw, dict):
        return None
    output = {key: raw[key] for key in ("prompt_tokens", "completion_tokens", "total_tokens")
              if isinstance(raw.get(key), int) and not isinstance(raw.get(key), bool) and raw[key] >= 0}
    return output or None


def completion_cost(usage: dict[str, int] | None, config: dict[str, Any]) -> float | None:
    if config["kind"] == "demo":
        return 0.0
    if (usage is None or config.get("input_price") is None or config.get("output_price") is None
            or "prompt_tokens" not in usage or "completion_tokens" not in usage):
        return None
    return (usage["prompt_tokens"] * config["input_price"]
            + usage["completion_tokens"] * config["output_price"]) / 1_000_000


def demo_text(task: str, context: dict[str, Any]) -> str:
    body = context["input"]
    sources = body.get("draft_sources", [])
    changes = []
    for source in sources[:3]:
        quote = source["text"][:100]
        if quote:
            changes.append({"kind": "event", "subject": "本章原文",
                            "claim": quote, "evidence": [{"source_id": source["source_id"],
                                                          "quote": quote}], "known_by": []})
    if task == "extract":
        return json.dumps({"kind": "extract", "changes": changes,
                           "uncertainties": ["演示模式仅摘录原文，不进行智能事实判断。"]}, ensure_ascii=False)
    if task == "review":
        return json.dumps({"kind": "review", "findings": [],
                           "summary": "这是演示响应，未进行真实模型审稿，不能据此判断全文一致性。"}, ensure_ascii=False)
    if task == "plan":
        return json.dumps({"kind": "plan", "title": body["chapter"]["title"] + " · 场景计划",
            "scenes": [{"goal": body["chapter"]["goal"] or "让人物面对一个具体问题",
                        "obstacle": "对方只给出部分线索", "decision": "先核实，再继续调查",
                        "change": "获得下一步行动的方向"}],
            "open_questions": ["演示模板，不代表真实模型规划。请按自己的故事修改。"]}, ensure_ascii=False)
    if task == "handoff":
        return json.dumps({"kind": "handoff", "observations": changes,
                           "open_questions": ["哪些悬念需要留到下一章？"],
                           "next_suggestions": ["演示交接：围绕作者指定的本章目标继续规划。"]}, ensure_ascii=False)
    if task == "rewrite":
        selected = body.get("selection", {}).get("text", "")
        return selected + "\n\n他停了一会儿，没有把那个问题立刻问出口。"
    characters = [e for e in body["author_settings"] if e["kind"] == "character"]
    name = characters[0]["name"] if characters else "他"
    return (f"门外的脚步声停了。{name}把手里的东西放下，抬头看向门口。\n\n"
            "来人没有急着说话。他先把一张折过两次的纸放在桌上，指尖仍压着纸角。"
            "窗缝里吹进来的风掀起另一边，露出一行还没干透的字。\n\n"
            "“先别打开。”他说，“我需要你回答一个问题。”")


async def stream_completion(config: dict[str, Any], key: str, messages: list[dict[str, str]],
                            task: str, context: dict[str, Any]):
    if config["kind"] == "demo":
        output = demo_text(task, context)
        for start in range(0, len(output), 12):
            await asyncio.sleep(.025)
            yield StreamPart(text=output[start:start + 12])
        yield StreamPart(finish="stop")
        return
    if not key:
        raise ProviderFailure("PROVIDER_KEY_MISSING", "模型密钥未配置，请在模型设置中添加。")
    payload: dict[str, Any] = {"model": config["model"], "messages": messages,
        "stream": config["stream"], config["token_parameter"]: config["max_output_tokens"]}
    if config["stream"] and config["include_usage"]:
        payload["stream_options"] = {"include_usage": True}
    if config["json_mode"] and task in {"extract", "review", "plan", "handoff"}:
        payload["response_format"] = {"type": "json_object"}
    endpoint = config["base_url"].rstrip("/") + "/chat/completions"
    headers = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
    timeout = httpx.Timeout(connect=12, read=45, write=30, pool=12)
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=False) as client:
            async with client.stream("POST", endpoint, json=payload, headers=headers) as response:
                if response.status_code != 200:
                    code = response.status_code
                    if 300 <= code < 400:
                        raise ProviderFailure("PROVIDER_REDIRECT", "服务要求重定向，未跟随发送密钥。请检查基础地址。")
                    hint = {401: "鉴权失败，请检查密钥。", 403: "服务拒绝访问，请检查权限。",
                            404: "找不到接口，请检查基础地址和协议。", 429: "服务限流，请稍后手动重试。"}.get(
                            code, "服务未能完成请求，请检查模型和兼容参数。")
                    raise ProviderFailure(f"PROVIDER_HTTP_{code}", hint, uncertain=code >= 500)
                if not config["stream"]:
                    raw = await response.aread()
                    if len(raw) > 4_000_000:
                        raise ProviderFailure("RESPONSE_TOO_LARGE", "服务响应超过大小限制。", True)
                    parsed = json.loads(raw)
                    choice = parsed.get("choices", [{}])[0]
                    content = choice.get("message", {}).get("content")
                    if not isinstance(content, str):
                        raise ProviderFailure("INVALID_RESPONSE", "服务返回的正文格式不兼容。", True)
                    yield StreamPart(text=content, usage=safe_usage(parsed.get("usage")),
                                     finish=choice.get("finish_reason") or "unknown")
                    return
                data_lines: list[str] = []
                ended = False

                def parse_event(data: str):
                    nonlocal ended
                    if data == "[DONE]":
                        ended = True
                        return None
                    raw = json.loads(data)
                    choice = (raw.get("choices") or [{}])[0]
                    content = choice.get("delta", {}).get("content") or ""
                    if not isinstance(content, str):
                        raise ProviderFailure("INVALID_RESPONSE", "流式正文格式不兼容。", True)
                    return StreamPart(text=content, usage=safe_usage(raw.get("usage")),
                                      finish=choice.get("finish_reason"))

                async for line in response.aiter_lines():
                    if len(line) > 1_000_000:
                        raise ProviderFailure("RESPONSE_TOO_LARGE", "流式事件超过大小限制。", True)
                    if line.startswith("data:"):
                        data_lines.append(line[5:].lstrip(" "))
                    elif not line and data_lines:
                        part = parse_event("\n".join(data_lines))
                        data_lines.clear()
                        if part:
                            yield part
                        if ended:
                            break
                if data_lines:
                    part = parse_event("\n".join(data_lines))
                    if part:
                        yield part
                if not ended:
                    raise ProviderFailure("STREAM_INTERRUPTED", "服务流中断，已保留部分稿；上游执行和费用可能未知。", True)
    except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
        raise ProviderFailure("CONNECTION_FAILED", "未能建立模型连接，请检查服务地址与本机网络。") from exc
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        raise ProviderFailure("UPSTREAM_UNCERTAIN", "请求可能已送达服务商，执行状态未知；请确认后再重试。", True) from exc
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise ProviderFailure("INVALID_RESPONSE", "服务返回了无法解析的响应，已保留可用片段。", True) from exc
