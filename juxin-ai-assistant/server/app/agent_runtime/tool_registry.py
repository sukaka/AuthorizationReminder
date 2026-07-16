from __future__ import annotations

import hashlib
import json
import re
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import AgentToolCallLog, AgentToolInvocation

from .policy_gate import PolicyGate
from .tool_base import BaseTool, ToolContext, ToolResult, ToolSpec


_TOOL_EFFECT_RANK = {
    "read_only": 0,
    "idempotent_write": 1,
    "non_idempotent_write": 2,
}

_CONFIRMATION_ERROR_CODES = {
    "TOOL_IDEMPOTENCY_KEY_REQUIRED",
    "TOOL_CONFIRMATION_REQUIRED",
}
_FORBIDDEN_ERROR_CODES = {
    "TOOL_PERMISSION_DENIED",
    "TOOL_SCOPE_DENIED",
}


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


def _summarize_input(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {"_invalid_input_type": type(value).__name__}
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


def _request_hash(tool_input: dict[str, Any]) -> str:
    try:
        canonical = json.dumps(tool_input, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise ValueError("tool_input must be JSON serializable for a durable invocation") from exc
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _json_object(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    try:
        json.dumps(value, ensure_ascii=False, sort_keys=True)
    except (TypeError, ValueError):
        return None
    return value


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, BaseTool] = {}
        self._enabled: dict[str, bool] = {}
        self._specs: dict[str, ToolSpec] = {}
        self._policy_gate = PolicyGate()

    def register(self, tool: BaseTool, *, enabled: bool = True) -> None:
        spec = tool.tool_spec
        spec.validate()
        if not tool.name:
            raise ValueError("tool name is required")
        if tool.name in self._tools:
            raise ValueError(f"tool already registered: {tool.name}")
        self._tools[tool.name] = tool
        self._enabled[tool.name] = enabled
        self._specs[tool.name] = spec

    def get(self, name: str) -> BaseTool | None:
        return self._tools.get(name)

    def get_spec(self, name: str) -> ToolSpec | None:
        return self._specs.get(name)

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

        if not isinstance(tool_input, dict):
            result = ToolResult(
                tool_name=name,
                status="error",
                error_code="TOOL_INPUT_SCHEMA_INVALID",
                error_message_safe="工具输入必须是对象",
            )
            self._write_log(context, name, tool.version, tool.required_permission, tool_input, result, started, started_at)
            return result

        registered_spec = self._specs[name]
        spec = tool.resolve_tool_spec(tool_input)
        spec.validate()
        if spec.name != name or spec.version != registered_spec.version:
            raise ValueError("resolved tool spec must preserve registered name and version")
        if _TOOL_EFFECT_RANK[spec.effect] < _TOOL_EFFECT_RANK[registered_spec.effect]:
            raise ValueError("resolved tool spec cannot weaken the registered side-effect contract")
        if not registered_spec.data_scopes.issubset(spec.data_scopes):
            raise ValueError("resolved tool spec cannot weaken the registered data scope contract")
        if registered_spec.confirmation_required and not spec.confirmation_required:
            raise ValueError("resolved tool spec cannot weaken the registered confirmation contract")

        if not self._enabled.get(name, True):
            result = ToolResult(
                tool_name=name,
                status="disabled",
                error_code="TOOL_DISABLED",
                error_message_safe="工具已停用",
            )
            self._write_log(context, name, spec.version, spec.required_permission, tool_input, result, started, started_at)
            return result

        decision = self._policy_gate.authorize(spec, tool_input, context)
        if not decision.allowed:
            if decision.error_code in _FORBIDDEN_ERROR_CODES:
                status = "forbidden"
            elif decision.error_code in _CONFIRMATION_ERROR_CODES:
                status = "confirmation_required"
            else:
                status = "error"
            result = ToolResult(
                tool_name=name,
                status=status,
                error_code=decision.error_code,
                error_message_safe=decision.error_message_safe,
            )
            self._write_log(context, name, spec.version, spec.required_permission, tool_input, result, started, started_at)
            return result

        invocation: AgentToolInvocation | None = None
        if spec.effect != "read_only":
            invocation, durable_result = self._begin_invocation(tool, spec, tool_input, context, started_at)
            if durable_result is not None:
                self._write_log(context, name, spec.version, spec.required_permission, tool_input, durable_result, started, started_at)
                return durable_result

        try:
            result = tool.run(tool_input, context)
        except TimeoutError:
            result = ToolResult(
                tool_name=name,
                status="error",
                error_code="TOOL_TIMEOUT",
                error_message_safe="工具执行超时，结果未完成",
            )
        except Exception as exc:
            result = ToolResult(
                tool_name=name,
                status="error",
                error_code="TOOL_EXECUTION_FAILED",
                error_message_safe=_sanitize_error_message(str(exc)),
            )

        if result.status == "success":
            output_decision = self._policy_gate.validate_output(spec, result.payload)
            if not output_decision.allowed:
                result = ToolResult(
                    tool_name=name,
                    status="error",
                    error_code=output_decision.error_code,
                    error_message_safe=output_decision.error_message_safe,
                )

        if invocation is not None:
            result = self._complete_invocation(invocation, result, context)

        self._write_log(context, name, spec.version, spec.required_permission, tool_input, result, started, started_at)
        return result

    def _begin_invocation(
        self,
        tool: BaseTool,
        spec: ToolSpec,
        tool_input: dict[str, Any],
        context: ToolContext,
        started_at: datetime,
    ) -> tuple[AgentToolInvocation | None, ToolResult | None]:
        if not context.run_id or not context.idempotency_key:
            return None, ToolResult(
                tool_name=tool.name,
                status="confirmation_required",
                error_code="TOOL_IDEMPOTENCY_KEY_REQUIRED",
                error_message_safe="写入或外部工具必须绑定任务并提供幂等键",
            )
        if context.idempotency_key not in context.confirmed_idempotency_keys:
            return None, ToolResult(
                tool_name=tool.name,
                status="confirmation_required",
                error_code="TOOL_CONFIRMATION_REQUIRED",
                error_message_safe="该工具会产生副作用，需要用户确认",
            )
        if context.db is None:
            return None, ToolResult(
                tool_name=tool.name,
                status="error",
                error_code="TOOL_DURABLE_CONTEXT_REQUIRED",
                error_message_safe="写入或外部工具需要可持久化的执行上下文",
            )

        try:
            request_hash = _request_hash(tool_input)
        except ValueError:
            return None, ToolResult(
                tool_name=tool.name,
                status="error",
                error_code="TOOL_INPUT_NOT_DURABLE",
                error_message_safe="写入或外部工具的输入必须可安全持久化",
            )
        db: Session = context.db
        existing = db.scalar(
            select(AgentToolInvocation).where(
                AgentToolInvocation.run_id == context.run_id,
                AgentToolInvocation.tool_name == tool.name,
                AgentToolInvocation.idempotency_key == context.idempotency_key,
            )
        )
        if existing is not None:
            return None, self._existing_invocation_result(
                tool,
                existing,
                request_hash,
                db=db,
                timeout_seconds=spec.timeout_seconds,
            )

        invocation = AgentToolInvocation(
            run_id=context.run_id,
            user_id=context.user_id,
            tool_name=tool.name,
            tool_version=tool.version,
            idempotency_key=context.idempotency_key,
            request_hash=request_hash,
            effect=spec.effect,
            status="in_progress",
            started_at=started_at,
        )
        try:
            with db.begin_nested():
                db.add(invocation)
                db.flush()
        except IntegrityError:
            existing = db.scalar(
                select(AgentToolInvocation).where(
                    AgentToolInvocation.run_id == context.run_id,
                    AgentToolInvocation.tool_name == tool.name,
                    AgentToolInvocation.idempotency_key == context.idempotency_key,
                )
            )
            if existing is not None:
                return None, self._existing_invocation_result(
                    tool,
                    existing,
                    request_hash,
                    db=db,
                    timeout_seconds=spec.timeout_seconds,
                )
            raise
        return invocation, None

    def _existing_invocation_result(
        self,
        tool: BaseTool,
        existing: AgentToolInvocation,
        request_hash: str,
        *,
        db: Session,
        timeout_seconds: int,
    ) -> ToolResult:
        if existing.request_hash != request_hash:
            return ToolResult(
                tool_name=tool.name,
                status="error",
                error_code="TOOL_IDEMPOTENCY_KEY_CONFLICT",
                error_message_safe="同一幂等键不能用于不同的工具输入",
            )
        if existing.status == "succeeded" and isinstance(existing.result_payload_json, dict):
            return ToolResult(
                tool_name=tool.name,
                status="success",
                payload=dict(existing.result_payload_json),
                output_summary=dict(existing.output_summary_json or {}),
                source_count=int(existing.source_count or 0),
                replayed=True,
            )
        if existing.status == "failed":
            return ToolResult(
                tool_name=tool.name,
                status="error",
                error_code=existing.error_code or "TOOL_PREVIOUS_INVOCATION_FAILED",
                error_message_safe=existing.error_message_safe or "该工具调用已失败，需使用新的幂等键重试",
            )
        if existing.status == "in_progress" and existing.started_at:
            now = _utc_now()
            reconciled = db.execute(
                update(AgentToolInvocation)
                .where(
                    AgentToolInvocation.id == existing.id,
                    AgentToolInvocation.status == "in_progress",
                    AgentToolInvocation.started_at
                    <= now - timedelta(seconds=timeout_seconds),
                )
                .values(
                    status="reconciliation_required",
                    error_code="TOOL_RECONCILIATION_REQUIRED",
                    error_message_safe="工具调用超过契约超时，结果未知，必须先对账",
                    finished_at=now,
                )
            )
            if reconciled.rowcount:
                db.refresh(existing)
        return ToolResult(
            tool_name=tool.name,
            status="error",
            error_code="TOOL_RECONCILIATION_REQUIRED",
            error_message_safe="该工具调用的结果尚未可安全确认，请先对账后再继续",
        )

    def _complete_invocation(
        self,
        invocation: AgentToolInvocation,
        result: ToolResult,
        context: ToolContext,
    ) -> ToolResult:
        db = context.db
        if db is None:
            return result
        payload = _json_object(result.payload)
        summary = _json_object(result.output_summary)
        invocation.finished_at = _utc_now()
        invocation.source_count = result.source_count
        invocation.output_summary_json = summary
        invocation.error_code = result.error_code
        invocation.error_message_safe = result.error_message_safe
        if result.status == "success" and payload is not None:
            invocation.status = "succeeded"
            invocation.result_payload_json = payload
        elif result.error_code == "TOOL_OUTPUT_SCHEMA_INVALID":
            invocation.status = "reconciliation_required"
            invocation.error_message_safe = "工具已执行，但输出不符合契约，需要人工对账"
            db.add(invocation)
            db.flush()
            return ToolResult(
                tool_name=result.tool_name,
                status="error",
                error_code=invocation.error_code,
                error_message_safe=invocation.error_message_safe,
            )
        elif result.status == "success":
            invocation.status = "reconciliation_required"
            invocation.error_code = "TOOL_RESULT_NOT_REPLAYABLE"
            invocation.error_message_safe = "工具已执行，但结果不可安全回放，需要人工对账"
            db.add(invocation)
            db.flush()
            return ToolResult(
                tool_name=result.tool_name,
                status="error",
                error_code=invocation.error_code,
                error_message_safe=invocation.error_message_safe,
            )
        else:
            invocation.status = "failed"
        db.add(invocation)
        db.flush()
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
