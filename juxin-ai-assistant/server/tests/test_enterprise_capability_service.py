from datetime import UTC, datetime, timedelta

import pytest

from app.enterprise_capability_models import (
    EnterpriseCapabilityEvaluation,
    EnterpriseCapabilityObservation,
    EnterpriseOptimizationProposal,
    EnterpriseOptimizationProposalEvent,
)
from app.enterprise_intelligence.access import EnterpriseAccessScope
from app.enterprise_intelligence.capability_service import (
    create_capability_evaluation,
    create_optimization_proposal,
    record_capability_observation,
    transition_optimization_proposal,
)
from app.enterprise_intelligence_models import EnterpriseOrganization
from app.schemas import AuthScope, SessionPayload, UserPayload


def _scope(user_id: str, role: str = "admin", department: str = "交付部") -> EnterpriseAccessScope:
    return EnterpriseAccessScope.from_session(
        SessionPayload(
            user=UserPayload(id=user_id, username=user_id, role=role),
            scope=AuthScope(department=department),
            apps=["ai-assistant"],
        )
    )


def _window() -> tuple[datetime, datetime, datetime]:
    end = datetime.now(UTC).replace(tzinfo=None).replace(microsecond=0)
    start = end - timedelta(days=7)
    return start, end, end + timedelta(minutes=1)


def _evaluation(
    db,
    organization_id: int,
    *,
    version: str = "1.0.0",
    sample_size: int = 2,
    scope: EnterpriseAccessScope | None = None,
    idempotency_key: str | None = None,
):
    start, end, cutoff = _window()
    return create_capability_evaluation(
        db,
        scope or _scope("admin-1"),
        organization_id,
        capability_type="skill",
        capability_key="delivery.review",
        capability_version=version,
        period_start=start,
        period_end=end,
        data_cutoff_at=cutoff,
        sample_size=sample_size,
        success_count=max(0, sample_size - 1),
        quality_pass_count=max(0, sample_size - 1),
        quality_sample_size=sample_size,
        human_modified_count=1 if sample_size else 0,
        total_cost_micros=1200,
        total_latency_ms=4800,
        evidence_refs=["run:1", "run:1"],
        idempotency_key=idempotency_key,
    )


def test_capability_evaluation_is_version_separated_and_low_sample_safe(generation_db) -> None:
    organization = EnterpriseOrganization(external_id="capability-org", name="能力组织")
    generation_db.add(organization)
    generation_db.flush()

    evaluation, replayed = _evaluation(generation_db, organization.id)
    assert replayed is False
    assert evaluation.confidence_label == "low_sample"
    same, replayed = _evaluation(generation_db, organization.id)
    assert same.id == evaluation.id
    assert replayed is True

    normal, replayed = _evaluation(generation_db, organization.id, version="1.1.0", sample_size=10)
    assert replayed is False
    assert normal.confidence_label == "normal"
    assert generation_db.query(EnterpriseCapabilityEvaluation).count() == 2

    start, end, cutoff = _window()
    _evaluation(generation_db, organization.id, version="1.4.0", sample_size=10, idempotency_key="evaluation-conflict")
    with pytest.raises(ValueError, match="不同的能力评估"):
        _evaluation(generation_db, organization.id, version="1.5.0", sample_size=10, idempotency_key="evaluation-conflict")

    with pytest.raises(ValueError, match="长度不能超过128"):
        _evaluation(generation_db, organization.id, idempotency_key="k" * 129)

    start, end, cutoff = _window()
    with pytest.raises(ValueError, match="质量样本数"):
        create_capability_evaluation(
            generation_db,
            _scope("admin-1"),
            organization.id,
            capability_type="skill",
            capability_key="delivery.review",
            capability_version="1.2.0",
            period_start=start,
            period_end=end,
            data_cutoff_at=cutoff,
            sample_size=2,
            success_count=1,
            quality_pass_count=2,
            quality_sample_size=3,
        )
    with pytest.raises(PermissionError):
        _evaluation(
            generation_db,
            organization.id,
            version="1.3.0",
            sample_size=10,
            scope=_scope("employee-1", "employee"),
        )


def test_optimization_proposal_is_human_gated_and_observation_is_replayable(generation_db) -> None:
    organization = EnterpriseOrganization(external_id="proposal-org", name="提案组织")
    generation_db.add(organization)
    generation_db.flush()
    evaluation, _ = _evaluation(generation_db, organization.id, version="2.0.0", sample_size=10)

    proposal, replayed = create_optimization_proposal(
        generation_db,
        _scope("admin-1"),
        organization.id,
        evaluation_uuid=evaluation.uuid,
        title="优化交付审查",
        rationale="降低人工修改率",
        proposed_change={"threshold": 0.85},
        risk_level="medium",
        idempotency_key="proposal-1",
    )
    assert replayed is False
    same, replayed = create_optimization_proposal(
        generation_db,
        _scope("admin-2"),
        organization.id,
        evaluation_uuid=evaluation.uuid,
        title="优化交付审查",
        rationale="降低人工修改率",
        proposed_change={"threshold": 0.85},
        risk_level="medium",
        idempotency_key="proposal-1",
    )
    assert same.id == proposal.id
    assert replayed is True
    with pytest.raises(ValueError, match="不同的优化提案"):
        create_optimization_proposal(
            generation_db,
            _scope("admin-1"),
            organization.id,
            evaluation_uuid=evaluation.uuid,
            title="另一个提案",
            rationale="冲突",
            proposed_change={"threshold": 0.9},
            risk_level="medium",
            idempotency_key="proposal-1",
        )

    for action, key, expected in (
        ("submit_review", "event-1", "review_pending"),
        ("approve", "event-2", "approved"),
        ("publish", "event-3", "published_as_new_version"),
    ):
        proposal, event, replayed = transition_optimization_proposal(
            generation_db,
            _scope("admin-1"),
            organization.id,
            proposal.uuid,
            action=action,
            idempotency_key=key,
        )
        assert replayed is False
        assert proposal.status == expected
        assert event.detail_json["catalog_mutation"] is False

    proposal_retry, event_retry, replayed = transition_optimization_proposal(
        generation_db,
        _scope("admin-2"),
        organization.id,
        proposal.uuid,
        action="publish",
        idempotency_key="event-3",
    )
    assert replayed is True
    assert proposal_retry.uuid == proposal.uuid
    assert event_retry.action == "publish"
    assert generation_db.query(EnterpriseOptimizationProposalEvent).count() == 3

    start, end, _ = _window()
    observation = record_capability_observation(
        generation_db,
        _scope("admin-1"),
        organization.id,
        proposal.uuid,
        observed_version="2.1.0",
        window_start=start,
        window_end=end,
        baseline_metrics={"success_rate": 0.8},
        candidate_metrics={"success_rate": 0.9},
        status="accepted",
        rollback_recommended=False,
        evidence_refs=["run:2"],
        idempotency_key="observation-1",
    )
    assert proposal.status == "observed"
    same_observation = record_capability_observation(
        generation_db,
        _scope("admin-2"),
        organization.id,
        proposal.uuid,
        observed_version="2.1.0",
        window_start=start,
        window_end=end,
        baseline_metrics={"success_rate": 0.8},
        candidate_metrics={"success_rate": 0.9},
        status="accepted",
        rollback_recommended=False,
        evidence_refs=["run:2"],
        idempotency_key="observation-1",
    )
    assert same_observation.id == observation.id
    assert generation_db.query(EnterpriseCapabilityObservation).count() == 1
    with pytest.raises(ValueError, match="不同的能力观测"):
        record_capability_observation(
            generation_db,
            _scope("admin-2"),
            organization.id,
            proposal.uuid,
            observed_version="2.1.0",
            window_start=start,
            window_end=end,
            baseline_metrics={"success_rate": 0.8},
            candidate_metrics={"success_rate": 0.7},
            status="accepted",
            rollback_recommended=False,
            evidence_refs=["run:2"],
            idempotency_key="observation-1",
        )
    proposal, _, _ = transition_optimization_proposal(
        generation_db,
        _scope("admin-1"),
        organization.id,
        proposal.uuid,
        action="rollback",
        idempotency_key="event-4",
    )
    assert proposal.status == "rolled_back"
