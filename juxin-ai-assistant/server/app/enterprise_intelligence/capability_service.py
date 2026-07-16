"""Human-gated capability evaluation and optimization proposal workflow."""

from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..enterprise_capability_models import (
    EnterpriseCapabilityEvaluation,
    EnterpriseCapabilityObservation,
    EnterpriseOptimizationProposal,
    EnterpriseOptimizationProposalEvent,
)
from ..enterprise_intelligence_models import EnterpriseOrganization
from .access import EnterpriseAccessScope


CAPABILITY_TYPES = frozenset({"skill", "workflow", "template", "model"})
CAPABILITY_RISK_LEVELS = frozenset({"low", "medium", "high"})
PROPOSAL_STATUSES = frozenset({"draft", "review_pending", "approved", "published_as_new_version", "observed", "rolled_back", "rejected"})
OBSERVATION_STATUSES = frozenset({"pending", "accepted", "rollback_recommended"})
EVALUATION_DEFINITION_VERSION = "1.0.0"
MIN_NORMAL_SAMPLE_SIZE = 10


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=None) if value.tzinfo is not None else value


def _hash(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _normalize_idempotency_key(value: str | None, *, fallback: str | None, label: str) -> str:
    key = (value or fallback or "").strip()
    if not key:
        raise ValueError(f"{label}必须提供幂等键")
    if len(key) > 128:
        raise ValueError(f"{label}幂等键长度不能超过128个字符")
    return key


def _require_capability(scope: EnterpriseAccessScope, capability: str) -> None:
    if not scope.can(capability):
        raise PermissionError("当前身份无能力评估中心权限")


def _require_organization(db: Session, organization_id: int) -> EnterpriseOrganization:
    organization = db.scalar(
        select(EnterpriseOrganization).where(
            EnterpriseOrganization.id == organization_id,
            EnterpriseOrganization.status == "active",
        )
    )
    if organization is None:
        raise LookupError("组织不存在或已停用")
    return organization


def _validate_counts(
    sample_size: int,
    success_count: int,
    quality_pass_count: int,
    quality_sample_size: int,
    human_modified_count: int,
    total_cost_micros: int,
    total_latency_ms: int,
) -> None:
    values = {
        "样本数": sample_size,
        "成功数": success_count,
        "质量通过数": quality_pass_count,
        "质量样本数": quality_sample_size,
        "人工修改数": human_modified_count,
        "总成本": total_cost_micros,
        "总耗时": total_latency_ms,
    }
    if any(value < 0 for value in values.values()):
        raise ValueError("能力评估计数不能为负数")
    if success_count > sample_size or human_modified_count > sample_size:
        raise ValueError("成功数或人工修改数不能超过样本数")
    if quality_pass_count > quality_sample_size or quality_sample_size > sample_size:
        raise ValueError("质量样本数或质量通过数不合法")


def create_capability_evaluation(
    db: Session,
    scope: EnterpriseAccessScope,
    organization_id: int,
    *,
    capability_type: str,
    capability_key: str,
    capability_version: str,
    period_start: datetime,
    period_end: datetime,
    data_cutoff_at: datetime,
    sample_size: int,
    success_count: int,
    quality_pass_count: int = 0,
    quality_sample_size: int = 0,
    human_modified_count: int = 0,
    total_cost_micros: int = 0,
    total_latency_ms: int = 0,
    evidence_refs: list[str] | None = None,
    source_version: str = "runtime-ledger-v1",
    definition_version: str = EVALUATION_DEFINITION_VERSION,
    idempotency_key: str | None = None,
) -> tuple[EnterpriseCapabilityEvaluation, bool]:
    """Persist a fixed-window evaluation; replay returns the same snapshot."""

    _require_capability(scope, "intelligence:capability:propose")
    _require_organization(db, organization_id)
    capability_type = capability_type.strip().lower()
    capability_key = capability_key.strip()
    capability_version = capability_version.strip()
    source_version = source_version.strip()
    definition_version = definition_version.strip()
    if capability_type not in CAPABILITY_TYPES:
        raise ValueError("能力类型不在允许范围")
    if not capability_key or not capability_version:
        raise ValueError("能力标识和版本不能为空")
    if not source_version or not definition_version:
        raise ValueError("source_version 和 definition_version 不能为空")
    period_start = _utc(period_start)
    period_end = _utc(period_end)
    data_cutoff_at = _utc(data_cutoff_at)
    if period_end <= period_start:
        raise ValueError("评估时间窗口必须为正")
    if data_cutoff_at < period_end:
        raise ValueError("数据截止时间不能早于评估窗口结束时间")
    _validate_counts(
        sample_size,
        success_count,
        quality_pass_count,
        quality_sample_size,
        human_modified_count,
        total_cost_micros,
        total_latency_ms,
    )
    evidence_refs = list(dict.fromkeys(str(item).strip() for item in (evidence_refs or []) if str(item).strip()))
    fingerprint = _hash(
        {
            "capability_type": capability_type,
            "capability_key": capability_key,
            "capability_version": capability_version,
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "data_cutoff_at": data_cutoff_at.isoformat(),
            "source_version": source_version,
            "definition_version": definition_version,
            "scope_fingerprint": scope.scope_fingerprint,
            "policy_version": scope.policy_version,
            "metrics": {
                "sample_size": sample_size,
                "success_count": success_count,
                "quality_pass_count": quality_pass_count,
                "quality_sample_size": quality_sample_size,
                "human_modified_count": human_modified_count,
                "total_cost_micros": total_cost_micros,
                "total_latency_ms": total_latency_ms,
            },
            "evidence_refs": evidence_refs,
        }
    )
    idempotency_key = _normalize_idempotency_key(
        idempotency_key,
        fallback=f"evaluation:{fingerprint}",
        label="能力评估",
    )
    request_hash = _hash(
        {
            "evaluation_fingerprint": fingerprint,
            "scope_fingerprint": scope.scope_fingerprint,
            "policy_version": scope.policy_version,
        }
    )
    keyed = db.scalar(
        select(EnterpriseCapabilityEvaluation).where(
            EnterpriseCapabilityEvaluation.organization_id == organization_id,
            EnterpriseCapabilityEvaluation.idempotency_key == idempotency_key,
        )
    )
    if keyed is not None:
        if keyed.request_hash and keyed.request_hash != request_hash:
            raise ValueError("相同幂等键对应了不同的能力评估")
        return keyed, True
    existing = db.scalar(
        select(EnterpriseCapabilityEvaluation).where(
            EnterpriseCapabilityEvaluation.organization_id == organization_id,
            EnterpriseCapabilityEvaluation.evaluation_fingerprint == fingerprint,
        )
    )
    if existing is not None:
        return existing, True
    row = EnterpriseCapabilityEvaluation(
        organization_id=organization_id,
        capability_type=capability_type,
        capability_key=capability_key,
        capability_version=capability_version,
        period_start=period_start,
        period_end=period_end,
        data_cutoff_at=data_cutoff_at,
        source_version=source_version,
        definition_version=definition_version,
        scope_fingerprint=scope.scope_fingerprint,
        policy_version=scope.policy_version,
        evaluation_fingerprint=fingerprint,
        idempotency_key=idempotency_key[:128],
        request_hash=request_hash,
        sample_size=sample_size,
        success_count=success_count,
        quality_pass_count=quality_pass_count,
        quality_sample_size=quality_sample_size,
        human_modified_count=human_modified_count,
        total_cost_micros=total_cost_micros,
        total_latency_ms=total_latency_ms,
        confidence_label="normal" if sample_size >= MIN_NORMAL_SAMPLE_SIZE else "low_sample",
        evidence_refs_json=evidence_refs,
        created_by=scope.user_id,
    )
    db.add(row)
    db.flush()
    return row, False


def list_capability_evaluations(
    db: Session,
    scope: EnterpriseAccessScope,
    organization_id: int,
    *,
    capability_type: str | None = None,
    capability_key: str | None = None,
    limit: int = 100,
) -> list[EnterpriseCapabilityEvaluation]:
    _require_capability(scope, "intelligence:capability:read")
    _require_organization(db, organization_id)
    statement = select(EnterpriseCapabilityEvaluation).where(
        EnterpriseCapabilityEvaluation.organization_id == organization_id
    )
    if capability_type:
        if capability_type not in CAPABILITY_TYPES:
            raise ValueError("能力类型不在允许范围")
        statement = statement.where(EnterpriseCapabilityEvaluation.capability_type == capability_type)
    if capability_key:
        statement = statement.where(EnterpriseCapabilityEvaluation.capability_key == capability_key.strip())
    return list(
        db.scalars(
            statement.order_by(
                EnterpriseCapabilityEvaluation.data_cutoff_at.desc(),
                EnterpriseCapabilityEvaluation.id.desc(),
            ).limit(max(1, min(int(limit), 200)))
        ).all()
    )


def create_optimization_proposal(
    db: Session,
    scope: EnterpriseAccessScope,
    organization_id: int,
    *,
    evaluation_uuid: str,
    title: str,
    rationale: str,
    proposed_change: dict[str, Any],
    risk_level: str,
    idempotency_key: str,
) -> tuple[EnterpriseOptimizationProposal, bool]:
    _require_capability(scope, "intelligence:capability:propose")
    _require_organization(db, organization_id)
    if risk_level not in CAPABILITY_RISK_LEVELS:
        raise ValueError("优化提案风险等级不合法")
    title = title.strip()
    idempotency_key = _normalize_idempotency_key(idempotency_key, fallback=None, label="优化提案")
    if not title:
        raise ValueError("优化提案标题不能为空")
    evaluation = db.scalar(
        select(EnterpriseCapabilityEvaluation).where(
            EnterpriseCapabilityEvaluation.organization_id == organization_id,
            EnterpriseCapabilityEvaluation.uuid == evaluation_uuid,
        )
    )
    if evaluation is None:
        raise LookupError("能力评估不存在或不可访问")
    request_hash = _hash(
        {
            "evaluation_uuid": evaluation_uuid,
            "title": title,
            "rationale": rationale,
            "proposed_change": proposed_change,
            "risk_level": risk_level,
        }
    )
    existing = db.scalar(
        select(EnterpriseOptimizationProposal).where(
            EnterpriseOptimizationProposal.organization_id == organization_id,
            EnterpriseOptimizationProposal.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        if existing.request_hash != request_hash:
            raise ValueError("相同幂等键对应了不同的优化提案")
        return existing, True
    row = EnterpriseOptimizationProposal(
        organization_id=organization_id,
        evaluation_id=evaluation.id,
        capability_type=evaluation.capability_type,
        capability_key=evaluation.capability_key,
        current_version=evaluation.capability_version,
        title=title,
        rationale=rationale.strip(),
        proposed_change_json=proposed_change,
        risk_level=risk_level,
        scope_fingerprint=evaluation.scope_fingerprint,
        policy_version=evaluation.policy_version,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        proposed_by=scope.user_id,
    )
    db.add(row)
    db.flush()
    return row, False


def list_optimization_proposals(
    db: Session,
    scope: EnterpriseAccessScope,
    organization_id: int,
    *,
    status: str | None = None,
    limit: int = 100,
) -> list[EnterpriseOptimizationProposal]:
    _require_capability(scope, "intelligence:capability:read")
    _require_organization(db, organization_id)
    if status is not None and status not in PROPOSAL_STATUSES:
        raise ValueError("优化提案状态不合法")
    statement = select(EnterpriseOptimizationProposal).where(
        EnterpriseOptimizationProposal.organization_id == organization_id
    )
    if status:
        statement = statement.where(EnterpriseOptimizationProposal.status == status)
    return list(
        db.scalars(
            statement.order_by(
                EnterpriseOptimizationProposal.created_at.desc(),
                EnterpriseOptimizationProposal.id.desc(),
            ).limit(max(1, min(int(limit), 200)))
        ).all()
    )


def transition_optimization_proposal(
    db: Session,
    scope: EnterpriseAccessScope,
    organization_id: int,
    proposal_uuid: str,
    *,
    action: str,
    idempotency_key: str,
    comment: str = "",
) -> tuple[EnterpriseOptimizationProposal, EnterpriseOptimizationProposalEvent, bool]:
    _require_capability(scope, "intelligence:capability:review")
    _require_organization(db, organization_id)
    allowed = {
        "submit_review": {"draft": "review_pending"},
        "approve": {"review_pending": "approved"},
        "reject": {"draft": "rejected", "review_pending": "rejected"},
        "publish": {"approved": "published_as_new_version"},
        "rollback": {"published_as_new_version": "rolled_back", "observed": "rolled_back"},
    }
    if action not in allowed:
        raise ValueError("不支持的优化提案操作")
    proposal = db.scalar(
        select(EnterpriseOptimizationProposal).where(
            EnterpriseOptimizationProposal.organization_id == organization_id,
            EnterpriseOptimizationProposal.uuid == proposal_uuid,
        )
    )
    if proposal is None:
        raise LookupError("优化提案不存在或不可访问")
    idempotency_key = _normalize_idempotency_key(idempotency_key, fallback=None, label="优化提案操作")
    request_hash = _hash({"action": action, "comment": comment})
    existing = db.scalar(
        select(EnterpriseOptimizationProposalEvent).where(
            EnterpriseOptimizationProposalEvent.proposal_id == proposal.id,
            EnterpriseOptimizationProposalEvent.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        if existing.request_hash != request_hash:
            raise ValueError("相同幂等键对应了不同的提案操作")
        return proposal, existing, True
    target_status = allowed[action].get(proposal.status)
    if target_status is None:
        raise ValueError("优化提案当前状态不允许此操作")
    now = datetime.now(UTC).replace(tzinfo=None)
    previous_status = proposal.status
    proposal.status = target_status
    proposal.row_version = int(proposal.row_version or 1) + 1
    if action in {"approve", "reject"}:
        proposal.reviewed_by = scope.user_id
        proposal.reviewed_at = now
    elif action == "publish":
        proposal.published_at = now
    elif action == "rollback":
        proposal.rolled_back_at = now
    event = EnterpriseOptimizationProposalEvent(
        proposal_id=proposal.id,
        action=action,
        from_status=previous_status,
        to_status=target_status,
        actor_user_id=scope.user_id,
        comment=comment.strip()[:2000],
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        detail_json={"catalog_mutation": False, "policy_version": scope.policy_version},
    )
    db.add(event)
    db.flush()
    return proposal, event, False


def record_capability_observation(
    db: Session,
    scope: EnterpriseAccessScope,
    organization_id: int,
    proposal_uuid: str,
    *,
    observed_version: str,
    window_start: datetime,
    window_end: datetime,
    baseline_metrics: dict[str, Any],
    candidate_metrics: dict[str, Any],
    status: str,
    rollback_recommended: bool,
    evidence_refs: list[str] | None = None,
    idempotency_key: str | None = None,
) -> EnterpriseCapabilityObservation:
    _require_capability(scope, "intelligence:capability:review")
    _require_organization(db, organization_id)
    if status not in OBSERVATION_STATUSES:
        raise ValueError("观测状态不合法")
    proposal = db.scalar(
        select(EnterpriseOptimizationProposal).where(
            EnterpriseOptimizationProposal.organization_id == organization_id,
            EnterpriseOptimizationProposal.uuid == proposal_uuid,
        )
    )
    if proposal is None:
        raise LookupError("优化提案不存在或不可访问")
    if proposal.status not in {"published_as_new_version", "observed", "rolled_back"}:
        raise ValueError("只有已发布候选版本才能记录观测")
    observed_version = observed_version.strip()
    if not observed_version:
        raise ValueError("观测版本不能为空")
    window_start = _utc(window_start)
    window_end = _utc(window_end)
    if window_end <= window_start:
        raise ValueError("观测时间窗口必须为正")
    evidence_refs = list(dict.fromkeys(str(item).strip() for item in (evidence_refs or []) if str(item).strip()))
    idempotency_key = _normalize_idempotency_key(
        idempotency_key,
        fallback=f"observation:{observed_version}:{window_start.isoformat()}:{window_end.isoformat()}",
        label="能力观测",
    )
    request_hash = _hash(
        {
            "observed_version": observed_version,
            "window_start": window_start.isoformat(),
            "window_end": window_end.isoformat(),
            "baseline_metrics": baseline_metrics,
            "candidate_metrics": candidate_metrics,
            "status": status,
            "rollback_recommended": bool(rollback_recommended),
            "evidence_refs": evidence_refs,
        }
    )
    keyed = db.scalar(
        select(EnterpriseCapabilityObservation).where(
            EnterpriseCapabilityObservation.proposal_id == proposal.id,
            EnterpriseCapabilityObservation.idempotency_key == idempotency_key,
        )
    )
    if keyed is not None:
        if keyed.request_hash and keyed.request_hash != request_hash:
            raise ValueError("相同幂等键对应了不同的能力观测")
        return keyed
    existing = db.scalar(
        select(EnterpriseCapabilityObservation).where(
            EnterpriseCapabilityObservation.proposal_id == proposal.id,
            EnterpriseCapabilityObservation.observed_version == observed_version,
            EnterpriseCapabilityObservation.window_start == window_start,
            EnterpriseCapabilityObservation.window_end == window_end,
        )
    )
    if existing is not None:
        return existing
    row = EnterpriseCapabilityObservation(
        proposal_id=proposal.id,
        observed_version=observed_version.strip(),
        window_start=window_start,
        window_end=window_end,
        baseline_metrics_json=baseline_metrics,
        candidate_metrics_json=candidate_metrics,
        idempotency_key=idempotency_key[:128],
        request_hash=request_hash,
        status=status,
        rollback_recommended=bool(rollback_recommended),
        evidence_refs_json=evidence_refs,
        created_by=scope.user_id,
    )
    db.add(row)
    if proposal.status == "published_as_new_version":
        proposal.status = "observed"
        proposal.row_version = int(proposal.row_version or 1) + 1
    db.flush()
    return row
