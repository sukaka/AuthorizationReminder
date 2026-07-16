"""Agent market / connection registry (7.0 §11.12 foundation)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .agent_hub import get_agent_hub
from .models import AgentConnection, AgentProvider


def ensure_default_providers(db: Session) -> None:
    defaults = [
        ("local", "本地运行时", "internal", ""),
        ("http", "HTTP 外部 Agent", "external", ""),
        ("moonshot", "Kimi / Moonshot", "external", "https://api.moonshot.cn/v1"),
        ("jimeng", "即梦视觉", "external", ""),
        ("feishu", "飞书通道", "channel", ""),
        ("wecom", "企业微信通道", "channel", ""),
    ]
    for key, name, kind, url in defaults:
        existing = db.scalar(select(AgentProvider).where(AgentProvider.provider_key == key))
        if existing is None:
            db.add(
                AgentProvider(
                    provider_key=key,
                    name=name,
                    kind=kind,
                    status="available",
                    base_url=url,
                    metadata_json={},
                )
            )
    db.flush()


def sync_hub_to_connections(db: Session, *, actor: str = "system") -> list[AgentConnection]:
    """Mirror in-memory hub agents into durable connection rows."""
    ensure_default_providers(db)
    hub = get_agent_hub()
    out: list[AgentConnection] = []
    for desc in hub.list_agents(include_disabled=True):
        row = db.scalar(select(AgentConnection).where(AgentConnection.agent_id == desc.agent_id))
        meta = desc.metadata if isinstance(desc.metadata, dict) else {}
        vendor = str(meta.get("vendor") or "")
        if desc.agent_id.startswith("local."):
            provider = "local"
        elif vendor in {"moonshot", "jimeng"}:
            provider = vendor
        elif desc.agent_id.startswith("kimi."):
            provider = "moonshot"
        elif desc.agent_id.startswith("jimeng."):
            provider = "jimeng"
        else:
            provider = "http"
        cost_defaults = {
            "local": 0,
            "moonshot": 2000,
            "jimeng": 5000,
            "http": 500,
        }
        if row is None:
            row = AgentConnection(
                agent_id=desc.agent_id,
                provider_key=provider,
                name=desc.name,
                endpoint=desc.endpoint or "",
                status="installed" if desc.status == "available" else "disabled",
                capabilities_json=list(desc.capabilities),
                cost_per_call_micros=cost_defaults.get(provider, 500),
                installed_by=actor,
                metadata_json={
                    "version": desc.version,
                    "dry_run": bool(meta.get("dry_run")),
                    "vendor": vendor or provider,
                },
            )
            db.add(row)
        else:
            row.name = desc.name
            row.endpoint = desc.endpoint or row.endpoint
            row.capabilities_json = list(desc.capabilities)
            row.status = "installed" if desc.status == "available" else "disabled"
            db.add(row)
        out.append(row)
    db.flush()
    return out


def list_market(db: Session) -> list[dict]:
    ensure_default_providers(db)
    sync_hub_to_connections(db)
    providers = {
        p.provider_key: p
        for p in db.scalars(select(AgentProvider).order_by(AgentProvider.provider_key))
    }
    connections = list(db.scalars(select(AgentConnection).order_by(AgentConnection.agent_id)))
    return [
        {
            "agent_id": c.agent_id,
            "name": c.name,
            "provider_key": c.provider_key,
            "provider_name": providers[c.provider_key].name if c.provider_key in providers else c.provider_key,
            "endpoint": c.endpoint,
            "status": c.status,
            "capabilities": c.capabilities_json or [],
            "policy": c.policy_json or {},
            "budget": c.budget_json or {},
            "cost_per_call_micros": int(c.cost_per_call_micros or 0),
            "installed_by": c.installed_by,
        }
        for c in connections
    ]


def set_connection_status(db: Session, agent_id: str, status: str) -> AgentConnection | None:
    if status not in {"installed", "authorized", "disabled"}:
        raise ValueError("invalid_status")
    row = db.scalar(select(AgentConnection).where(AgentConnection.agent_id == agent_id))
    if row is None:
        return None
    row.status = status
    db.add(row)
    db.flush()
    # mirror disable to hub for external agents
    hub = get_agent_hub()
    agent = hub.get(agent_id)
    if agent is not None and status == "disabled":
        # AgentDescriptor is frozen — re-register with disabled status via metadata hack:
        # unregister external only
        if not agent_id.startswith("local."):
            hub.unregister(agent_id)
    return row
