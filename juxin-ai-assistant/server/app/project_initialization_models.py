from datetime import date, datetime

import uuid as uuid_lib
from sqlalchemy import Boolean, Date, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .project_workspace_models import (
    ProjectTimestampMixin,
    foreign_key_type,
    primary_key_type,
)


class ProjectContract(ProjectTimestampMixin, Base):
    __tablename__ = "ai_project_contracts"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    project_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(160))
    contract_no: Mapped[str] = mapped_column(String(96), default="")
    customer_name: Mapped[str] = mapped_column(String(160), default="")
    organization_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    customer_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_enterprise_customers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    source_file_uuid: Mapped[str | None] = mapped_column(String(36), nullable=True)
    extraction_status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    extracted_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    confirmed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(nullable=True)


class ProjectServiceScope(ProjectTimestampMixin, Base):
    __tablename__ = "ai_project_service_scopes"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
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
    name: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(96), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    frequency: Mapped[str] = mapped_column(String(48), default="")
    deliverable: Mapped[str] = mapped_column(String(160), default="")
    acceptance_criteria: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    confirmation_status: Mapped[str] = mapped_column(
        String(24), default="pending", index=True
    )
    current_version: Mapped[int] = mapped_column(Integer, default=1)
    confirmed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(nullable=True)


class ProjectServiceScopeVersion(ProjectTimestampMixin, Base):
    __tablename__ = "ai_project_service_scope_versions"
    __table_args__ = (
        UniqueConstraint(
            "service_scope_id",
            "version",
            name="uq_ai_project_scope_versions_scope_version",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    project_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        index=True,
    )
    service_scope_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_project_service_scopes.id", ondelete="CASCADE"),
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer)
    snapshot_json: Mapped[dict] = mapped_column(JSON, default=dict)
    change_summary: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(64))


class ProjectBusinessSystem(ProjectTimestampMixin, Base):
    __tablename__ = "ai_project_business_systems"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    project_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(160))
    system_type: Mapped[str] = mapped_column(String(96), default="")
    department: Mapped[str] = mapped_column(String(128), default="")
    owner: Mapped[str] = mapped_column(String(128), default="")
    deployment: Mapped[str] = mapped_column(String(96), default="")
    criticality: Mapped[str] = mapped_column(String(24), default="medium")
    internet_exposed: Mapped[bool] = mapped_column(Boolean, default=False)
    in_scope: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    confirmation_status: Mapped[str] = mapped_column(
        String(24), default="pending", index=True
    )
    notes: Mapped[str] = mapped_column(Text, default="")


class ProjectAsset(ProjectTimestampMixin, Base):
    __tablename__ = "ai_project_assets"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    project_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        index=True,
    )
    business_system_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_project_business_systems.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(160))
    asset_type: Mapped[str] = mapped_column(String(96), default="")
    identifier: Mapped[str] = mapped_column(String(160), default="")
    network_location: Mapped[str] = mapped_column(String(160), default="")
    purpose: Mapped[str] = mapped_column(String(256), default="")
    owner: Mapped[str] = mapped_column(String(128), default="")
    operating_system: Mapped[str] = mapped_column(String(128), default="")
    vendor_model: Mapped[str] = mapped_column(String(160), default="")
    criticality: Mapped[str] = mapped_column(String(24), default="medium")
    in_scope: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    confirmation_status: Mapped[str] = mapped_column(
        String(24), default="pending", index=True
    )
    notes: Mapped[str] = mapped_column(Text, default="")


class ProjectTargetGroup(ProjectTimestampMixin, Base):
    __tablename__ = "ai_project_target_groups"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    project_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        index=True,
    )
    name: Mapped[str] = mapped_column(String(160))
    group_type: Mapped[str] = mapped_column(String(48), default="custom")
    description: Mapped[str] = mapped_column(Text, default="")
    selection_rule: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)


class ProjectServiceTarget(ProjectTimestampMixin, Base):
    __tablename__ = "ai_project_service_targets"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    project_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        index=True,
    )
    service_scope_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_project_service_scopes.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    target_group_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_project_target_groups.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    target_type: Mapped[str] = mapped_column(String(48))
    target_value: Mapped[str] = mapped_column(String(256), default="")
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)


class ProjectExecutionRule(ProjectTimestampMixin, Base):
    __tablename__ = "ai_project_execution_rules"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    project_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        index=True,
    )
    service_scope_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_project_service_scopes.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    target_group_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_project_target_groups.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    frequency: Mapped[str] = mapped_column(String(48), default="")
    first_execution_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    execution_day: Mapped[str] = mapped_column(String(48), default="")
    time_window: Mapped[str] = mapped_column(String(96), default="")
    responsible_user_id: Mapped[str] = mapped_column(String(64), default="")
    collaborator_user_ids: Mapped[list] = mapped_column(JSON, default=list)
    customer_contact: Mapped[str] = mapped_column(String(160), default="")
    material_due_rule: Mapped[str] = mapped_column(String(256), default="")
    template_name: Mapped[str] = mapped_column(String(160), default="")
    skill_name: Mapped[str] = mapped_column(String(160), default="")
    deliverable_type: Mapped[str] = mapped_column(String(96), default="")
    due_rule: Mapped[str] = mapped_column(String(256), default="")
    reviewer_user_id: Mapped[str] = mapped_column(String(64), default="")
    acceptance_criteria: Mapped[str] = mapped_column(Text, default="")
    allow_ai_execution: Mapped[bool] = mapped_column(Boolean, default=False)
    needs_approval: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
