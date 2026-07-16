"""Durable SLO/invariant audit for the Agent Loop operations surface.

The audit intentionally reports only facts that can be derived from the
existing durable ledgers.  Recovery-rate checks that need rehearsal telemetry
are reported as ``not_observed`` instead of being silently treated as zero.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .models import (
    AgentRun,
    AgentRunStep,
    AgentToolInvocation,
    ChannelMessageBinding,
    DirectActionInvocation,
)

TERMINAL_RUN_STATUSES = {"succeeded", "completed", "failed", "cancelled"}
SIDE_EFFECT_EFFECTS = {"write", "idempotent_write", "non_idempotent_write"}


def _check(
    check_id: str,
    name: str,
    status: str,
    actual: int | float | str | None,
    threshold: int | float | str,
    detail: str = "",
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "id": check_id,
        "name": name,
        "status": status,
        "actual": actual,
        "threshold": threshold,
    }
    if detail:
        result["detail"] = detail
    return result


def _as_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def build_slo_audit(
    db: Session,
    *,
    run_reconciliation: Any | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Compute fail-closed operational invariants from durable records.

    ``run_reconciliation`` may be the reconciliation response object or its
    JSON-compatible mapping.  Passing it avoids running the bounded scan a
    second time in the ops snapshot endpoint.
    """

    checks: list[dict[str, Any]] = []
    metrics: dict[str, int | float | str | None] = {}
    notes: list[str] = []
    hard_failures = 0
    gaps = 0
    current_time = now or datetime.now(UTC).replace(tzinfo=None)

    def add(check: dict[str, Any]) -> None:
        nonlocal hard_failures, gaps
        checks.append(check)
        if check["status"] == "fail":
            hard_failures += 1
        elif check["status"] == "not_observed":
            gaps += 1

    # Run/Step/Event consistency is computed by ops_routes and passed in.
    if run_reconciliation is None:
        add(_check(
            "run_step_event_consistency",
            "Run/Step/Event 对账",
            "not_observed",
            None,
            0,
            "需要先运行 bounded reconciliation scan",
        ))
    else:
        overall = getattr(run_reconciliation, "overall", None)
        issue_count = getattr(run_reconciliation, "issue_count", None)
        if isinstance(run_reconciliation, dict):
            overall = run_reconciliation.get("overall")
            issue_count = run_reconciliation.get("issue_count")
        issue_count = _as_int(issue_count)
        metrics["run_reconciliation_issue_count"] = issue_count
        add(_check(
            "run_step_event_consistency",
            "Run/Step/Event 对账问题数",
            "pass" if overall == "pass" and issue_count == 0 else "fail",
            issue_count,
            0,
            f"overall={overall or 'missing'}",
        ))

    # A terminal run must never retain a lease.  Release clears both fields,
    # so checking either field catches stale ownership and stale expiry data.
    try:
        terminal_active_leases = _as_int(db.scalar(
            select(func.count())
            .select_from(AgentRun)
            .where(
                AgentRun.status.in_(TERMINAL_RUN_STATUSES),
                or_(AgentRun.lease_owner != "", AgentRun.lease_expires_at.is_not(None)),
            )
        ))
        metrics["terminal_runs_with_lease"] = terminal_active_leases
        add(_check(
            "terminal_run_lease",
            "终态运行无活动租约",
            "pass" if terminal_active_leases == 0 else "fail",
            terminal_active_leases,
            0,
        ))
    except Exception as exc:
        notes.append("terminal_run_lease_unavailable")
        add(_check("terminal_run_lease", "终态运行无活动租约", "not_observed", None, 0, str(exc)[:160]))

    # Budget counters are durable facts.  A zero limit means unlimited for
    # backwards compatibility, therefore it is excluded from overrun checks.
    try:
        run_rows = list(db.execute(select(
            AgentRun.uuid,
            AgentRun.max_steps,
            AgentRun.max_model_calls,
            AgentRun.max_cost_micros,
            AgentRun.model_calls,
            AgentRun.cost_micros,
        )))
        step_counts = {
            str(row.run_id): _as_int(row.step_count)
            for row in db.execute(
                select(AgentRunStep.run_id, func.count().label("step_count"))
                .group_by(AgentRunStep.run_id)
            )
        }
        budget_overruns: set[str] = set()
        for row in run_rows:
            run_id = str(row.uuid)
            if _as_int(row.max_steps) > 0 and step_counts.get(run_id, 0) > _as_int(row.max_steps):
                budget_overruns.add(run_id)
            if _as_int(row.max_model_calls) > 0 and _as_int(row.model_calls) > _as_int(row.max_model_calls):
                budget_overruns.add(run_id)
            if _as_int(row.max_cost_micros) > 0 and _as_int(row.cost_micros) > _as_int(row.max_cost_micros):
                budget_overruns.add(run_id)
        metrics["run_budget_overruns"] = len(budget_overruns)
        add(_check(
            "budget_overrun",
            "运行预算无超限",
            "pass" if not budget_overruns else "fail",
            len(budget_overruns),
            0,
        ))
    except Exception as exc:
        notes.append("run_budget_unavailable")
        add(_check("budget_overrun", "运行预算无超限", "not_observed", None, 0, str(exc)[:160]))

    # The uniqueness constraint protects this invariant at write time; the
    # grouped query detects legacy/corrupt data and proves the ledger remains
    # safe to replay.
    try:
        duplicate_groups = list(db.execute(
            select(
                AgentToolInvocation.run_id,
                AgentToolInvocation.tool_name,
                AgentToolInvocation.idempotency_key,
                func.count().label("row_count"),
            )
            .group_by(
                AgentToolInvocation.run_id,
                AgentToolInvocation.tool_name,
                AgentToolInvocation.idempotency_key,
            )
            .having(func.count() > 1)
        ))
        duplicate_extras = sum(max(0, _as_int(row.row_count) - 1) for row in duplicate_groups)
        metrics["duplicate_tool_identity_groups"] = len(duplicate_groups)
        metrics["duplicate_tool_identity_extras"] = duplicate_extras
        add(_check(
            "duplicate_tool_identity",
            "工具幂等身份无重复",
            "pass" if not duplicate_groups else "fail",
            duplicate_extras,
            0,
        ))
    except Exception as exc:
        notes.append("tool_duplicate_audit_unavailable")
        add(_check("duplicate_tool_identity", "工具幂等身份无重复", "not_observed", None, 0, str(exc)[:160]))

    # Every side-effect ledger row must retain the replay key and request hash.
    try:
        tool_reconciliation_required = _as_int(db.scalar(
            select(func.count())
            .select_from(AgentToolInvocation)
            .where(AgentToolInvocation.status == "reconciliation_required")
        ))
        direct_reconciliation_required = _as_int(db.scalar(
            select(func.count())
            .select_from(DirectActionInvocation)
            .where(DirectActionInvocation.status == "reconciliation_required")
        ))
        channel_outbound_reconciliation_required = sum(
            1
            for metadata in db.scalars(
                select(ChannelMessageBinding.metadata_json).where(
                    ChannelMessageBinding.direction == "outbound"
                )
            )
            if isinstance(metadata, dict) and metadata.get("state") == "reconciliation_required"
        )
        metrics["tool_reconciliation_required"] = tool_reconciliation_required
        metrics["direct_action_reconciliation_required"] = direct_reconciliation_required
        metrics["channel_outbound_reconciliation_required"] = channel_outbound_reconciliation_required
        reconciliation_backlog = (
            tool_reconciliation_required
            + direct_reconciliation_required
            + channel_outbound_reconciliation_required
        )
        add(_check(
            "reconciliation_backlog",
            "未知副作用结果待对账数为 0",
            "pass" if reconciliation_backlog == 0 else "fail",
            reconciliation_backlog,
            0,
        ))
        tool_audit_gaps = _as_int(db.scalar(
            select(func.count())
            .select_from(AgentToolInvocation)
            .where(
                AgentToolInvocation.effect.in_(SIDE_EFFECT_EFFECTS),
                or_(AgentToolInvocation.idempotency_key == "", AgentToolInvocation.request_hash == ""),
            )
        ))
        direct_audit_gaps = _as_int(db.scalar(
            select(func.count())
            .select_from(DirectActionInvocation)
            .where(
                or_(DirectActionInvocation.idempotency_key == "", DirectActionInvocation.request_hash == ""),
            )
        ))
        metrics["tool_audit_gaps"] = tool_audit_gaps
        metrics["direct_action_audit_gaps"] = direct_audit_gaps
        total_gaps = tool_audit_gaps + direct_audit_gaps
        add(_check(
            "side_effect_audit_coverage",
            "副作用账本具备幂等键与请求哈希",
            "pass" if total_gaps == 0 else "fail",
            total_gaps,
            0,
        ))
    except Exception as exc:
        notes.append("side_effect_audit_unavailable")
        add(_check("side_effect_audit_coverage", "副作用账本具备幂等键与请求哈希", "not_observed", None, 0, str(exc)[:160]))

    # These two rates need controlled crash/recovery samples, not just current
    # row counts.  Keep the gap explicit so operators cannot mistake a local
    # snapshot for the final staging evidence.
    metrics["checkpoint_recovery_rate"] = None
    metrics["approval_recovery_rate"] = None
    add(_check(
        "checkpoint_recovery_rate",
        "检查点恢复率（需演练样本）",
        "not_observed",
        None,
        ">=0.999",
        "需要 staging/混沌演练结果文件",
    ))
    add(_check(
        "approval_recovery_rate",
        "审批恢复率（需演练样本）",
        "not_observed",
        None,
        ">=0.999",
        "需要 staging/混沌演练结果文件",
    ))

    # ``current_time`` is accepted so callers can use one clock for future
    # heartbeat-age checks; include it in the report for traceability.
    metrics["evaluated_at"] = current_time.isoformat()
    if hard_failures:
        overall = "fail"
    elif gaps:
        overall = "pass_with_gaps"
    else:
        overall = "pass"
    return {
        "overall": overall,
        "checks": checks,
        "metrics": metrics,
        "fail_count": hard_failures,
        "gap_count": gaps,
        "notes": notes,
    }
