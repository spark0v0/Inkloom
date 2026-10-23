"""Bounded Chat Completions transport and an explicitly non-AI demo provider."""

from __future__ import annotations

import asyncio
import json
import re
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


async def bounded_body(response: httpx.Response, limit: int) -> bytes:
    """Enforce the limit while reading decoded bytes, not after buffering the body."""
    body = bytearray()
    async for chunk in response.aiter_bytes():
        if len(body) + len(chunk) > limit:
            raise ProviderFailure("RESPONSE_TOO_LARGE", "服务响应超过大小限制，已停止读取。", True)
        body.extend(chunk)
    return bytes(body)


async def bounded_lines(response: httpx.Response):
    # Bound both unfinished lines and the whole stream, including reasoning/heartbeat
    # data that never reaches the manuscript's own output-size check.
    pending = b""
    total = 0
    async for chunk in response.aiter_bytes():
        total += len(chunk)
        if total > 16_000_000:
            raise ProviderFailure("RESPONSE_TOO_LARGE", "模型响应流超过大小限制，已停止读取。", True)
        pending += chunk
        start = 0
        for match in re.finditer(rb"\r\n|\r|\n", pending):
            if match.group() == b"\r" and match.end() == len(pending):
                break  # The next chunk may start with LF.
            line = pending[start:match.start()]
            if len(line) > 1_000_000:
                raise ProviderFailure("RESPONSE_TOO_LARGE", "流式事件超过大小限制。", True)
            yield line.decode("utf-8")
            start = match.end()
        pending = pending[start:]
        if len(pending) > 1_000_000:
            raise ProviderFailure("RESPONSE_TOO_LARGE", "流式事件超过大小限制。", True)
    if pending:
        yield pending.removesuffix(b"\r").decode("utf-8")


def completion_part(raw: Any, streaming: bool) -> StreamPart:
    if not isinstance(raw, dict) or not isinstance(raw.get("choices"), list):
        raise ProviderFailure("INVALID_RESPONSE", "服务返回的正文结构不兼容。", True)
    choices = raw["choices"]
    if not choices and streaming:
        return StreamPart(usage=safe_usage(raw.get("usage")))
    choice = choices[0] if choices else None
    key = "delta" if streaming else "message"
    if not isinstance(choice, dict) or not isinstance(choice.get(key), dict):
        raise ProviderFailure("INVALID_RESPONSE", "服务返回的正文结构不兼容。", True)
    content = choice[key].get("content")
    if content is None and streaming:
        content = ""
    finish = choice.get("finish_reason")
    if not isinstance(content, str) or (finish is not None and not isinstance(finish, str)):
        raise ProviderFailure("INVALID_RESPONSE", "服务返回的正文格式不兼容。", True)
    return StreamPart(text=content, usage=safe_usage(raw.get("usage")), finish=finish)


async def model_catalog(base_url: str, key: str) -> list[str]:
    """Read only the configured service's catalog; never follow a redirect or generate."""
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=False, trust_env=False) as client:
            async with client.stream("GET", base_url.rstrip("/") + "/models",
                                     headers={"Authorization": "Bearer " + key}) as response:
                if response.status_code != 200:
                    raise ProviderFailure("PROVIDER_CHECK_FAILED",
                        f"模型目录返回 HTTP {response.status_code}。请检查服务地址与权限。")
                raw = json.loads(await bounded_body(response, 2_000_000))
                if not isinstance(raw, dict) or not isinstance(raw.get("data"), list):
                    raise ProviderFailure("PROVIDER_CHECK_FAILED", "模型目录格式不兼容，需要包含 data 列表。")
                names = {item["id"] for item in raw["data"] if isinstance(item, dict)
                         and isinstance(item.get("id"), str) and 0 < len(item["id"]) <= 160
                         and item["id"].strip() and not any(ord(c) < 32 for c in item["id"])}
                return sorted(names)
    except ProviderFailure as exc:
        raise ProviderFailure("PROVIDER_CHECK_FAILED", exc.message) from exc
    except (httpx.HTTPError, ValueError, RecursionError) as exc:
        raise ProviderFailure("PROVIDER_CHECK_FAILED", "无法读取模型目录，请检查服务与本机网络。") from exc


def normalize_endpoint(url: str) -> str:
    url = url.strip()
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError as exc:
        raise DomainError("INVALID_ENDPOINT", "服务地址或端口无效，请核对后重试。") from exc
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise DomainError("INVALID_ENDPOINT", "请输入完整的 HTTP(S) API 基础地址。")
    if any(ord(c) < 32 for c in url) or any(c.isspace() for c in parsed.netloc) or port == 0:
        raise DomainError("INVALID_ENDPOINT", "服务地址或端口无效，请核对后重试。")
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
    if task == "blueprint":
        return json.dumps({"kind": "blueprint", "title": body["author_brief"]["title"],
            "logline": "演示方案：一封迟到十年的信，让离乡者回到旧港追查家人的失踪。",
            "blurb": "雨夜，他收到一封不该出现的信。寄信人已经失踪十年，邮戳却是昨天。",
            "reader_promise": "循线调查、人物博弈与逐卷揭开的旧案。演示固定样例，请连接模型生成自己的故事。",
            "main_conflict": "陈序要找到父亲，港务公司却在销毁当年的航运记录。",
            "ending": "陈序公开原始航运档案，还原失踪船只的真相，并决定留在雾港。",
            "style_guide": "第三人称限知，动作推进，简短对白，章末保留具体未解问题。",
            "characters": [{"name": "陈序", "role": "归乡调查者", "motivation": "寻找失踪父亲的去向",
                "arc": "从只相信证据到学会与他人协作，承担公开真相的代价。"},
                {"name": "林知夏", "role": "码头档案员", "motivation": "保护家人留下的档案",
                 "arc": "从回避调查到主动交出关键线索。"}],
            "world": [{"name": "雾港旧码头", "rule": "旧航运档案由港务公司保管，失踪船只资料不对外公开。"}],
            "volumes": [{"title": "第一卷 雨夜归港", "summary": "一封信引出失踪船只与被删改的记录。",
                "climax": "陈序找到原始航海日志。", "ending_hook": "日志上出现了他自己的名字。", "planned_chapters": 30},
                {"title": "第二卷 潮下旧案", "summary": "追查当年的证人与航运公司的利益链。",
                 "climax": "找到失踪船只的真正目的地。", "ending_hook": "父亲可能仍然活着。", "planned_chapters": 30},
                {"title": "第三卷 无人来信", "summary": "保护证人并将旧案证据送出雾港。",
                 "climax": "公开档案，与幕后的操纵者对峙。", "ending_hook": "最后一封信终于送达。", "planned_chapters": 30}]}, ensure_ascii=False)
    if task == "outline":
        production = body["production"]
        titles = ["雨夜来信", "旧码头", "没有名字的船", "潮水之下", "第二封信"]
        return json.dumps({"kind": "outline", "volume_title": production["volume"]["title"],
            "chapters": [{"number": number, "title": titles[number - 1] if number <= 5 else f"线索{number}",
                "goal": f"演示细纲第{number}章：陈序追查来信中的线索，发现旧港的新秘密。",
                "conflict": "关键记录被人拿走，知情者不愿开口。", "beats": ["循着线索抵达现场", "与知情者交换信息", "发现与预期不符的证据"],
                "ending_hook": "证据指向一个本不该出现的人。"} for number in range(
                    production["start_number"], production["start_number"] + production["chapter_count"])]}, ensure_ascii=False)
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
    if config["json_mode"] and task in {"extract", "review", "plan", "handoff", "blueprint", "outline"}:
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
                    raw = await bounded_body(response, 4_000_000)
                    yield completion_part(json.loads(raw), streaming=False)
                    return
                data_lines: list[str] = []
                event_size = 0
                ended = False

                def parse_event(data: str):
                    nonlocal ended
                    if data == "[DONE]":
                        ended = True
                        return None
                    return completion_part(json.loads(data), streaming=True)

                async for line in bounded_lines(response):
                    if line.startswith("data:"):
                        event_size += len(line.encode("utf-8")) + 1
                        if event_size > 1_000_000:
                            raise ProviderFailure("RESPONSE_TOO_LARGE", "流式事件超过大小限制。", True)
                        data_lines.append(line[5:].lstrip(" "))
                    elif not line and data_lines:
                        part = parse_event("\n".join(data_lines))
                        data_lines.clear()
                        event_size = 0
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
    except (ValueError, KeyError, IndexError, TypeError, RecursionError) as exc:
        raise ProviderFailure("INVALID_RESPONSE", "服务返回了无法解析的响应，已保留可用片段。", True) from exc
