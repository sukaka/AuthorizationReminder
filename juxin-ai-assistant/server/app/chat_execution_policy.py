from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal


ExecutionMode = Literal["foreground", "background"]

_INFORMATION_MARKERS = (
    "什么是",
    "是什么意思",
    "如何写",
    "怎么写",
    "如何制作",
    "怎么制作",
    "写法",
    "教程",
    "为什么",
)
_SHORT_OUTPUT_MARKERS = (
    "简短",
    "简要",
    "一句话",
    "两句话",
    "三句话",
    "三个要点",
    "摘要",
    "提纲",
    "大纲",
)
_GENERATION_ACTIONS = (
    "生成",
    "撰写",
    "编写",
    "起草",
    "制作",
    "输出",
    "写一份",
    "写个",
    "帮我写",
    "整理一份",
    "出一份",
    "形成",
)
_LONG_DELIVERABLES = (
    "报告",
    "方案",
    "白皮书",
    "建议书",
    "计划书",
    "可行性研究",
    "分析材料",
    "调研材料",
    "总结材料",
)
_LONG_FORM_MARKERS = ("详细", "完整", "深入", "全面", "长篇")
_WORD_COUNT_PATTERN = re.compile(r"(?:不少于|至少|约|大约)?\d{3,5}字")


@dataclass(frozen=True)
class ChatExecutionDecision:
    mode: ExecutionMode
    reason: str


def decide_chat_execution(
    question: str,
    *,
    ppt_intent: str | None = None,
) -> ChatExecutionDecision:
    """Choose delivery semantics without depending on a particular model provider."""

    if ppt_intent:
        return ChatExecutionDecision(
            mode="background",
            reason="PPT 生成或调整默认在后台处理",
        )

    normalized = "".join(str(question).casefold().split())
    if not normalized:
        return ChatExecutionDecision(
            mode="foreground",
            reason="普通问答使用前台流式输出",
        )
    if any(marker in normalized for marker in _INFORMATION_MARKERS):
        return ChatExecutionDecision(
            mode="foreground",
            reason="知识问答使用前台流式输出",
        )
    if any(marker in normalized for marker in _SHORT_OUTPUT_MARKERS):
        return ChatExecutionDecision(
            mode="foreground",
            reason="短内容使用前台流式输出",
        )

    requests_generation = any(action in normalized for action in _GENERATION_ACTIONS)
    requests_deliverable = any(noun in normalized for noun in _LONG_DELIVERABLES)
    requests_long_form = (
        any(marker in normalized for marker in _LONG_FORM_MARKERS)
        or bool(_WORD_COUNT_PATTERN.search(normalized))
    )
    if requests_generation and requests_deliverable:
        return ChatExecutionDecision(
            mode="background",
            reason="长报告或正式材料默认在后台处理",
        )
    if requests_generation and requests_long_form:
        return ChatExecutionDecision(
            mode="background",
            reason="长内容生成默认在后台处理",
        )
    return ChatExecutionDecision(
        mode="foreground",
        reason="普通问答使用前台流式输出",
    )
