"""Persist egress audits and agent call cost logs (7.0 §11.10–11.11)."""

from __future__ import annotations

import hashlib
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .data_egress import EgressDecision
from .models import AgentCallLog, AgentConnection, EgressAuditLog


def text_fingerprint(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()[:32]


def record_egress_audit(
    db: Session,
    *,
    user_id: str,
    decision: EgressDecision | dict[str, Any],
    channel: str = "",
    agent_id: str = "",
    run_id: str = "",
    text: str = "",
) -> EgressAuditLog:
    if isinstance(decision, dict):
        allowed = bool(decision.get("allowed"))
        level = int(decision.get("level") or 0)
        requires = bool(decision.get("requires_confirmation"))
        redaction = bool(decision.get("redaction_applied"))
        policy = str(decision.get("policy") or "")
        findings = decision.get("findings") if isinstance(decision.get("findings"), list) else []
        reasons = decision.get("reasons") if isinstance(decision.get("reasons"), list) else []
        destination = str(decision.get("destination") or "")
    else:
        allowed = decision.allowed
        level = int(decision.level)
        requires = decision.requires_confirmation
        redaction = decision.redaction_applied
        policy = decision.policy
        findings = list(decision.findings)
        reasons = list(decision.reasons)
        destination = decision.destination

    row = EgressAuditLog(
        user_id=user_id or "",
        destination=destination,
        channel=channel or "",
        agent_id=agent_id or "",
        run_id=run_id or "",
        data_level=level,
        allowed=allowed,
        requires_confirmation=requires,
        redaction_applied=redaction,
        policy=policy[:255],
        findings_json=findings,
        reasons_json=reasons,
        text_fingerprint=text_fingerprint(text),
    )
    db.add(row)
    db.flush()
    return row


def record_agent_call(
    db: Session,
    *,
    user_id: str,
    agent_id: str,
    status: str,
    latency_ms: int = 0,
    cost_micros: int | None = None,
    destination: str = "",
    channel: str = "",
    run_id: str = "",
    data_level: int = 0,
    egress_allowed: bool = True,
    request_summary: str = "",
    result_summary: str = "",
    detail: dict[str, Any] | None = None,
) -> AgentCallLog:
    if cost_micros is None:
        cost_micros = lookup_agent_cost(db, agent_id)
    row = AgentCallLog(
        user_id=user_id or "",
        agent_id=agent_id or "",
        run_id=run_id or "",
        channel=channel or "",
        destination=destination or "",
        data_level=int(data_level or 0),
        status=status or "succeeded",
        latency_ms=max(0, int(latency_ms or 0)),
        cost_micros=max(0, int(cost_micros or 0)),
        egress_allowed=bool(egress_allowed),
        request_summary=(request_summary or "")[:500],
        result_summary=(result_summary or "")[:500],
        detail_json=detail or {},
    )
    db.add(row)
    db.flush()
    return row


def lookup_agent_cost(db: Session, agent_id: str) -> int:
    row = db.scalar(select(AgentConnection).where(AgentConnection.agent_id == agent_id))
    if row is not None:
        return int(row.cost_per_call_micros or 0)
    # defaults for built-ins
    if agent_id.startswith("local."):
        return 0
    if agent_id.startswith("ext.") or "." in agent_id:
        return 500  # 0.0005 currency units in micros placeholder
    return 0


def cost_summary(db: Session, *, limit_agents: int = 20) -> dict[str, Any]:
    total_calls = int(db.scalar(select(func.count()).select_from(AgentCallLog)) or 0)
    total_cost = int(db.scalar(select(func.coalesce(func.sum(AgentCallLog.cost_micros), 0))) or 0)
    succeeded = int(
        db.scalar(
            select(func.count())
            .select_from(AgentCallLog)
            .where(AgentCallLog.status == "succeeded")
        )
        or 0
    )
    blocked = int(
        db.scalar(
            select(func.count())
            .select_from(AgentCallLog)
            .where(AgentCallLog.status.in_(("blocked", "egress_denied")))
        )
        or 0
    )
    avg_latency = db.scalar(select(func.avg(AgentCallLog.latency_ms))) or 0

    # per-agent breakdown
    rows = db.execute(
        select(
            AgentCallLog.agent_id,
            func.count().label("calls"),
            func.coalesce(func.sum(AgentCallLog.cost_micros), 0).label("cost"),
            func.avg(AgentCallLog.latency_ms).label("avg_ms"),
        )
        .group_by(AgentCallLog.agent_id)
        .order_by(func.count().desc())
        .limit(limit_agents)
    ).all()
    by_agent = [
        {
            "agent_id": r[0],
            "calls": int(r[1] or 0),
            "cost_micros": int(r[2] or 0),
            "avg_latency_ms": round(float(r[3] or 0), 1),
        }
        for r in rows
    ]

    egress_total = int(db.scalar(select(func.count()).select_from(EgressAuditLog)) or 0)
    egress_denied = int(
        db.scalar(
            select(func.count()).select_from(EgressAuditLog).where(EgressAuditLog.allowed.is_(False))
        )
        or 0
    )

    return {
        "calls_total": total_calls,
        "calls_succeeded": succeeded,
        "calls_blocked": blocked,
        "success_rate": (succeeded / total_calls) if total_calls else None,
        "total_cost_micros": total_cost,
        "avg_latency_ms": round(float(avg_latency or 0), 1),
        "by_agent": by_agent,
        "egress_audits_total": egress_total,
        "egress_denied": egress_denied,
    }
