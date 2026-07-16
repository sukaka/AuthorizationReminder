"""7.0 smart agent routing (plan §11.3).

Order: egress/permission filter → user preference → score by capability/cost/latency/health.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .agent_hub import AgentDescriptor, get_agent_hub
from .data_egress import DEST_EXTERNAL_AGENT, DEST_INTERNAL_AGENT, DEST_LOCAL, DataLevel, classify_text
from .models import AgentCallLog, AgentConnection


@dataclass
class RouteCandidate:
    agent_id: str
    name: str
    score: float
    reasons: list[str] = field(default_factory=list)
    cost_per_call_micros: int = 0
    avg_latency_ms: float = 0.0
    success_rate: float | None = None
    capabilities: list[str] = field(default_factory=list)
    destination: str = DEST_LOCAL


@dataclass
class RouteResult:
    selected_agent_id: str | None
    candidates: list[RouteCandidate]
    filtered_out: list[dict[str, Any]]
    routing_reasons: list[str]
    data_level: int
    preferred_agent_id: str = ""


def _destination_for(agent_id: str, endpoint: str) -> str:
    if agent_id.startswith("local.") or not endpoint:
        return DEST_LOCAL
    return DEST_EXTERNAL_AGENT


def _infer_needed_capabilities(text: str, explicit: list[str] | None) -> list[str]:
    if explicit:
        return [c.strip().lower() for c in explicit if c.strip()]
    t = (text or "").lower()
    caps: list[str] = []
    if any(k in t for k in ("摘要", "总结", "summary", "概括")):
        caps.append("summary")
    if any(k in t for k in ("回声", "echo", "ping", "测试")):
        caps.append("echo")
    if any(k in t for k in ("http", "外部", "远程")):
        caps.append("http")
    if any(k in t for k in ("健康", "health")):
        caps.append("health")
    return caps


def _agent_stats(db: Session, agent_id: str) -> tuple[float, float | None]:
    """Return (avg_latency_ms, success_rate)."""
    total = int(
        db.scalar(
            select(func.count()).select_from(AgentCallLog).where(AgentCallLog.agent_id == agent_id)
        )
        or 0
    )
    if total <= 0:
        return 50.0, None  # neutral prior
    avg = float(
        db.scalar(
            select(func.avg(AgentCallLog.latency_ms)).where(AgentCallLog.agent_id == agent_id)
        )
        or 50.0
    )
    ok = int(
        db.scalar(
            select(func.count())
            .select_from(AgentCallLog)
            .where(AgentCallLog.agent_id == agent_id, AgentCallLog.status == "succeeded")
        )
        or 0
    )
    return avg, ok / total


def route_agents(
    db: Session,
    *,
    input_text: str,
    preferred_agent_id: str = "",
    required_capabilities: list[str] | None = None,
    max_cost_micros: int | None = None,
    max_latency_ms: float | None = None,
    allow_external: bool = True,
) -> RouteResult:
    hub = get_agent_hub()
    level = classify_text(input_text)
    needed = _infer_needed_capabilities(input_text, required_capabilities)
    filtered_out: list[dict[str, Any]] = []
    candidates: list[RouteCandidate] = []
    routing_reasons = [
        f"数据等级={int(level)}",
        f"能力需求={needed or ['通用']}",
    ]

    # Load connection costs
    conn_map = {
        c.agent_id: c
        for c in db.scalars(select(AgentConnection))
    }

    for desc in hub.list_agents():
        agent_id = desc.agent_id
        dest = _destination_for(agent_id, desc.endpoint)
        conn = conn_map.get(agent_id)
        if conn is not None and conn.status == "disabled":
            filtered_out.append({"agent_id": agent_id, "reason": "connection_disabled"})
            continue

        # L3 cannot go external
        if level >= DataLevel.L3_CONFIDENTIAL and dest == DEST_EXTERNAL_AGENT:
            filtered_out.append({"agent_id": agent_id, "reason": "L3_blocks_external"})
            continue
        if not allow_external and dest == DEST_EXTERNAL_AGENT:
            filtered_out.append({"agent_id": agent_id, "reason": "external_disallowed"})
            continue

        caps = [c.lower() for c in desc.capabilities]
        if needed and not any(n in caps for n in needed):
            # keep as low-priority generic if no capability match and needed is set
            if preferred_agent_id != agent_id:
                filtered_out.append({"agent_id": agent_id, "reason": "capability_mismatch"})
                continue

        cost = int(conn.cost_per_call_micros) if conn is not None else (0 if dest == DEST_LOCAL else 500)
        if max_cost_micros is not None and cost > max_cost_micros:
            filtered_out.append({"agent_id": agent_id, "reason": f"cost>{max_cost_micros}"})
            continue

        avg_lat, success = _agent_stats(db, agent_id)
        if max_latency_ms is not None and avg_lat > max_latency_ms:
            filtered_out.append({"agent_id": agent_id, "reason": f"latency>{max_latency_ms}"})
            continue

        # Score: higher better
        score = 0.0
        reasons: list[str] = []
        if preferred_agent_id and preferred_agent_id == agent_id:
            score += 100
            reasons.append("用户指定优先")
        # capability match
        match_n = sum(1 for n in needed if n in caps) if needed else 0
        score += match_n * 20
        if match_n:
            reasons.append(f"能力匹配×{match_n}")
        # prefer local for high sensitivity
        if level >= DataLevel.L2_SENSITIVE and dest == DEST_LOCAL:
            score += 25
            reasons.append("敏感数据偏好本地")
        if dest == DEST_LOCAL:
            score += 5
            reasons.append("本地低成本")
        # cost (lower better): subtract micros/100
        score -= min(cost / 100.0, 30)
        reasons.append(f"成本={cost}µ")
        # latency
        score -= min(avg_lat / 20.0, 25)
        reasons.append(f"延迟≈{avg_lat:.0f}ms")
        # success rate
        if success is not None:
            score += success * 15
            reasons.append(f"成功率={success:.0%}")
        else:
            score += 5
            reasons.append("无历史，中性分")

        candidates.append(
            RouteCandidate(
                agent_id=agent_id,
                name=desc.name,
                score=round(score, 3),
                reasons=reasons,
                cost_per_call_micros=cost,
                avg_latency_ms=round(avg_lat, 1),
                success_rate=None if success is None else round(success, 4),
                capabilities=list(desc.capabilities),
                destination=dest,
            )
        )

    candidates.sort(key=lambda c: c.score, reverse=True)
    selected = candidates[0].agent_id if candidates else None
    if selected:
        routing_reasons.append(f"选中={selected} score={candidates[0].score}")
    else:
        routing_reasons.append("无可用 Agent")

    return RouteResult(
        selected_agent_id=selected,
        candidates=candidates,
        filtered_out=filtered_out,
        routing_reasons=routing_reasons,
        data_level=int(level),
        preferred_agent_id=preferred_agent_id or "",
    )


def route_result_to_dict(result: RouteResult) -> dict[str, Any]:
    return {
        "selected_agent_id": result.selected_agent_id,
        "data_level": result.data_level,
        "preferred_agent_id": result.preferred_agent_id,
        "routing_reasons": result.routing_reasons,
        "candidates": [
            {
                "agent_id": c.agent_id,
                "name": c.name,
                "score": c.score,
                "reasons": c.reasons,
                "cost_per_call_micros": c.cost_per_call_micros,
                "avg_latency_ms": c.avg_latency_ms,
                "success_rate": c.success_rate,
                "capabilities": c.capabilities,
                "destination": c.destination,
            }
            for c in result.candidates
        ],
        "filtered_out": result.filtered_out,
    }
