"""Framework-independent document, citation and state rules."""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import UTC, datetime
from difflib import SequenceMatcher
from typing import Any


class DomainError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, **details: Any):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details


def uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def now() -> str:
    return datetime.now(UTC).isoformat()


def normalize(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def digest(value: Any) -> str:
    raw = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def char_count(text: str) -> int:
    # Unicode White_Space, shared with the frontend (not JS/Python-specific \s).
    return len(re.sub(r"[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]", "", text))


def paragraphs(text: str, previous: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Keep equal/edited logical paragraphs stable; split/merge receives fresh IDs."""
    lines = [line for line in normalize(text).split("\n") if line.strip()]
    old = previous or []
    matcher = SequenceMatcher(a=[p["text"] for p in old], b=lines, autojunk=False)
    ids: dict[int, str] = {}
    for tag, i, j, k, end in matcher.get_opcodes():
        if tag == "equal" or (tag == "replace" and j - i == end - k):
            for old_i, new_i in zip(range(i, j), range(k, end), strict=True):
                ids[new_i] = old[old_i]["paragraph_id"]
    return [
        {"paragraph_id": ids.get(i, uid("p")), "ordinal": i, "text": line}
        for i, line in enumerate(lines)
    ]


def text_document(text: str) -> dict[str, Any]:
    blocks = normalize(text).split("\n\n")
    content = []
    for block in blocks:
        children: list[dict[str, Any]] = []
        for i, line in enumerate(block.split("\n")):
            if i:
                children.append({"type": "hardBreak"})
            if line:
                children.append({"type": "text", "text": line})
        content.append({"type": "paragraph", **({"content": children} if children else {})})
    return {"type": "doc", "content": content or [{"type": "paragraph"}]}


def document_text(document: dict[str, Any]) -> str:
    """Only the deliberately small manuscript schema is accepted from the browser."""
    def inline(node: dict[str, Any], depth: int = 0) -> str:
        if not isinstance(node, dict) or depth > 1:
            raise DomainError("INVALID_DOCUMENT", "文档嵌套过深。")
        kind = node.get("type")
        if kind == "text":
            marks = node.get("marks", [])
            if not isinstance(marks, list) or any(not isinstance(m, dict)
                    or m.get("type") not in {"bold", "italic", "strike", "code"} for m in marks):
                raise DomainError("INVALID_DOCUMENT", "文档包含不支持的标记。")
            value = node.get("text")
            if not isinstance(value, str) or not value:
                raise DomainError("INVALID_DOCUMENT", "文本节点无效。")
            return value
        if kind == "hardBreak":
            return "\n"
        if kind == "paragraph" and depth == 0 and isinstance(node.get("content", []), list):
            return "".join(inline(child, depth + 1) for child in node.get("content", []))
        raise DomainError("INVALID_DOCUMENT", "正文仅支持段落与基本文本格式。")
    if not isinstance(document, dict) or document.get("type") != "doc":
        raise DomainError("INVALID_DOCUMENT", "文档格式无效。")
    content = document.get("content", [])
    if not isinstance(content, list) or len(content) > 10000:
        raise DomainError("INVALID_DOCUMENT", "段落数量超出单章限制。")
    if any(not isinstance(block, dict) or block.get("type") != "paragraph" for block in content):
        raise DomainError("INVALID_DOCUMENT", "正文顶层仅支持段落。")
    return "\n\n".join(inline(block) for block in content)


def validate_document(text: str, doc: dict[str, Any] | None) -> dict[str, Any]:
    if len(text) > 200_000:
        raise DomainError("DOCUMENT_TOO_LARGE", "单章最多支持二十万个字符，请拆分章节。")
    if doc is not None and normalize(document_text(doc)) != normalize(text):
        raise DomainError("DOCUMENT_MISMATCH", "正文与编辑器文档不一致，未保存。")
    return doc or text_document(text)


def splice_document(document: dict[str, Any], start: int, end: int, replacement: str) -> dict[str, Any]:
    """Preserve supported inline marks outside the rewritten codepoint range."""
    original = document_text(document)
    marks: list[list[dict[str, Any]]] = []
    for i, block in enumerate(document.get("content", [])):
        if i:
            marks.extend([[], []])
        for child in block.get("content", []):
            marks.extend([child.get("marks", [])] * len(child.get("text", "")) if child["type"] == "text" else [[]])
    body = original[:start] + replacement + original[end:]
    marks[start:end] = [[] for _ in replacement]
    blocks = []
    offset = 0
    for block in body.split("\n\n"):
        children: list[dict[str, Any]] = []
        for i, character in enumerate(block):
            style = marks[offset + i]
            if character == "\n":
                children.append({"type": "hardBreak"})
            elif children and children[-1]["type"] == "text" and children[-1].get("marks", []) == style:
                children[-1]["text"] += character
            else:
                children.append({"type": "text", "text": character, **({"marks": style} if style else {})})
        blocks.append({"type": "paragraph", **({"content": children} if children else {})})
        offset += len(block) + 2
    return {"type": "doc", "content": blocks}


def source_for(version: Any, chapter: Any, paragraph: dict[str, Any]) -> dict[str, Any]:
    return {
        "source_id": f"{version.id}:{paragraph['paragraph_id']}",
        "novel_id": chapter.novel_id,
        "chapter_id": chapter.id,
        "chapter_title": chapter.title,
        "chapter_position": chapter.position,
        "version_id": version.id,
        "paragraph_id": paragraph["paragraph_id"],
        "content_hash": version.content_hash,
        "text": paragraph["text"],
        "kind": "canon" if chapter.accepted_version_id == version.id else "draft",
    }


def resolve_evidence(raw: dict[str, Any], sources: list[dict[str, Any]]) -> dict[str, Any]:
    source = next((s for s in sources if s["source_id"] == raw.get("source_id")), None)
    quote = raw.get("quote")
    if source is None or not isinstance(quote, str) or not quote.strip():
        raise DomainError("INVALID_EVIDENCE", "引用来源或原文缺失，不能确认为事实。")
    start = source["text"].find(quote)
    if start < 0:
        raise DomainError("INVALID_EVIDENCE", "引用不能在指定原文版本中找到。")
    return {
        **{key: source[key] for key in ("source_id", "novel_id", "chapter_id", "chapter_title",
            "chapter_position", "version_id", "paragraph_id", "content_hash", "kind") if key in source},
        "quote": quote,
        "start_codepoint": start,
        "end_codepoint": start + len(quote),
    }


ACTIVE_JOB_STATES = {"queued", "running", "pausing", "cancelling"}
TERMINAL_JOB_STATES = {"succeeded", "failed", "cancelled", "interrupted_uncertain"}
TASKS = {"continue", "rewrite", "plan", "extract", "review", "handoff"}


def entity_terms(name: str, aliases: list[str] | None = None) -> list[str]:
    """Return canonical name and all normalized alias terms for smart entity matching."""
    terms: list[str] = [name.strip()] if name and name.strip() else []
    for raw in aliases or []:
        if isinstance(raw, str):
            for part in re.split(r"[,，、\n\t/]+", raw):
                cleaned = part.strip()
                if cleaned and cleaned not in terms:
                    terms.append(cleaned)
    return terms


def split_manuscript(text: str) -> list[dict[str, str]]:
    text = normalize(text).lstrip("\ufeff")
    pattern = re.compile(r"^(?:#{1,3}\s+)?(第[零一二三四五六七八九十百千万两\d]+[章节卷][^\n]*)$", re.M)
    matches = list(pattern.finditer(text))
    if not matches:
        return [{"title": "第一章", "text": text.strip()}]
    result = []
    if text[:matches[0].start()].strip():
        result.append({"title": "序章", "text": text[:matches[0].start()].strip()})
    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        result.append({"title": match.group(1).strip(), "text": text[match.end():end].strip()})
    return result
