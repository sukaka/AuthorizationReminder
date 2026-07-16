"""Stable enterprise identity and entity-reference models for the 5.0 layer.

These tables are deliberately small: existing project, contract and delivery
tables remain the business facts, while this module provides organization,
customer and source-entity identities that can be shared by scope and metric
queries.
"""

import uuid as uuid_lib
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


primary_key_type = BigInteger().with_variant(Integer, "sqlite")
foreign_key_type = BigInteger().with_variant(Integer, "sqlite")


class EnterpriseTimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class EnterpriseOrganization(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_organizations"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    external_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    directory_version: Mapped[str] = mapped_column(String(64), default="")
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class EnterpriseOrganizationUnit(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_organization_units"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "external_id",
            name="uq_ai_organization_units_org_external",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    organization_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="CASCADE"),
        index=True,
    )
    parent_unit_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organization_units.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    external_id: Mapped[str] = mapped_column(String(128))
    name: Mapped[str] = mapped_column(String(160))
    unit_type: Mapped[str] = mapped_column(String(48), default="department")
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    directory_version: Mapped[str] = mapped_column(String(64), default="")
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class EnterpriseCustomer(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_enterprise_customers"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "customer_code",
            name="uq_ai_enterprise_customers_org_code",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    organization_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="CASCADE"),
        index=True,
    )
    customer_code: Mapped[str] = mapped_column(String(96))
    name: Mapped[str] = mapped_column(String(160))
    sensitivity: Mapped[str] = mapped_column(String(24), default="standard")
    source_system: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class CustomerIdentityBinding(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_customer_identity_bindings"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "provider",
            "external_subject",
            name="uq_ai_customer_identity_bindings_subject",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    organization_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="CASCADE"),
        index=True,
    )
    customer_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_enterprise_customers.id", ondelete="CASCADE"),
        index=True,
    )
    provider: Mapped[str] = mapped_column(String(64))
    external_subject: Mapped[str] = mapped_column(String(192))
    verification_status: Mapped[str] = mapped_column(
        String(24), default="pending", index=True
    )
    valid_from: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    valid_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class EnterpriseEntityRef(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_enterprise_entity_refs"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "entity_type",
            "canonical_uuid",
            name="uq_ai_enterprise_entity_refs_canonical",
        ),
        UniqueConstraint(
            "organization_id",
            "source_table",
            "source_uuid",
            "source_version",
            name="uq_ai_enterprise_entity_refs_source_version",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    organization_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="CASCADE"),
        index=True,
    )
    entity_type: Mapped[str] = mapped_column(String(64), index=True)
    canonical_uuid: Mapped[str] = mapped_column(String(36))
    source_table: Mapped[str] = mapped_column(String(128), index=True)
    source_uuid: Mapped[str] = mapped_column(String(36))
    source_version: Mapped[int] = mapped_column(Integer, default=1)
    relation_status: Mapped[str] = mapped_column(
        String(24), default="confirmed", index=True
    )
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class EnterpriseEntityAlias(EnterpriseTimestampMixin, Base):
    __tablename__ = "ai_enterprise_entity_aliases"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "source_system",
            "alias",
            name="uq_ai_enterprise_entity_aliases_source_alias",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    organization_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="CASCADE"),
        index=True,
    )
    entity_ref_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_enterprise_entity_refs.id", ondelete="CASCADE"),
        index=True,
    )
    source_system: Mapped[str] = mapped_column(String(64))
    alias: Mapped[str] = mapped_column(String(192))
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    valid_from: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    valid_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
