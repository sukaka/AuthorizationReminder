"""Auditable graph edges and organization-memory records for 5.0.

These tables are additive.  Graph edges keep source evidence and a scope
fingerprint; organization memory is versioned and cannot become published
without an explicit review row.
"""

import uuid as uuid_lib
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Float, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base
from .enterprise_intelligence_models import EnterpriseTimestampMixin, foreign_key_type, primary_key_type


class EnterpriseGraphRelation(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_enterprise_graph_relations"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "source_entity_type",
            "source_entity_uuid",
            "relation_type",
            "target_entity_type",
            "target_entity_uuid",
            "source_version",
            name="uq_ai_enterprise_graph_relations_natural_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    organization_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="CASCADE"),
        index=True,
    )
    source_entity_type: Mapped[str] = mapped_column(String(48), index=True)
    source_entity_uuid: Mapped[str] = mapped_column(String(64), index=True)
    relation_type: Mapped[str] = mapped_column(String(64), index=True)
    target_entity_type: Mapped[str] = mapped_column(String(48), index=True)
    target_entity_uuid: Mapped[str] = mapped_column(String(64), index=True)
    direction: Mapped[str] = mapped_column(String(16), default="directed")
    weight: Mapped[float] = mapped_column(Float, default=1.0)
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    source: Mapped[str] = mapped_column(String(64), default="manual")
    scope_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    policy_version: Mapped[str] = mapped_column(String(64), default="")
    source_version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class EnterpriseGraphRelationEvidence(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_enterprise_graph_relation_evidence"
    __table_args__ = (
        UniqueConstraint(
            "relation_id",
            "evidence_type",
            "evidence_uuid",
            "source_version",
            name="uq_ai_enterprise_graph_relation_evidence_natural_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    relation_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_enterprise_graph_relations.id", ondelete="CASCADE"),
        index=True,
    )
    evidence_type: Mapped[str] = mapped_column(String(48), index=True)
    evidence_uuid: Mapped[str] = mapped_column(String(64), index=True)
    source_table: Mapped[str] = mapped_column(String(128), default="")
    source_version: Mapped[int] = mapped_column(Integer, default=1)
    evidence_hash: Mapped[str] = mapped_column(String(64), default="")
    notes: Mapped[str] = mapped_column(Text, default="")


class EnterpriseOrgMemoryItem(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_enterprise_org_memory_items"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "memory_key",
            name="uq_ai_enterprise_org_memory_items_org_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    organization_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="CASCADE"),
        index=True,
    )
    memory_key: Mapped[str] = mapped_column(String(128), index=True)
    title: Mapped[str] = mapped_column(String(255))
    memory_type: Mapped[str] = mapped_column(String(32), default="fact", index=True)
    sensitivity: Mapped[str] = mapped_column(String(24), default="standard", index=True)
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    current_version: Mapped[int] = mapped_column(Integer, default=0)
    policy_version: Mapped[str] = mapped_column(String(64), default="")
    source_scope_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    approved_by: Mapped[str] = mapped_column(String(64), default="")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class EnterpriseOrgMemoryVersion(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_enterprise_org_memory_versions"
    __table_args__ = (
        UniqueConstraint(
            "memory_item_id",
            "version",
            name="uq_ai_enterprise_org_memory_versions_item_version",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    memory_item_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_enterprise_org_memory_items.id", ondelete="CASCADE"),
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer)
    content_json: Mapped[dict] = mapped_column(JSON)
    source_refs_json: Mapped[list] = mapped_column(JSON, default=list)
    source_scope_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    source_hash: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(24), default="pending_review", index=True)
    change_reason: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    reviewed_by: Mapped[str] = mapped_column(String(64), default="")
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class EnterpriseOrgMemoryReview(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_enterprise_org_memory_reviews"
    __table_args__ = (
        UniqueConstraint(
            "memory_version_id",
            name="uq_ai_enterprise_org_memory_reviews_version",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    memory_version_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_enterprise_org_memory_versions.id", ondelete="CASCADE"),
        index=True,
    )
    action: Mapped[str] = mapped_column(String(24), index=True)
    reviewer_user_id: Mapped[str] = mapped_column(String(64), index=True)
    comment: Mapped[str] = mapped_column(Text, default="")
    policy_version: Mapped[str] = mapped_column(String(64), default="")


class EnterpriseOrgMemoryCandidate(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_enterprise_org_memory_candidates"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "candidate_fingerprint",
            name="uq_ai_enterprise_org_memory_candidates_fingerprint",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    organization_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="CASCADE"),
        index=True,
    )
    memory_key: Mapped[str] = mapped_column(String(128), index=True)
    title: Mapped[str] = mapped_column(String(255))
    content_json: Mapped[dict] = mapped_column(JSON)
    source_refs_json: Mapped[list] = mapped_column(JSON, default=list)
    source_scope_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    candidate_fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    source_version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    reviewed_by: Mapped[str] = mapped_column(String(64), default="")
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
