"""Versioned capability evaluation and human-gated optimization records."""

from __future__ import annotations

import uuid as uuid_lib
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .models import TimestampMixin, foreign_key_type, primary_key_type


class EnterpriseCapabilityEvaluation(TimestampMixin, Base):
    __tablename__ = "ai_enterprise_capability_evaluations"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "evaluation_fingerprint",
            name="uq_ai_enterprise_capability_evaluations_fingerprint",
        ),
        UniqueConstraint(
            "organization_id",
            "idempotency_key",
            name="uq_ai_enterprise_capability_evaluations_idempotency",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    organization_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="CASCADE"),
        index=True,
    )
    capability_type: Mapped[str] = mapped_column(String(32), index=True)
    capability_key: Mapped[str] = mapped_column(String(128), index=True)
    capability_version: Mapped[str] = mapped_column(String(64), index=True)
    period_start: Mapped[datetime] = mapped_column(DateTime)
    period_end: Mapped[datetime] = mapped_column(DateTime)
    data_cutoff_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    source_version: Mapped[str] = mapped_column(String(128), default="")
    definition_version: Mapped[str] = mapped_column(String(32), default="1.0.0")
    scope_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    policy_version: Mapped[str] = mapped_column(String(64), default="")
    evaluation_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), default="")
    request_hash: Mapped[str] = mapped_column(String(64), default="")
    sample_size: Mapped[int] = mapped_column(Integer, default=0)
    success_count: Mapped[int] = mapped_column(Integer, default=0)
    quality_pass_count: Mapped[int] = mapped_column(Integer, default=0)
    quality_sample_size: Mapped[int] = mapped_column(Integer, default=0)
    human_modified_count: Mapped[int] = mapped_column(Integer, default=0)
    total_cost_micros: Mapped[int] = mapped_column(Integer, default=0)
    total_latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    confidence_label: Mapped[str] = mapped_column(String(24), default="low_sample")
    status: Mapped[str] = mapped_column(String(24), default="ready", index=True)
    evidence_refs_json: Mapped[list] = mapped_column(JSON, default=list)
    created_by: Mapped[str] = mapped_column(String(64), default="system", index=True)
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class EnterpriseOptimizationProposal(TimestampMixin, Base):
    __tablename__ = "ai_enterprise_optimization_proposals"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "idempotency_key",
            name="uq_ai_enterprise_optimization_proposals_org_idempotency",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    organization_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="CASCADE"),
        index=True,
    )
    evaluation_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_enterprise_capability_evaluations.id", ondelete="RESTRICT"),
        index=True,
    )
    capability_type: Mapped[str] = mapped_column(String(32), index=True)
    capability_key: Mapped[str] = mapped_column(String(128), index=True)
    current_version: Mapped[str] = mapped_column(String(64), default="")
    title: Mapped[str] = mapped_column(String(255))
    rationale: Mapped[str] = mapped_column(Text, default="")
    proposed_change_json: Mapped[dict] = mapped_column(JSON, default=dict)
    risk_level: Mapped[str] = mapped_column(String(16), default="medium", index=True)
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    scope_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    policy_version: Mapped[str] = mapped_column(String(64), default="")
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64), default="")
    proposed_by: Mapped[str] = mapped_column(String(64), default="system", index=True)
    reviewed_by: Mapped[str] = mapped_column(String(64), default="", index=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    rolled_back_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class EnterpriseOptimizationProposalEvent(TimestampMixin, Base):
    __tablename__ = "ai_enterprise_optimization_proposal_events"
    __table_args__ = (
        UniqueConstraint(
            "proposal_id",
            "idempotency_key",
            name="uq_ai_enterprise_optimization_proposal_events_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    proposal_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_enterprise_optimization_proposals.id", ondelete="CASCADE"),
        index=True,
    )
    action: Mapped[str] = mapped_column(String(32), index=True)
    from_status: Mapped[str] = mapped_column(String(32), default="")
    to_status: Mapped[str] = mapped_column(String(32), default="")
    actor_user_id: Mapped[str] = mapped_column(String(64), index=True)
    comment: Mapped[str] = mapped_column(Text, default="")
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64), default="")
    detail_json: Mapped[dict] = mapped_column(JSON, default=dict)


class EnterpriseCapabilityObservation(TimestampMixin, Base):
    __tablename__ = "ai_enterprise_capability_observations"
    __table_args__ = (
        UniqueConstraint(
            "proposal_id",
            "observed_version",
            "window_start",
            "window_end",
            name="uq_ai_enterprise_capability_observations_window",
        ),
        UniqueConstraint(
            "proposal_id",
            "idempotency_key",
            name="uq_ai_enterprise_capability_observations_idempotency",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    proposal_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_enterprise_optimization_proposals.id", ondelete="CASCADE"),
        index=True,
    )
    observed_version: Mapped[str] = mapped_column(String(64), index=True)
    window_start: Mapped[datetime] = mapped_column(DateTime)
    window_end: Mapped[datetime] = mapped_column(DateTime)
    baseline_metrics_json: Mapped[dict] = mapped_column(JSON, default=dict)
    candidate_metrics_json: Mapped[dict] = mapped_column(JSON, default=dict)
    idempotency_key: Mapped[str] = mapped_column(String(128), default="")
    request_hash: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    rollback_recommended: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    evidence_refs_json: Mapped[list] = mapped_column(JSON, default=list)
    created_by: Mapped[str] = mapped_column(String(64), default="system", index=True)
