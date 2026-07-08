import uuid as uuid_lib
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    LargeBinary,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


primary_key_type = BigInteger().with_variant(Integer, "sqlite")
foreign_key_type = BigInteger().with_variant(Integer, "sqlite")


class TimestampMixin:
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


class TaskSuggestion(TimestampMixin, Base):
    __tablename__ = "ai_task_suggestions"
    __table_args__ = (
        CheckConstraint(
            "content_ciphertext IS NOT NULL AND content_nonce IS NOT NULL",
            name="ck_ai_task_suggestions_content_pair",
        ),
        CheckConstraint(
            "(review_comment_ciphertext IS NULL AND "
            "review_comment_nonce IS NULL) OR "
            "(review_comment_ciphertext IS NOT NULL AND "
            "review_comment_nonce IS NOT NULL)",
            name="ck_ai_task_suggestions_review_comment_pair",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    sso_user_id: Mapped[str] = mapped_column(String(64), index=True)
    department_code: Mapped[str] = mapped_column(String(128), index=True)
    suggestion_type: Mapped[str] = mapped_column(String(32))
    task_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_tasks.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    content_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    content_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16), default="PENDING", index=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    review_comment_ciphertext: Mapped[bytes | None] = mapped_column(
        LargeBinary,
        nullable=True,
    )
    review_comment_nonce: Mapped[bytes | None] = mapped_column(
        LargeBinary,
        nullable=True,
    )


class SystemSetting(TimestampMixin, Base):
    __tablename__ = "ai_system_settings"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    setting_key: Mapped[str] = mapped_column(String(96), unique=True)
    value_json: Mapped[dict] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", index=True)
    created_by: Mapped[str] = mapped_column(String(64))
    updated_by: Mapped[str] = mapped_column(String(64))


class AuditLog(Base):
    __tablename__ = "ai_audit_logs"
    __table_args__ = (
        Index("idx_ai_audit_created", "created_at"),
        Index(
            "idx_ai_audit_entity",
            "entity_type",
            "entity_uuid",
            "created_at",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    sso_user_id: Mapped[str] = mapped_column(String(64), index=True)
    username_snapshot: Mapped[str] = mapped_column(String(128))
    action: Mapped[str] = mapped_column(String(96), index=True)
    entity_type: Mapped[str] = mapped_column(String(64))
    entity_uuid: Mapped[str] = mapped_column(String(64), default="")
    result: Mapped[str] = mapped_column(String(16))
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    ip_hash: Mapped[str] = mapped_column(String(64), default="")
    user_agent_hash: Mapped[str] = mapped_column(String(64), default="")
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
