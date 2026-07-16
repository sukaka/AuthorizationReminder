"""HTTP API for 7.0 data egress gate."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .agent_audit_service import record_egress_audit
from .auth import get_session, require_action
from .config import Settings, get_settings
from .data_egress import (
    DEST_CHANNEL,
    DEST_EXTERNAL_AGENT,
    DEST_INTERNAL_AGENT,
    DEST_LOCAL,
    decision_to_dict,
    evaluate_egress,
)
from .database import get_db
from .models import EgressAuditLog
from .schemas import SessionPayload

router = APIRouter(prefix="/api/ai/data-egress", tags=["data-egress"])


class EgressEvaluateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(default="", max_length=100_000)
    destination: str = Field(
        default=DEST_EXTERNAL_AGENT,
        max_length=32,
        description="local_model | internal_agent | external_agent | channel",
    )
    confirmed: bool = False
    declared_level: int | None = Field(default=None, ge=0, le=3)
    agent_id: str = Field(default="", max_length=96)
    run_id: str = Field(default="", max_length=64)
    channel: str = Field(default="", max_length=32)
    persist: bool = True


@router.get("/destinations")
async def list_destinations(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    return {
        "destinations": [
            {"id": DEST_LOCAL, "name": "本地模型"},
            {"id": DEST_INTERNAL_AGENT, "name": "内部 Agent"},
            {"id": DEST_EXTERNAL_AGENT, "name": "外部 Agent"},
            {"id": DEST_CHANNEL, "name": "协作渠道（飞书/企微）"},
        ],
        "levels": [
            {"id": 0, "label": "L0 公开"},
            {"id": 1, "label": "L1 内部"},
            {"id": 2, "label": "L2 敏感"},
            {"id": 3, "label": "L3 机密"},
        ],
    }


@router.post("/evaluate")
async def evaluate(
    body: EgressEvaluateIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    decision = evaluate_egress(
        body.text,
        destination=body.destination,
        confirmed=body.confirmed,
        declared_level=body.declared_level,
    )
    result = decision_to_dict(decision)
    result["user_id"] = str(session.user.id)
    if body.persist:
        audit = record_egress_audit(
            db,
            user_id=str(session.user.id),
            decision=decision,
            channel=body.channel,
            agent_id=body.agent_id,
            run_id=body.run_id,
            text=body.text,
        )
        db.commit()
        result["audit_id"] = audit.uuid
    return result


@router.get("/audits")
async def list_egress_audits(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    is_admin = session.user.role.strip().lower() == "admin"
    stmt = select(EgressAuditLog).order_by(EgressAuditLog.id.desc()).limit(limit)
    if not is_admin:
        stmt = (
            select(EgressAuditLog)
            .where(EgressAuditLog.user_id == str(session.user.id))
            .order_by(EgressAuditLog.id.desc())
            .limit(limit)
        )
    rows = list(db.scalars(stmt))
    return {
        "items": [
            {
                "audit_id": r.uuid,
                "user_id": r.user_id,
                "destination": r.destination,
                "channel": r.channel,
                "agent_id": r.agent_id,
                "run_id": r.run_id,
                "data_level": r.data_level,
                "allowed": r.allowed,
                "requires_confirmation": r.requires_confirmation,
                "redaction_applied": r.redaction_applied,
                "policy": r.policy,
                "findings": r.findings_json or [],
                "reasons": r.reasons_json or [],
                "created_at": r.created_at.isoformat() if r.created_at else "",
            }
            for r in rows
        ],
        "total": len(rows),
    }
