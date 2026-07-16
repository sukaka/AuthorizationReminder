from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from sqlalchemy.orm import Session


@dataclass(frozen=True)
class ToolContext:
    user_id: str
    db: Session | None = None
    permissions: set[str] = field(default_factory=set)
    resources: dict[str, Any] = field(default_factory=dict)
    mode: str = ""
    conversation_id: str = ""
    run_id: str = ""
    message_id: str = ""
    idempotency_key: str = ""
    confirmed_idempotency_keys: set[str] = field(default_factory=set)
    tool_scopes: set[str] = field(default_factory=set)


ToolEffect = Literal["read_only", "idempotent_write", "non_idempotent_write"]
ToolDataScope = Literal["user", "resource", "external", "global"]


@dataclass(frozen=True)
class ToolSpec:
    """Machine-checkable contract for an agent tool.

    The default schemas intentionally accept any JSON object so legacy tools can
    be introduced gradually. New or high-risk tools should provide explicit
    required fields and types.
    """

    name: str
    version: str
    input_schema: dict[str, Any] = field(default_factory=lambda: {"type": "object"})
    output_schema: dict[str, Any] = field(default_factory=lambda: {"type": "object"})
    required_permission: str = ""
    allowed_scopes: frozenset[str] = field(default_factory=frozenset)
    data_scopes: frozenset[ToolDataScope] = field(default_factory=frozenset)
    effect: ToolEffect = "read_only"
    timeout_seconds: int = 30
    max_retries: int = 0
    requires_confirmation: bool | None = None
    max_concurrency: int = 1
    redact_input_fields: frozenset[str] = field(default_factory=frozenset)

    def validate(self) -> None:
        if not self.name or not self.version:
            raise ValueError("tool spec name and version are required")
        if self.effect not in {"read_only", "idempotent_write", "non_idempotent_write"}:
            raise ValueError("tool spec effect is invalid")
        valid_data_scopes = {"user", "resource", "external", "global"}
        if not self.data_scopes.issubset(valid_data_scopes):
            raise ValueError("tool spec data scope is invalid")
        if self.effect != "read_only" and not self.data_scopes:
            raise ValueError("mutating tool spec must declare data scope")
        if self.timeout_seconds <= 0 or self.max_retries < 0 or self.max_concurrency <= 0:
            raise ValueError("tool spec limits must be positive")
        for schema in (self.input_schema, self.output_schema):
            if not isinstance(schema, dict) or schema.get("type", "object") != "object":
                raise ValueError("tool schemas must describe an object")
            if not isinstance(schema.get("required", []), list):
                raise ValueError("tool schema required must be a list")

    @property
    def confirmation_required(self) -> bool:
        if self.requires_confirmation is not None:
            return self.requires_confirmation
        return self.effect != "read_only"


@dataclass(frozen=True)
class ToolResult:
    tool_name: str
    status: str = "success"
    payload: dict[str, Any] = field(default_factory=dict)
    output_summary: dict[str, Any] = field(default_factory=dict)
    source_count: int = 0
    error_code: str = ""
    error_message_safe: str = ""
    replayed: bool = False


class BaseTool:
    name = ""
    description = ""
    version = "1"
    required_permission = ""
    data_scopes: frozenset[ToolDataScope] = frozenset()
    # read | write | external.  Non-read tools require a durable invocation.
    effect = "read"

    @property
    def tool_spec(self) -> ToolSpec:
        legacy_effects: dict[str, ToolEffect] = {
            "read": "read_only",
            "write": "idempotent_write",
            "external": "non_idempotent_write",
        }
        try:
            effect = legacy_effects[self.effect]
        except KeyError as exc:
            raise ValueError(f"unsupported legacy tool effect: {self.effect}") from exc
        return ToolSpec(
            name=self.name,
            version=self.version,
            required_permission=self.required_permission,
            data_scopes=self.data_scopes,
            effect=effect,
        )

    def resolve_tool_spec(self, tool_input: dict[str, Any]) -> ToolSpec:
        """Return the call-specific contract for tools with read/write actions."""
        return self.tool_spec

    def run(self, tool_input: dict[str, Any], context: ToolContext) -> ToolResult:
        raise NotImplementedError
