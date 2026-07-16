"""Versioned metric, health and data-quality records for enterprise intelligence.

The live overview remains useful for the current screen, while these tables
provide an append-only audit boundary for values that must be compared or
replayed later.  Snapshot rows are never updated by the persistence service.
"""

import uuid as uuid_lib
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .enterprise_intelligence_models import EnterpriseTimestampMixin, foreign_key_type, primary_key_type


class EnterpriseMetricDefinition(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_enterprise_metric_definitions"
    __table_args__ = (
        UniqueConstraint(
            "metric_code",
            "definition_version",
            name="uq_ai_enterprise_metric_definitions_code_version",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    metric_code: Mapped[str] = mapped_column(String(96), index=True)
    definition_version: Mapped[str] = mapped_column(String(32))
    owner: Mapped[str] = mapped_column(String(64), default="enterprise-intelligence")
    description: Mapped[str] = mapped_column(Text, default="")
    formula: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="published", index=True)
    effective_from: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    retired_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)


class EnterpriseMetricSnapshot(Base):
    __tablename__ = "ai_enterprise_metric_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "scope_fingerprint",
            "metric_code",
            "definition_version",
            "period_start",
            "period_end",
            "data_cutoff_at",
            "data_version",
            name="uq_ai_enterprise_metric_snapshots_immutable_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    organization_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    scope_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    policy_version: Mapped[str] = mapped_column(String(64), default="")
    scope_type: Mapped[str] = mapped_column(String(48), default="project_membership", index=True)
    scope_id: Mapped[str] = mapped_column(String(128), default="")
    metric_code: Mapped[str] = mapped_column(String(96), index=True)
    definition_version: Mapped[str] = mapped_column(String(32))
    period_start: Mapped[datetime] = mapped_column(DateTime, index=True)
    period_end: Mapped[datetime] = mapped_column(DateTime, index=True)
    data_cutoff_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    data_version: Mapped[str] = mapped_column(String(128))
    numerator: Mapped[int] = mapped_column(Integer, default=0)
    denominator: Mapped[int | None] = mapped_column(Integer, nullable=True)
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    freshness: Mapped[str] = mapped_column(String(24), default="fresh", index=True)
    data_completeness: Mapped[float] = mapped_column(Float, default=0.0)
    suppressed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    exclusions_json: Mapped[list] = mapped_column(JSON, default=list)
    evidence_refs_json: Mapped[list] = mapped_column(JSON, default=list)
    reason: Mapped[str] = mapped_column(Text, default="")
    source_hash: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class EnterpriseProjectHealthSnapshot(Base):
    __tablename__ = "ai_enterprise_project_health_snapshots"
    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "scope_fingerprint",
            "rule_version",
            "as_of",
            name="uq_ai_enterprise_project_health_snapshots_immutable_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    organization_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    project_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        index=True,
    )
    project_uuid: Mapped[str] = mapped_column(String(36), index=True)
    scope_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    rule_version: Mapped[str] = mapped_column(String(64), index=True)
    as_of: Mapped[datetime] = mapped_column(DateTime, index=True)
    dimensions_json: Mapped[list] = mapped_column(JSON, default=list)
    deductions_json: Mapped[list] = mapped_column(JSON, default=list)
    source_hash: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)


class EnterpriseDataQualityIssue(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_enterprise_data_quality_issues"
    __table_args__ = (
        UniqueConstraint(
            "issue_fingerprint",
            name="uq_ai_enterprise_data_quality_issues_fingerprint",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    scope_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    project_uuid: Mapped[str] = mapped_column(String(36), index=True)
    entity_type: Mapped[str] = mapped_column(String(48), index=True)
    entity_uuid: Mapped[str] = mapped_column(String(36), index=True)
    code: Mapped[str] = mapped_column(String(96), index=True)
    severity: Mapped[str] = mapped_column(String(24), index=True)
    message: Mapped[str] = mapped_column(Text)
    resolution: Mapped[str] = mapped_column(String(32), default="manual_review")
    status: Mapped[str] = mapped_column(String(24), default="unresolved", index=True)
    issue_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    detected_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolved_by: Mapped[str] = mapped_column(String(64), default="")
    source_version: Mapped[int] = mapped_column(Integer, default=1)
