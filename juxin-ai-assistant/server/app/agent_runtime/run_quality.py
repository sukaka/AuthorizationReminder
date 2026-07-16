"""Delivery-time quality gate for NativeRuntime formal answers."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RunQualityResult:
    passed: bool
    issues: list[str]
    risk: str  # low | medium | high


def check_delivery_quality(
    *,
    answer: str,
    snippets_used: int,
    require_citations: bool = True,
) -> RunQualityResult:
    issues: list[str] = []
    text = str(answer or "").strip()
    if len(text) < 8:
        issues.append("回答过短或不完整")
    if not text:
        issues.append("空回答")
    # Absolute/unsafe claims
    for banned in ("保证 100%", "绝对不会", "一定能通过等保", "可绕过权限"):
        if banned in text:
            issues.append(f"存在绝对化或不安全表述：{banned}")
    refused = "未找到明确依据" in text or "无依据拒答" in text
    if require_citations and snippets_used > 0 and not refused:
        if not any(token in text for token in ("《", "来源", "资料", "文件", "页")):
            issues.append("使用了资料但未体现引用来源")
    if snippets_used == 0 and any(
        token in text for token in ("根据手册", "原文规定", "公司制度明确")
    ):
        issues.append("无资料依据却断言制度原文")
    # Correct no-evidence refusal is a pass
    if snippets_used == 0 and refused:
        issues = [i for i in issues if i not in {"回答过短或不完整"}]

    risk = "low"
    if any("不安全" in i or "权限" in i or "绝对" in i for i in issues):
        risk = "high"
    elif issues:
        risk = "medium"
    return RunQualityResult(passed=not issues, issues=issues, risk=risk)
