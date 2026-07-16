"""Adapt vendor connectors to a minimal duck-typed agent interface.

Descriptor construction lives in ``agent_hub`` to avoid circular imports.
"""

from __future__ import annotations

from typing import Any

from ..base import BaseConnector, InvokeRequest


class ConnectorAgentAdapter:
    """Wrap any BaseConnector; set ``descriptor`` after construction."""

    def __init__(self, connector: BaseConnector, descriptor: Any) -> None:
        self._connector = connector
        self.descriptor = descriptor

    def invoke(self, *, input_text: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        ctx = context or {}
        result = self._connector.invoke(
            InvokeRequest(
                input_text=input_text,
                context=ctx,
                run_id=str(ctx.get("run_id") or ""),
                step_id=str(ctx.get("step_id") or ""),
                data_level=str(ctx.get("data_level") or "L1"),
            )
        )
        return result.as_hub_dict()

    def health(self) -> dict[str, Any]:
        h = self._connector.health()
        auth_hint = ""
        hint_fn = getattr(self._connector, "public_auth_hint", None)
        if callable(hint_fn):
            auth_hint = hint_fn()
        return {
            "ok": h.ok,
            "status": h.status,
            "agent_id": self.descriptor.agent_id,
            "latency_ms": h.latency_ms,
            "detail": h.detail,
            "circuit_state": h.circuit_state,
            "consecutive_failures": h.consecutive_failures,
            "auth_hint": auth_hint,
            "vendor": getattr(self.descriptor, "metadata", {}).get("vendor")
            if isinstance(getattr(self.descriptor, "metadata", None), dict)
            else None,
            "dry_run": getattr(self.descriptor, "metadata", {}).get("dry_run")
            if isinstance(getattr(self.descriptor, "metadata", None), dict)
            else None,
        }
