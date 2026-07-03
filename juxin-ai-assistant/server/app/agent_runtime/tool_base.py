from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

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


@dataclass(frozen=True)
class ToolResult:
    tool_name: str
    status: str = "success"
    payload: dict[str, Any] = field(default_factory=dict)
    output_summary: dict[str, Any] = field(default_factory=dict)
    source_count: int = 0
    error_code: str = ""
    error_message_safe: str = ""


class BaseTool:
    name = ""
    description = ""
    version = "1"
    required_permission = ""

    def run(self, tool_input: dict[str, Any], context: ToolContext) -> ToolResult:
        raise NotImplementedError
