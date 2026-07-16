"""AgentRuntime protocol for 6.0 unified task execution."""

from __future__ import annotations

from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(min_length=1, max_length=64)
    owner_user_id: str = Field(min_length=1, max_length=64)
    input_text: str = Field(min_length=1, max_length=20_000)
    conversation_id: str = Field(default="", max_length=64)
    message_id: str = Field(default="", max_length=64)
    run_type: str = Field(default="chat", max_length=48)
    metadata: dict[str, Any] = Field(default_factory=dict)


class ResumeCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: str = Field(min_length=1, max_length=32)  # retry | confirm | continue
    note: str = Field(default="", max_length=2000)


class RunSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str
    status: str
    stage: str
    progress: int = 0
    model_calls: int = 0
    result: dict[str, Any] = Field(default_factory=dict)
    error_code: str = ""
    error_message_safe: str = ""


class AgentRuntime(Protocol):
    async def start(self, request: RunRequest) -> RunSnapshot: ...

    async def resume(self, run_id: str, command: ResumeCommand) -> RunSnapshot: ...

    async def cancel(self, run_id: str) -> RunSnapshot: ...

    async def inspect(self, run_id: str) -> RunSnapshot: ...
