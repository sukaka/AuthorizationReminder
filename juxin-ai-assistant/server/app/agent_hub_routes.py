"""HTTP API for 7.0 Agent Hub + market + cost-aware invoke."""

from __future__ import annotations

import time
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .agent_audit_service import record_agent_call, record_egress_audit
from .agent_hub import get_agent_hub
from .agent_market_service import list_market, set_connection_status, sync_hub_to_connections
from .auth import get_session, require_action
from .config import Settings, get_settings
from .data_egress import DEST_EXTERNAL_AGENT, DEST_INTERNAL_AGENT, DEST_LOCAL, evaluate_egress
from .database import get_db
from .models import AgentConnection
from .schemas import SessionPayload

router = APIRouter(prefix="/api/ai/agent-hub", tags=["agent-hub"])


class AgentOut(BaseModel):
    agent_id: str
    name: str
    description: str
    version: str
    capabilities: list[str]
    endpoint: str
    status: str


class InvokeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_text: str = Field(min_length=1, max_length=20_000)
    context: dict[str, Any] = Field(default_factory=dict)
    egress_confirmed: bool = False
    run_id: str = Field(default="", max_length=64)


class RegisterHttpAgentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agent_id: str = Field(min_length=2, max_length=64)
    name: str = Field(default="", max_length=128)
    description: str = Field(default="", max_length=1000)
    endpoint: str = Field(min_length=8, max_length=1024)
    capabilities: list[str] = Field(default_factory=lambda: ["http"])
    auth_header: str = Field(default="", max_length=512)
    version: str = Field(default="0.1.0", max_length=32)
    cost_per_call_micros: int = Field(default=500, ge=0, le=1_000_000_000)


class ConnectionStatusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str = Field(..., pattern="^(installed|authorized|disabled)$")


class ConnectionGovernanceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    capabilities: list[str] = Field(default_factory=list, max_length=64)
    policy: dict[str, Any] = Field(default_factory=dict)
    budget: dict[str, int] = Field(default_factory=dict)


async def _require_admin(
    request: Request,
    session: SessionPayload,
    settings: Settings,
) -> None:
    if session.user.role.strip().lower() != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可注册外部 Agent")
    await require_action("ai_assistant:admin", request, session, settings)


def _destination_for_agent(agent_id: str, endpoint: str) -> str:
    if agent_id.startswith("local.") or not endpoint:
        return DEST_LOCAL
    if agent_id.startswith("local"):
        return DEST_INTERNAL_AGENT
    return DEST_EXTERNAL_AGENT


@router.get("/agents", response_model=list[AgentOut])
async def list_agents(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> list[AgentOut]:
    await require_action("ai_assistant:use", request, session, settings)
    return [
        AgentOut(
            agent_id=d.agent_id,
            name=d.name,
            description=d.description,
            version=d.version,
            capabilities=list(d.capabilities),
            endpoint=d.endpoint,
            status=d.status,
        )
        for d in get_agent_hub().list_agents()
    ]


@router.get("/health")
async def hub_health(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    agent_id: str = "",
) -> dict[str, Any]:
    """Agent / connector health (circuit breaker + reachability)."""
    await require_action("ai_assistant:use", request, session, settings)
    items = get_agent_hub().health(agent_id.strip() or None)
    ok_count = sum(1 for i in items if i.get("ok"))
    return {
        "items": items,
        "total": len(items),
        "healthy": ok_count,
        "overall": "ok" if ok_count == len(items) and items else ("degraded" if ok_count else "down"),
    }


@router.get("/market")
async def market_catalog(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    items = list_market(db)
    db.commit()
    return {"items": items, "total": len(items)}


@router.post("/market/{agent_id}/status")
async def market_set_status(
    agent_id: str,
    body: ConnectionStatusIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await _require_admin(request, session, settings)
    try:
        row = set_connection_status(db, agent_id, body.status)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=404, detail="connection_not_found")
    db.commit()
    return {"agent_id": row.agent_id, "status": row.status}


@router.post("/agents/http", response_model=AgentOut, status_code=201)
async def register_http_agent(
    body: RegisterHttpAgentIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> AgentOut:
    await _require_admin(request, session, settings)
    try:
        desc = get_agent_hub().register_http(
            agent_id=body.agent_id.strip().lower(),
            name=body.name,
            description=body.description,
            endpoint=body.endpoint.strip(),
            capabilities=body.capabilities,
            auth_header=body.auth_header,
            version=body.version,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # durable market row
    sync_hub_to_connections(db, actor=str(session.user.id))
    conn = db.scalar(select(AgentConnection).where(AgentConnection.agent_id == desc.agent_id))
    if conn is not None:
        conn.cost_per_call_micros = int(body.cost_per_call_micros)
        db.add(conn)
    db.commit()
    return AgentOut(
        agent_id=desc.agent_id,
        name=desc.name,
        description=desc.description,
        version=desc.version,
        capabilities=list(desc.capabilities),
        endpoint=desc.endpoint,
        status=desc.status,
    )


@router.put("/agents/{agent_id}/governance")
async def configure_agent_governance(
    agent_id: str,
    body: ConnectionGovernanceIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await _require_admin(request, session, settings)
    row = db.scalar(select(AgentConnection).where(AgentConnection.agent_id == agent_id))
    if row is None:
        raise HTTPException(status_code=404, detail="connection_not_found")
    row.capabilities_json = [item.strip()[:64] for item in body.capabilities if item.strip()]
    row.policy_json = body.policy
    row.budget_json = body.budget
    db.add(row)
    db.commit()
    return {
        "agent_id": row.agent_id,
        "capabilities": row.capabilities_json or [],
        "policy": row.policy_json or {},
        "budget": row.budget_json or {},
    }


@router.delete("/agents/{agent_id}", status_code=204)
async def unregister_agent(
    agent_id: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    await _require_admin(request, session, settings)
    if agent_id.startswith("local."):
        raise HTTPException(status_code=400, detail="cannot_remove_builtin")
    if not get_agent_hub().unregister(agent_id):
        raise HTTPException(status_code=404, detail="agent_not_found")
    try:
        set_connection_status(db, agent_id, "disabled")
        db.commit()
    except Exception:
        db.rollback()


@router.post("/agents/{agent_id}/invoke")
async def invoke_agent(
    agent_id: str,
    body: InvokeIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    hub = get_agent_hub()
    agent = hub.get(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="agent_not_found")
    if agent.descriptor.status == "disabled":
        raise HTTPException(status_code=403, detail="agent_disabled")

    destination = _destination_for_agent(agent_id, agent.descriptor.endpoint)
    decision = evaluate_egress(
        body.input_text,
        destination=destination,
        confirmed=body.egress_confirmed,
    )
    user_id = str(session.user.id)
    record_egress_audit(
        db,
        user_id=user_id,
        decision=decision,
        agent_id=agent_id,
        run_id=body.run_id,
        text=body.input_text,
    )

    if not decision.allowed:
        record_agent_call(
            db,
            user_id=user_id,
            agent_id=agent_id,
            status="egress_denied",
            destination=destination,
            run_id=body.run_id,
            data_level=int(decision.level),
            egress_allowed=False,
            request_summary=body.input_text[:200],
            result_summary="blocked by data egress policy",
            detail={"egress": decision.policy, "reasons": decision.reasons},
        )
        db.commit()
        raise HTTPException(
            status_code=403,
            detail={
                "error": "egress_denied",
                "level": int(decision.level),
                "level_label": decision.level_label,
                "requires_confirmation": decision.requires_confirmation,
                "reasons": decision.reasons,
                "policy": decision.policy,
            },
        )

    send_text = decision.redacted_text if decision.redaction_applied else body.input_text
    started = time.perf_counter()
    result = hub.invoke(
        agent_id,
        input_text=send_text,
        context={**body.context, "user_id": user_id, "egress_level": int(decision.level)},
    )
    latency_ms = int((time.perf_counter() - started) * 1000)

    if result.get("error") == "agent_not_found":
        db.commit()
        raise HTTPException(status_code=404, detail="agent_not_found")
    if result.get("error") == "agent_disabled":
        db.commit()
        raise HTTPException(status_code=403, detail="agent_disabled")

    status = "error" if result.get("error") else "succeeded"
    out_preview = str(result.get("output") or result.get("error") or "")[:200]
    record_agent_call(
        db,
        user_id=user_id,
        agent_id=agent_id,
        status=status,
        latency_ms=latency_ms,
        destination=destination,
        run_id=body.run_id,
        data_level=int(decision.level),
        egress_allowed=True,
        request_summary=send_text[:200],
        result_summary=out_preview,
        detail={"egress_redacted": decision.redaction_applied},
    )
    db.commit()
    result = dict(result)
    result["latency_ms"] = latency_ms
    result["egress"] = {
        "level": int(decision.level),
        "level_label": decision.level_label,
        "redaction_applied": decision.redaction_applied,
        "destination": destination,
    }
    return result
