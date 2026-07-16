"""Deterministic outbound guard for public customer-service answers."""

from __future__ import annotations

import re

from .data_egress import detect_sensitive


MAX_EXTERNAL_QUESTION_CHARS = 2000
MAX_EXTERNAL_ANSWER_CHARS = 6000

_PROMPT_LEAK_PATTERN = re.compile(
    r"(?:系统提示词|system\s*prompt|开发者指令|developer\s*instruction).{0,40}(?:如下|是|为|:|：)",
    re.IGNORECASE,
)


def prepare_external_answer(answer: str, *, source_file_names: list[str]) -> str | None:
    """Return a bounded, attributable answer or block unsafe model output."""
    normalized = (answer or "").strip()
    if not normalized or _PROMPT_LEAK_PATTERN.search(normalized):
        return None
    if detect_sensitive(normalized):
        return None

    sources: list[str] = []
    for name in source_file_names:
        safe_name = " ".join((name or "").split())[:160]
        if safe_name and safe_name not in sources:
            sources.append(safe_name)
        if len(sources) >= 5:
            break
    if not sources:
        return None

    attribution = "资料来源：" + "、".join(sources)
    available = MAX_EXTERNAL_ANSWER_CHARS - len(attribution) - 2
    if available <= 0:
        return None
    return f"{normalized[:available].rstrip()}\n\n{attribution}"
