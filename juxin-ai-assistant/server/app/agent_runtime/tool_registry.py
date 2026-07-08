from __future__ import annotations

import re
import time
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models import AgentToolCallLog

from .tool_base import BaseTool, ToolContext, ToolResult


_SECRET_PATTERNS = (
    re.compile(r"\bsk-[A-Za-z0-9_-]{6,}\b"),
    re.compile(
        r"\b(?:api[_-]?key|access[_-]?key|secret|token|authorization|password)\s*[:=]\s*\S+",
        re.IGNORECASE,
    ),
)


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _sanitize_error_message(message: str) -> str:
    sanitized = (message or "").strip()
    for pattern in _SECRET_PATTERNS:
        sanitized = pattern.sub("[REDACTED]", sanitized)
    lowered = sanitized.lower()
    if any(term in lowered for term in ("api key", "apikey", "token", "authorization", "secret")):
        return "工具执行失败，敏感错误信息已隐藏"
    return sanitized[:500]


def _summarize_input(value: dict[str, Any]) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    for key, raw in value.items():
        lowered = key.lower()
        if any(term in lowered for term in ("key", "token", "secret", "password", "authorization")):
            summary[key] = "[REDACTED]"
        elif isinstance(raw, str):
            summary[key] = raw[:200]
        elif isinstance(raw, (int, float, bool)) or raw is None:
            summary[key] = raw
        elif isinstance(raw, list):
            summary[key] = raw[:20]
        elif isinstance(raw, dict):
            summary[key] = {str(k): str(v)[:100] for k, v in list(raw.items())[:20]}
        else:
            summary[key] = str(raw)[:200]
    return summary


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, BaseTool] = {}
        self._enabled: dict[str, bool] = {}

    def register(self, tool: BaseTool, *, enabled: bool = True) -> None:
        if not tool.name:
            raise ValueError("tool name is required")
        if tool.name in self._tools:
            raise ValueError(f"tool already registered: {tool.name}")
        self._tools[tool.name] = tool
        self._enabled[tool.name] = enabled

    def get(self, name: str) -> BaseTool | None:
        return self._tools.get(name)

    def list_tools(self) -> list[str]:
        return sorted(self._tools)

    def set_enabled(self, name: str, enabled: bool) -> None:
        if name not in self._tools:
            raise KeyError(name)
        self._enabled[name] = enabled

    def execute(
        self,
        name: str,
        tool_input: dict[str, Any],
        context: ToolContext,
    ) -> ToolResult:
        started_at = _utc_now()
        started = time.perf_counter()
        tool = self._tools.get(name)
        if tool is None:
            result = ToolResult(
                tool_name=name,
                status="missing",
                error_code="TOOL_NOT_FOUND",
                error_message_safe="工具不存在",
            )
            self._write_log(context, name, "", "", tool_input, result, started, started_at)
            return result

        if not self._enabled.get(name, True):
            result = ToolResult(
                tool_name=name,
                status="disabled",
                error_code="TOOL_DISABLED",
                error_message_safe="工具已停用",
            )
            self._write_log(context, name, tool.version, tool.required_permission, tool_input, result, started, started_at)
            return result

        if tool.required_permission and tool.required_permission not in context.permissions:
            result = ToolResult(
                tool_name=name,
                status="forbidden",
                error_code="TOOL_PERMISSION_DENIED",
                error_message_safe="没有权限使用该工具",
            )
            self._write_log(context, name, tool.version, tool.required_permission, tool_input, result, started, started_at)
            return result

        try:
            result = tool.run(tool_input, context)
        except Exception as exc:
            result = ToolResult(
                tool_name=name,
                status="error",
                error_code="TOOL_EXECUTION_FAILED",
                error_message_safe=_sanitize_error_message(str(exc)),
            )

        self._write_log(context, name, tool.version, tool.required_permission, tool_input, result, started, started_at)
        return result

    def _write_log(
        self,
        context: ToolContext,
        tool_name: str,
        tool_version: str,
        permission: str,
        tool_input: dict[str, Any],
        result: ToolResult,
        started: float,
        started_at: datetime,
    ) -> None:
        if context.db is None:
            return
        db: Session = context.db
        latency_ms = max(0, int((time.perf_counter() - started) * 1000))
        db.add(
            AgentToolCallLog(
                run_id=context.run_id,
                message_id=context.message_id,
                user_id=context.user_id,
                conversation_id=context.conversation_id,
                mode=context.mode,
                tool_name=tool_name,
                tool_version=tool_version,
                status=result.status,
                permission=permission,
                latency_ms=latency_ms,
                source_count=result.source_count,
                input_summary_json=_summarize_input(tool_input),
                output_summary_json=result.output_summary,
                error_code=result.error_code,
                error_message_safe=result.error_message_safe,
                started_at=started_at,
                finished_at=_utc_now(),
            )
        )
        db.flush()
