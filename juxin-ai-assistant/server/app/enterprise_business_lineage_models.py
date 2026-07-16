"""Business lineage models for the 5.0 enterprise intelligence layer.

The existing project, contract, task, deliverable, issue and artifact tables
remain authoritative.  These additive relations make their business lineage
explicit without copying domain payloads into a generic JSON entity table.
"""

import uuid as uuid_lib
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .enterprise_intelligence_models import EnterpriseTimestampMixin, foreign_key_type, primary_key_type


class ProjectCustomerLink(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_project_customer_links"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "project_id",
            "customer_id",
            "relation_type",
            name="uq_ai_project_customer_links_relation",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    organization_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="CASCADE"),
        index=True,
    )
    project_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        index=True,
    )
    customer_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_enterprise_customers.id", ondelete="CASCADE"),
        index=True,
    )
    relation_type: Mapped[str] = mapped_column(String(32), default="primary", index=True)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    source: Mapped[str] = mapped_column(String(64), default="manual")
    confirmed_by: Mapped[str] = mapped_column(String(64), default="")
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class ProjectServiceOccurrence(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_project_service_occurrences"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "occurrence_key",
            name="uq_ai_project_service_occurrences_org_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    organization_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="CASCADE"),
        index=True,
    )
    project_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        index=True,
    )
    contract_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_project_contracts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    service_scope_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_project_service_scopes.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    task_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_project_tasks.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    deliverable_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_project_deliverables.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    workflow_run_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("ai_agent_runs.uuid", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    work_artifact_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifacts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    occurrence_key: Mapped[str] = mapped_column(String(192))
    period_start: Mapped[date] = mapped_column(Date, index=True)
    period_end: Mapped[date] = mapped_column(Date, index=True)
    due_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    status: Mapped[str] = mapped_column(String(24), default="scheduled", index=True)
    completion_evidence_type: Mapped[str] = mapped_column(String(48), default="")
    completion_evidence_uuid: Mapped[str] = mapped_column(String(64), default="")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_by: Mapped[str] = mapped_column(String(64), default="")
    source_version: Mapped[int] = mapped_column(Integer, default=1)
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class ProjectIssueAssetLink(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_project_issue_asset_links"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "issue_id",
            "asset_id",
            "relation_type",
            name="uq_ai_project_issue_asset_links_relation",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    organization_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="CASCADE"),
        index=True,
    )
    project_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        index=True,
    )
    issue_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_project_issues.id", ondelete="CASCADE"),
        index=True,
    )
    asset_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_project_assets.id", ondelete="CASCADE"),
        index=True,
    )
    relation_type: Mapped[str] = mapped_column(String(32), default="affected", index=True)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    source: Mapped[str] = mapped_column(String(64), default="manual")


class ProjectRemediation(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_project_remediations"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    organization_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="CASCADE"),
        index=True,
    )
    project_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        index=True,
    )
    issue_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_project_issues.id", ondelete="CASCADE"),
        index=True,
    )
    asset_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_project_assets.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    owner_user_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    priority: Mapped[str] = mapped_column(String(16), default="normal", index=True)
    status: Mapped[str] = mapped_column(String(24), default="open", index=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    verified_by: Mapped[str] = mapped_column(String(64), default="")
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    verification_status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class ProjectRemediationEvidenceLink(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_remediation_evidence_links"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "remediation_id",
            "evidence_type",
            "evidence_uuid",
            "source_version",
            name="uq_ai_remediation_evidence_links_evidence",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    organization_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="CASCADE"),
        index=True,
    )
    remediation_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_project_remediations.id", ondelete="CASCADE"),
        index=True,
    )
    evidence_type: Mapped[str] = mapped_column(String(48))
    evidence_uuid: Mapped[str] = mapped_column(String(64))
    source_table: Mapped[str] = mapped_column(String(128), default="")
    source_version: Mapped[int] = mapped_column(Integer, default=1)
    relation_type: Mapped[str] = mapped_column(String(32), default="supports", index=True)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    notes: Mapped[str] = mapped_column(Text, default="")
