"""7.0 Agent Hub registry (external agents / skills marketplace foundation)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Protocol

from .connector_sdk import HttpConnector, InvokeRequest
from .connector_sdk.vendors.adapters import ConnectorAgentAdapter
from .connector_sdk.vendors.jimeng import JimengConnector
from .connector_sdk.vendors.kimi import KimiConnector


@dataclass(frozen=True)
class AgentDescriptor:
    agent_id: str
    name: str
    description: str
    version: str = "0.1.0"
    capabilities: tuple[str, ...] = ()
    endpoint: str = ""  # empty = in-process
    status: str = "available"  # available | disabled | draft
    auth_header: str = ""  # not exposed in list API
    metadata: dict[str, Any] = field(default_factory=dict)


class ExternalAgent(Protocol):
    descriptor: AgentDescriptor

    def invoke(self, *, input_text: str, context: dict[str, Any] | None = None) -> dict[str, Any]: ...


class LocalEchoAgent:
    def __init__(self) -> None:
        self.descriptor = AgentDescriptor(
            agent_id="local.echo",
            name="本地回声 Agent",
            description="开发与联调用本地 Agent，原样回显输入。",
            capabilities=("echo", "health"),
            endpoint="",
            status="available",
        )

    def invoke(self, *, input_text: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        return {
            "agent_id": self.descriptor.agent_id,
            "output": f"[echo] {input_text}",
            "context_keys": sorted((context or {}).keys()),
        }

    def health(self) -> dict[str, Any]:
        return {
            "ok": True,
            "status": "ok",
            "agent_id": self.descriptor.agent_id,
            "circuit_state": "closed",
        }


class LocalSummaryAgent:
    def __init__(self) -> None:
        self.descriptor = AgentDescriptor(
            agent_id="local.summary",
            name="本地摘要 Agent",
            description="对输入做截断摘要（无外部模型）。",
            capabilities=("summary",),
            status="available",
        )

    def invoke(self, *, input_text: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        text = (input_text or "").strip()
        summary = text if len(text) <= 200 else text[:200] + "…"
        return {
            "agent_id": self.descriptor.agent_id,
            "output": summary,
            "char_count": len(text),
        }

    def health(self) -> dict[str, Any]:
        return {
            "ok": True,
            "status": "ok",
            "agent_id": self.descriptor.agent_id,
            "circuit_state": "closed",
        }


class HttpExternalAgent:
    """Remote agent via Connector SDK (rate limit + circuit + retry)."""

    def __init__(self, descriptor: AgentDescriptor) -> None:
        self.descriptor = descriptor
        self._connector = HttpConnector(
            connector_id=descriptor.agent_id,
            name=descriptor.name,
            endpoint=descriptor.endpoint,
            description=descriptor.description,
            version=descriptor.version,
            capabilities=list(descriptor.capabilities) or ["http"],
            auth_header=descriptor.auth_header,
        )

    def invoke(self, *, input_text: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        result = self._connector.invoke(
            InvokeRequest(input_text=input_text, context=context or {})
        )
        return result.as_hub_dict()

    def health(self) -> dict[str, Any]:
        h = self._connector.health()
        return {
            "ok": h.ok,
            "status": h.status,
            "agent_id": self.descriptor.agent_id,
            "latency_ms": h.latency_ms,
            "detail": h.detail,
            "circuit_state": h.circuit_state,
            "consecutive_failures": h.consecutive_failures,
            "auth_hint": self._connector.public_auth_hint(),
        }


_AGENT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{1,63}$")


def _wrap_connector(connector: KimiConnector | JimengConnector) -> ConnectorAgentAdapter:
    return ConnectorAgentAdapter(
        connector,
        AgentDescriptor(
            agent_id=connector.meta.connector_id,
            name=connector.meta.name,
            description=connector.meta.description,
            version=connector.meta.version,
            capabilities=connector.capability_names(),
            endpoint=connector.meta.endpoint,
            status="available",
            metadata={
                "vendor": connector.meta.vendor,
                "kind": "vendor_connector",
                "dry_run": connector.dry_run,
            },
        ),
    )


def _vendor_agents_from_env() -> list[ExternalAgent]:
    """Register Kimi / 即梦 connectors (dry-run when keys absent)."""
    import os

    try:
        from .config import get_settings

        settings = get_settings()
        kimi_key = (getattr(settings, "kimi_api_key", "") or "").strip()
        kimi_base = (getattr(settings, "kimi_base_url", "") or "").strip()
        kimi_model = (getattr(settings, "kimi_model", "") or "").strip()
        jimeng_key = (getattr(settings, "jimeng_api_key", "") or "").strip()
        jimeng_endpoint = (getattr(settings, "jimeng_endpoint", "") or "").strip()
    except Exception:
        settings = None
        kimi_key = kimi_base = kimi_model = jimeng_key = jimeng_endpoint = ""

    # Env overrides settings for ops flexibility
    kimi_key = (
        os.environ.get("KIMI_API_KEY")
        or os.environ.get("MOONSHOT_API_KEY")
        or kimi_key
        or ""
    ).strip()
    kimi_base = (
        os.environ.get("KIMI_BASE_URL")
        or os.environ.get("MOONSHOT_BASE_URL")
        or kimi_base
        or "https://api.moonshot.cn/v1"
    ).strip()
    kimi_model = (os.environ.get("KIMI_MODEL") or kimi_model or "moonshot-v1-8k").strip()
    jimeng_key = (
        os.environ.get("JIMENG_API_KEY") or os.environ.get("VOLC_ACCESS_KEY") or jimeng_key or ""
    ).strip()
    jimeng_endpoint = (os.environ.get("JIMENG_ENDPOINT") or jimeng_endpoint or "").strip()

    kimi = KimiConnector(
        api_key=kimi_key,
        base_url=kimi_base,
        model=kimi_model,
        dry_run=None,
    )
    jimeng = JimengConnector(
        api_key=jimeng_key,
        endpoint=jimeng_endpoint,
        dry_run=None,
    )
    return [_wrap_connector(kimi), _wrap_connector(jimeng)]


class AgentHub:
    def __init__(self, agents: list[ExternalAgent] | None = None) -> None:
        self._agents: dict[str, ExternalAgent] = {}
        defaults: list[ExternalAgent] = [LocalEchoAgent(), LocalSummaryAgent()]
        if agents is None:
            try:
                defaults.extend(_vendor_agents_from_env())
            except Exception:
                pass  # vendor optional — never block hub boot
            agents = defaults
        for agent in agents:
            self.register(agent)

    def register(self, agent: ExternalAgent) -> None:
        self._agents[agent.descriptor.agent_id] = agent

    def unregister(self, agent_id: str) -> bool:
        return self._agents.pop(agent_id, None) is not None

    def register_http(
        self,
        *,
        agent_id: str,
        name: str,
        description: str,
        endpoint: str,
        capabilities: list[str] | None = None,
        auth_header: str = "",
        version: str = "0.1.0",
    ) -> AgentDescriptor:
        if not _AGENT_ID_RE.match(agent_id):
            raise ValueError("invalid_agent_id")
        if not endpoint.startswith(("http://", "https://")):
            raise ValueError("invalid_endpoint")
        if agent_id.startswith("local."):
            raise ValueError("reserved_agent_id")
        desc = AgentDescriptor(
            agent_id=agent_id,
            name=name or agent_id,
            description=description or "",
            version=version,
            capabilities=tuple(capabilities or ("http",)),
            endpoint=endpoint,
            status="available",
            auth_header=auth_header or "",
            metadata={"kind": "http"},
        )
        self.register(HttpExternalAgent(desc))
        return desc

    def list_agents(self, *, include_disabled: bool = False) -> list[AgentDescriptor]:
        out = []
        for agent in self._agents.values():
            if not include_disabled and agent.descriptor.status == "disabled":
                continue
            out.append(agent.descriptor)
        return sorted(out, key=lambda d: d.agent_id)

    def get(self, agent_id: str) -> ExternalAgent | None:
        return self._agents.get(agent_id)

    def invoke(
        self,
        agent_id: str,
        *,
        input_text: str,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        agent = self.get(agent_id)
        if agent is None:
            return {"error": "agent_not_found", "agent_id": agent_id}
        if agent.descriptor.status == "disabled":
            return {"error": "agent_disabled", "agent_id": agent_id}
        return agent.invoke(input_text=input_text, context=context)

    def health(self, agent_id: str | None = None) -> list[dict[str, Any]]:
        """Probe one or all agents (circuit / reachability)."""
        agents = [self.get(agent_id)] if agent_id else list(self._agents.values())
        out: list[dict[str, Any]] = []
        for agent in agents:
            if agent is None:
                out.append(
                    {
                        "ok": False,
                        "status": "down",
                        "error": "agent_not_found",
                        "agent_id": agent_id,
                    }
                )
                continue
            probe = getattr(agent, "health", None)
            if callable(probe):
                try:
                    out.append(probe())
                except Exception as exc:
                    out.append(
                        {
                            "ok": False,
                            "status": "down",
                            "agent_id": agent.descriptor.agent_id,
                            "detail": str(exc)[:200],
                        }
                    )
            else:
                out.append(
                    {
                        "ok": agent.descriptor.status != "disabled",
                        "status": "ok" if agent.descriptor.status != "disabled" else "down",
                        "agent_id": agent.descriptor.agent_id,
                        "circuit_state": "closed",
                    }
                )
        return out


_hub: AgentHub | None = None


def get_agent_hub() -> AgentHub:
    global _hub
    if _hub is None:
        _hub = AgentHub()
    return _hub


def reset_agent_hub() -> None:
    """Test helper — clear singleton."""
    global _hub
    _hub = None
