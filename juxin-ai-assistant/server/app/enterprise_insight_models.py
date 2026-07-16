"""Versioned, evidence-bound enterprise insights and safe recommendations."""

import uuid as uuid_lib
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .enterprise_intelligence_models import EnterpriseTimestampMixin, foreign_key_type, primary_key_type


class EnterpriseInsightRule(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_enterprise_insight_rules"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "rule_key",
            name="uq_ai_enterprise_insight_rules_org_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    organization_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="CASCADE"),
        index=True,
    )
    rule_key: Mapped[str] = mapped_column(String(96), index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    owner: Mapped[str] = mapped_column(String(64), default="enterprise-intelligence")
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    latest_version: Mapped[str] = mapped_column(String(32), default="1.0.0")
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class EnterpriseInsightRuleVersion(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_enterprise_insight_rule_versions"
    __table_args__ = (
        UniqueConstraint(
            "rule_id",
            "version",
            name="uq_ai_enterprise_insight_rule_versions_rule_version",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    rule_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_enterprise_insight_rules.id", ondelete="CASCADE"),
        index=True,
    )
    version: Mapped[str] = mapped_column(String(32))
    rule_type: Mapped[str] = mapped_column(String(64), index=True)
    config_json: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(24), default="published", index=True)
    effective_from: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str] = mapped_column(String(64), default="system")


class EnterpriseInsight(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_enterprise_insights"
    __table_args__ = (
        UniqueConstraint(
            "rule_version_id",
            "scope_fingerprint",
            "evidence_fingerprint",
            name="uq_ai_enterprise_insights_rule_scope_evidence",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    organization_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="CASCADE"),
        index=True,
    )
    project_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    rule_version_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_enterprise_insight_rule_versions.id", ondelete="RESTRICT"),
        index=True,
    )
    insight_type: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(255))
    summary: Mapped[str] = mapped_column(Text, default="")
    scope_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    policy_version: Mapped[str] = mapped_column(String(64), default="")
    data_cutoff_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    data_version: Mapped[str] = mapped_column(String(128), default="")
    confidence: Mapped[float] = mapped_column(default=0.0)
    severity: Mapped[str] = mapped_column(String(24), default="medium", index=True)
    impact_scope_json: Mapped[dict] = mapped_column(JSON, default=dict)
    evidence_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(32), default="open", index=True)
    assigned_to: Mapped[str] = mapped_column(String(64), default="")
    feedback: Mapped[str] = mapped_column(Text, default="")
    acknowledged_by: Mapped[str] = mapped_column(String(64), default="")
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class EnterpriseInsightEvidence(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_enterprise_insight_evidence"
    __table_args__ = (
        UniqueConstraint(
            "insight_id",
            "evidence_type",
            "evidence_uuid",
            "source_version",
            name="uq_ai_enterprise_insight_evidence_natural_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    insight_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_enterprise_insights.id", ondelete="CASCADE"),
        index=True,
    )
    evidence_type: Mapped[str] = mapped_column(String(64), index=True)
    evidence_uuid: Mapped[str] = mapped_column(String(64), index=True)
    source_table: Mapped[str] = mapped_column(String(128), default="")
    source_version: Mapped[int] = mapped_column(Integer, default=1)
    detail_json: Mapped[dict] = mapped_column(JSON, default=dict)


class EnterpriseRecommendation(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_enterprise_recommendations"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "idempotency_key",
            name="uq_ai_enterprise_recommendations_org_idempotency",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    organization_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="CASCADE"),
        index=True,
    )
    insight_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_enterprise_insights.id", ondelete="CASCADE"),
        index=True,
    )
    recommendation_type: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(255))
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict)
    risk_level: Mapped[str] = mapped_column(String(16), default="low", index=True)
    status: Mapped[str] = mapped_column(String(32), default="proposed", index=True)
    scope_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    policy_version: Mapped[str] = mapped_column(String(64), default="")
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64), default="")
    proposed_by: Mapped[str] = mapped_column(String(64), default="system")
    approved_by: Mapped[str] = mapped_column(String(64), default="")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    workflow_run_id: Mapped[str] = mapped_column(String(36), default="")
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class EnterpriseRecommendationAction(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_enterprise_recommendation_actions"
    __table_args__ = (
        UniqueConstraint(
            "recommendation_id",
            "idempotency_key",
            name="uq_ai_enterprise_recommendation_actions_idempotency",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    recommendation_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_enterprise_recommendations.id", ondelete="CASCADE"),
        index=True,
    )
    action_type: Mapped[str] = mapped_column(String(64), index=True)
    risk_level: Mapped[str] = mapped_column(String(16), default="low", index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending_approval", index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64), default="")
    requires_approval: Mapped[bool] = mapped_column(default=True)
    approval_token_hash: Mapped[str] = mapped_column(String(64), default="")
    executed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    result_json: Mapped[dict] = mapped_column(JSON, default=dict)
    reconciliation_status: Mapped[str] = mapped_column(String(32), default="not_required", index=True)
    row_version: Mapped[int] = mapped_column(Integer, default=1)
