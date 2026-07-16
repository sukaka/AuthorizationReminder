"""ModelGateway: thin model-layer foundation for 7.0 Agent Gateway.

Provides a stable project interface so runtimes do not call vendors directly.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from .config import Settings
from .server_model_client import (
    ModelRequestConfig,
    ServerModelResult,
    generate_with_model_config,
    is_server_model_configured,
)


@dataclass(frozen=True)
class ModelInvocation:
    messages: list[dict[str, str]]
    temperature: float = 0.2
    purpose: str = "chat"


class ModelGateway(Protocol):
    async def complete(self, invocation: ModelInvocation) -> ServerModelResult: ...

    def is_ready(self) -> bool: ...


class SettingsModelGateway:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def is_ready(self) -> bool:
        return is_server_model_configured(self.settings)

    async def complete(self, invocation: ModelInvocation) -> ServerModelResult:
        config = ModelRequestConfig(
            base_url=self.settings.server_model_base_url,
            api_key=self.settings.server_model_api_key,
            model_id=self.settings.server_model_id,
            display_name=self.settings.server_model_display_name or self.settings.server_model_id,
            timeout_seconds=self.settings.server_model_timeout_seconds,
            max_output_tokens=self.settings.server_model_max_output_tokens,
            disable_thinking=True,
        )
        return await generate_with_model_config(
            config,
            invocation.messages,
            invocation.temperature,
        )


class RecordingModelGateway:
    """Test double that records invocations without network I/O."""

    def __init__(self, reply: str = "测试模型回复") -> None:
        self.reply = reply
        self.calls: list[ModelInvocation] = []

    def is_ready(self) -> bool:
        return True

    async def complete(self, invocation: ModelInvocation) -> ServerModelResult:
        self.calls.append(invocation)
        return ServerModelResult(
            output=self.reply,
            model_display_name="test-model",
            model_id="test",
            usage={"prompt_tokens": 1, "completion_tokens": 1},
            latency_ms=1,
        )
