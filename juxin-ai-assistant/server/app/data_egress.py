"""7.0 data egress classification and gate (plan §11.10).

Deterministic policy — never delegated to the model.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any


class DataLevel(IntEnum):
    L0_PUBLIC = 0
    L1_INTERNAL = 1
    L2_SENSITIVE = 2
    L3_CONFIDENTIAL = 3


LEVEL_LABELS = {
    DataLevel.L0_PUBLIC: "L0 公开",
    DataLevel.L1_INTERNAL: "L1 内部",
    DataLevel.L2_SENSITIVE: "L2 敏感",
    DataLevel.L3_CONFIDENTIAL: "L3 机密",
}


# Destination kinds for external agents / channels
DEST_LOCAL = "local_model"
DEST_INTERNAL_AGENT = "internal_agent"
DEST_EXTERNAL_AGENT = "external_agent"
DEST_CHANNEL = "channel"  # feishu / wecom outbound


SENSITIVE_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("password", re.compile(r"(密码|口令|password|passwd)\s*[:=：]?\s*\S+", re.I)),
    ("secret_key", re.compile(r"(api[_-]?key|secret|token)\s*[:=：]\s*\S+", re.I)),
    ("id_card", re.compile(r"\b\d{17}[\dXx]\b")),
    ("phone", re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")),
    ("bank_card", re.compile(r"(?<!\d)\d{16,19}(?!\d)")),
)

CONFIDENTIAL_MARKERS = (
    "机密",
    "绝密",
    "商密",
    "未解密",
    "L3",
    "confidential",
)

INTERNAL_MARKERS = (
    "内部",
    "仅限员工",
    "公司内部",
    "intranet",
)


@dataclass
class EgressDecision:
    allowed: bool
    level: DataLevel
    level_label: str
    destination: str
    requires_confirmation: bool = False
    redaction_applied: bool = False
    reasons: list[str] = field(default_factory=list)
    findings: list[str] = field(default_factory=list)
    redacted_text: str = ""
    policy: str = ""


def classify_text(text: str, *, declared_level: int | None = None) -> DataLevel:
    raw = text or ""
    if declared_level is not None:
        try:
            return DataLevel(int(declared_level))
        except ValueError:
            pass
    lower = raw.lower()
    if any(m.lower() in lower or m in raw for m in CONFIDENTIAL_MARKERS):
        return DataLevel.L3_CONFIDENTIAL
    findings = detect_sensitive(raw)
    if findings:
        return DataLevel.L2_SENSITIVE
    if any(m in raw or m.lower() in lower for m in INTERNAL_MARKERS):
        return DataLevel.L1_INTERNAL
    return DataLevel.L0_PUBLIC


def detect_sensitive(text: str) -> list[str]:
    hits: list[str] = []
    for name, pattern in SENSITIVE_PATTERNS:
        if pattern.search(text or ""):
            hits.append(name)
    return hits


def redact_text(text: str) -> str:
    out = text or ""
    for name, pattern in SENSITIVE_PATTERNS:
        out = pattern.sub(f"[已脱敏:{name}]", out)
    return out


def evaluate_egress(
    text: str,
    *,
    destination: str,
    confirmed: bool = False,
    declared_level: int | None = None,
) -> EgressDecision:
    """Gate outbound content by data level and destination."""
    dest = (destination or DEST_LOCAL).strip().lower()
    level = classify_text(text, declared_level=declared_level)
    findings = detect_sensitive(text)
    reasons: list[str] = []
    allowed = True
    requires_confirmation = False
    redacted = text
    redaction_applied = False
    policy = ""

    if level == DataLevel.L3_CONFIDENTIAL:
        policy = "L3 仅本地模型与内部 Agent"
        if dest in {DEST_EXTERNAL_AGENT, DEST_CHANNEL}:
            allowed = False
            reasons.append("机密数据禁止发送至外部 Agent 或协作渠道")
        else:
            reasons.append("机密数据仅允许本地/内部处理")

    elif level == DataLevel.L2_SENSITIVE:
        policy = "L2 需脱敏且经确认后方可出域"
        if dest in {DEST_EXTERNAL_AGENT, DEST_CHANNEL}:
            redacted = redact_text(text)
            redaction_applied = redacted != text
            requires_confirmation = True
            if not confirmed:
                allowed = False
                reasons.append("敏感数据出域需要用户确认")
            else:
                reasons.append("已确认出域，内容已尝试脱敏")
            if findings and not redaction_applied:
                # still allow after confirm but note residual risk
                reasons.append("仍可能残留敏感字段，请人工复核")
        else:
            reasons.append("敏感数据在本地/内部处理，无需出域确认")

    elif level == DataLevel.L1_INTERNAL:
        policy = "L1 仅发送必要片段并记录审计"
        if dest == DEST_EXTERNAL_AGENT:
            reasons.append("内部数据发往外部 Agent：仅限必要片段，须审计")
        else:
            reasons.append("内部数据在授权范围内传输")

    else:
        policy = "L0 可发送至授权外部 Agent"
        reasons.append("公开数据可按授权发送")

    return EgressDecision(
        allowed=allowed,
        level=level,
        level_label=LEVEL_LABELS[level],
        destination=dest,
        requires_confirmation=requires_confirmation,
        redaction_applied=redaction_applied,
        reasons=reasons,
        findings=findings,
        redacted_text=redacted if redaction_applied else text,
        policy=policy,
    )


def decision_to_dict(d: EgressDecision) -> dict[str, Any]:
    return {
        "allowed": d.allowed,
        "level": int(d.level),
        "level_label": d.level_label,
        "destination": d.destination,
        "requires_confirmation": d.requires_confirmation,
        "redaction_applied": d.redaction_applied,
        "reasons": d.reasons,
        "findings": d.findings,
        "redacted_text": d.redacted_text if d.redaction_applied else "",
        "policy": d.policy,
    }
