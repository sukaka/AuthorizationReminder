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


class ProjectTimestampMixin:
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


class Project(ProjectTimestampMixin, Base):
    __tablename__ = "ai_projects"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    owner_user_id: Mapped[str] = mapped_column(String(64), index=True)
    created_by: Mapped[str] = mapped_column(String(64), index=True)
    organization_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    owner_department_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_organization_units.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    primary_customer_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_enterprise_customers.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )


class ProjectMember(ProjectTimestampMixin, Base):
    __tablename__ = "ai_project_members"
    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "user_id",
            name="uq_ai_project_members_project_user",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    project_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="CASCADE"),
        index=True,
    )
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    role: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    invited_by: Mapped[str] = mapped_column(String(64), default="")
