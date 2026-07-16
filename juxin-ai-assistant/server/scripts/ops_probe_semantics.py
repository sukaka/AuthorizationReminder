"""Semantic success rules shared by smoke and continuous observation probes."""

from __future__ import annotations

from typing import Any


def _count(body: dict[str, Any], key: str) -> int | None:
    """Parse a non-negative counter without treating malformed data as zero."""

    value = body.get(key)
    if isinstance(value, bool):
        return None
    if isinstance(value, float) and not value.is_integer():
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def semantic_ok(path: str, body: Any) -> bool:
    """Return whether a successful HTTP response is operationally safe.

    Generic business endpoints remain status-code based.  Operational
    endpoints must also satisfy their response contract; malformed counters
    fail closed instead of being coerced to zero.
    """

    route = path.split("?", 1)[0]
    if route not in {
        "/api/ai/health",
        "/health",
        "/api/ai/agent-hub/health",
        "/api/ai/ops/readiness",
        "/api/ai/ops/security-audit",
        "/api/ai/ops/ga-report",
        "/api/ai/ops/checkpoint-suite",
    }:
        return True
    if not isinstance(body, dict):
        return False
    if route in {"/api/ai/health", "/health"}:
        return body.get("status") in {"ok", "healthy"}
    if route == "/api/ai/agent-hub/health":
        healthy = _count(body, "healthy")
        total = _count(body, "total")
        return body.get("overall") == "ok" and healthy is not None and total is not None and healthy == total
    if route == "/api/ai/ops/readiness":
        return body.get("overall") in {"ready", "ready_with_warnings"}
    if route == "/api/ai/ops/security-audit":
        return body.get("overall") in {"pass", "pass_with_warnings"}
    if route == "/api/ai/ops/ga-report":
        summary = body.get("summary")
        failed = _count(summary, "failed") if isinstance(summary, dict) else None
        return isinstance(summary, dict) and failed is not None and failed == 0
    if route == "/api/ai/ops/checkpoint-suite":
        failed = _count(body, "failed")
        return body.get("passed") is True and failed is not None and failed == 0
    return True
