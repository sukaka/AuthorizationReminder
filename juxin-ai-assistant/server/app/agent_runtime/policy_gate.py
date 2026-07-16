from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .tool_base import ToolContext, ToolSpec


@dataclass(frozen=True)
class PolicyDecision:
    allowed: bool
    error_code: str = ""
    error_message_safe: str = ""


def _validate_object_schema(value: dict[str, Any], schema: dict[str, Any]) -> str | None:
    if not isinstance(value, dict):
        return "值必须是对象"
    required = schema.get("required", [])
    properties = schema.get("properties", {})
    for key in required:
        if key not in value:
            return f"缺少必填字段：{key}"
    type_checks = {
        "string": lambda item: isinstance(item, str),
        "integer": lambda item: isinstance(item, int) and not isinstance(item, bool),
        "number": lambda item: isinstance(item, (int, float)) and not isinstance(item, bool),
        "boolean": lambda item: isinstance(item, bool),
        "array": lambda item: isinstance(item, list),
        "object": lambda item: isinstance(item, dict),
    }
    for key, field_schema in properties.items():
        if key not in value or not isinstance(field_schema, dict):
            continue
        expected_type = field_schema.get("type")
        check = type_checks.get(expected_type)
        if check is not None and not check(value[key]):
            return f"字段类型不匹配：{key}"
    return None


class PolicyGate:
    """Single authorization point before every registered tool execution."""

    def authorize(
        self,
        spec: ToolSpec,
        tool_input: dict[str, Any],
        context: ToolContext,
    ) -> PolicyDecision:
        input_error = _validate_object_schema(tool_input, spec.input_schema)
        if input_error:
            return PolicyDecision(False, "TOOL_INPUT_SCHEMA_INVALID", input_error)
        if spec.required_permission and spec.required_permission not in context.permissions:
            return PolicyDecision(False, "TOOL_PERMISSION_DENIED", "没有权限使用该工具")
        if spec.allowed_scopes and not spec.allowed_scopes.intersection(context.tool_scopes):
            return PolicyDecision(False, "TOOL_SCOPE_DENIED", "当前任务范围不允许使用该工具")
        if spec.confirmation_required and (not context.run_id or not context.idempotency_key):
            return PolicyDecision(
                False,
                "TOOL_IDEMPOTENCY_KEY_REQUIRED",
                "写入或外部工具必须绑定任务并提供幂等键",
            )
        if spec.confirmation_required and context.idempotency_key not in context.confirmed_idempotency_keys:
            return PolicyDecision(False, "TOOL_CONFIRMATION_REQUIRED", "该工具会产生副作用，需要用户确认")
        if spec.effect != "read_only" and context.db is None:
            return PolicyDecision(False, "TOOL_DURABLE_CONTEXT_REQUIRED", "写入或外部工具需要可持久化的执行上下文")
        return PolicyDecision(True)

    def validate_output(self, spec: ToolSpec, payload: dict[str, Any]) -> PolicyDecision:
        output_error = _validate_object_schema(payload, spec.output_schema)
        if output_error:
            return PolicyDecision(False, "TOOL_OUTPUT_SCHEMA_INVALID", output_error)
        return PolicyDecision(True)
