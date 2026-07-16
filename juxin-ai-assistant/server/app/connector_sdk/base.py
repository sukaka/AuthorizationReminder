"""Connector protocol and shared DTOs (7.0 Capability Registry)."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class CapabilitySpec:
    """Registered capability of a connector/agent."""

    name: str
    description: str = ""
    input_schema: dict[str, Any] = field(default_factory=dict)
    output_schema: dict[str, Any] = field(default_factory=dict)
    streaming: bool = False
    async_callback: bool = False
    max_data_level: str = "L1"  # L0 public … L3 confidential
    timeout_sec: float = 30.0
    cost_per_call_micros: int = 0


@dataclass(frozen=True)
class ConnectorMeta:
    connector_id: str
    name: str
    vendor: str = "internal"
    version: str = "0.1.0"
    description: str = ""
    capabilities: tuple[CapabilitySpec, ...] = ()
    endpoint: str = ""
    status: str = "available"  # available | disabled | degraded | draft


@dataclass
class ConnectorHealth:
    ok: bool
    status: str = "ok"  # ok | degraded | down | unknown
    latency_ms: int | None = None
    detail: str = ""
    circuit_state: str = "closed"  # closed | open | half_open
    consecutive_failures: int = 0


@dataclass
class InvokeRequest:
    input_text: str
    context: dict[str, Any] = field(default_factory=dict)
    run_id: str = ""
    step_id: str = ""
    data_level: str = "L1"
    timeout_sec: float | None = None


@dataclass
class InvokeResult:
    ok: bool
    output: str = ""
    data: dict[str, Any] = field(default_factory=dict)
    error: str = ""
    error_code: str = ""
    latency_ms: int = 0
    attempts: int = 1
    connector_id: str = ""

    def as_hub_dict(self) -> dict[str, Any]:
        """Shape compatible with AgentHub.invoke return values."""
        if not self.ok:
            payload: dict[str, Any] = {
                "error": self.error_code or "invoke_failed",
                "agent_id": self.connector_id,
                "detail": self.error or self.output,
            }
            if self.data:
                payload["body"] = self.data
            return payload
        out: dict[str, Any] = {
            "agent_id": self.connector_id,
            "output": self.output,
            "latency_ms": self.latency_ms,
            "attempts": self.attempts,
        }
        if self.data:
            out.update({k: v for k, v in self.data.items() if k not in out})
        return out


class BaseConnector(ABC):
    """Minimal contract every published connector must implement."""

    meta: ConnectorMeta

    @abstractmethod
    def health(self) -> ConnectorHealth:
        ...

    @abstractmethod
    def invoke(self, request: InvokeRequest) -> InvokeResult:
        ...

    def capability_names(self) -> tuple[str, ...]:
        return tuple(c.name for c in self.meta.capabilities)
