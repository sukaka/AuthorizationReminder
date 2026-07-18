"""Detect and describe files that should be attached to a chat answer."""

from __future__ import annotations

import re


SUPPORTED_CHAT_DOCUMENT_FORMATS = ("docx", "xlsx", "pptx", "md")

_FORMAT_ALIASES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("docx", ("word文档", "word文件", "word", "docx")),
    ("xlsx", ("excel表格", "excel文件", "excel", "xlsx", "xls")),
    ("pptx", ("powerpoint", "pptx", "ppt", "演示文稿", "幻灯片")),
    ("md", ("markdown", "md文档", "md文件", "md")),
)

_DELIVERY_MARKERS = (
    "导出",
    "发给我",
    "发我",
    "发送给我",
    "给我发",
    "传给我",
    "下载",
    "导成",
    "整理成文档",
    "生成文档",
    "生成文件",
)
_CONTENT_MARKERS = (
    "方案",
    "报告",
    "文档",
    "材料",
    "纪要",
    "表格",
    "数据表",
    "清单",
    "台账",
    "明细",
    "演示",
    "幻灯片",
    "presentation",
)
_TABLE_MARKERS = ("表格", "excel", "xlsx", "数据表", "清单", "台账", "明细")
_SLIDE_MARKERS = ("ppt", "pptx", "powerpoint", "演示文稿", "幻灯片", "汇报", "答辩")


def _normalized(question: str) -> str:
    return "".join((question or "").lower().split())


def requested_chat_document_format(question: str) -> str | None:
    """Return the explicitly requested format, if any."""
    normalized = _normalized(question)
    for fmt, aliases in _FORMAT_ALIASES:
        for alias in aliases:
            if alias.isascii():
                if re.search(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", normalized):
                    return fmt
            elif alias in normalized:
                return fmt
    return None


def should_generate_chat_document(question: str) -> bool:
    """Only attach a file when the user asks to create/deliver one."""
    normalized = _normalized(question)
    if not normalized:
        return False
    has_delivery_intent = any(marker in normalized for marker in _DELIVERY_MARKERS)
    has_content_intent = any(marker in normalized for marker in _CONTENT_MARKERS)
    has_explicit_format = requested_chat_document_format(question) is not None
    return has_delivery_intent and (has_content_intent or has_explicit_format)


def choose_chat_document_format(question: str, answer: str) -> str:
    """Prefer the user's format; otherwise choose a predictable content-based default."""
    explicit = requested_chat_document_format(question)
    if explicit:
        return explicit
    combined = f"{question}\n{answer}".lower()
    if any(marker in combined for marker in _TABLE_MARKERS):
        return "xlsx"
    if any(marker in combined for marker in _SLIDE_MARKERS):
        return "pptx"
    return "docx"


def chat_document_title(question: str, answer: str) -> str:
    """Choose a short, safe title for the generated artifact."""
    for line in (answer or "").splitlines():
        candidate = re.sub(r"^[#>*\s]+", "", line).strip()
        candidate = re.sub(r"[*_`]+", "", candidate).strip()
        if candidate and len(candidate) <= 80 and not candidate.startswith(("-", "•")):
            return candidate[:80]
    match = re.search(r"(?:做个|做一份|写一份|生成|整理成)\s*([^，。！？\n]{2,40})", question or "")
    if match:
        return match.group(1).strip()[:80]
    return "聊天生成文档"


def chat_document_file_name(question: str, answer: str, fmt: str) -> str:
    title = chat_document_title(question, answer)
    safe_title = re.sub(r"[\\/:*?\"<>|\r\n]+", " ", title).strip() or "聊天生成文档"
    safe_title = re.sub(r"\s+", " ", safe_title)[:80]
    return f"{safe_title}.{fmt}"


def chat_document_media_type(fmt: str) -> str:
    return {
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "md": "text/markdown",
    }[fmt]
