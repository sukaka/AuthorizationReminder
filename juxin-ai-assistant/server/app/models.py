import uuid as uuid_lib
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from . import governance_models as governance_models
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


class Assistant(TimestampMixin, Base):
    __tablename__ = "ai_assistants"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    code: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text, default="")
    icon: Mapped[str] = mapped_column(String(64), default="sparkles")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", index=True)
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    updated_by: Mapped[str] = mapped_column(String(64), default="system")


class Task(TimestampMixin, Base):
    __tablename__ = "ai_tasks"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    assistant_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_assistants.id", ondelete="CASCADE"),
        index=True,
    )
    code: Mapped[str] = mapped_column(String(96), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text, default="")
    output_format: Mapped[str] = mapped_column(Text, default="Markdown")
    safety_notice: Mapped[str] = mapped_column(Text, default="生成内容需人工复核")
    source_version: Mapped[str] = mapped_column(String(32), default="")
    source_ref: Mapped[str] = mapped_column(String(512), default="")
    document_type: Mapped[str] = mapped_column(String(32), default="PLAIN_TEXT")
    formal_document: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="DRAFT", index=True)
    ever_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    updated_by: Mapped[str] = mapped_column(String(64), default="system")

    assistant: Mapped[Assistant] = relationship()


class TaskField(TimestampMixin, Base):
    __tablename__ = "ai_task_fields"
    __table_args__ = (UniqueConstraint("task_id", "field_key"),)

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    task_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_tasks.id", ondelete="CASCADE"),
        index=True,
    )
    field_key: Mapped[str] = mapped_column(String(96))
    label: Mapped[str] = mapped_column(String(128))
    field_type: Mapped[str] = mapped_column(String(32))
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    placeholder: Mapped[str] = mapped_column(String(512), default="")
    example: Mapped[str] = mapped_column(Text, default="")
    options_json: Mapped[list] = mapped_column(JSON, default=list)
    validation_json: Mapped[dict] = mapped_column(JSON, default=dict)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    updated_by: Mapped[str] = mapped_column(String(64), default="system")


class TaskPromptBinding(TimestampMixin, Base):
    __tablename__ = "ai_task_prompt_bindings"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_tasks.id", ondelete="CASCADE"),
        unique=True,
    )
    prompt_external_id: Mapped[int] = mapped_column(BigInteger)
    version_policy: Mapped[str] = mapped_column(String(16), default="PUBLISHED")
    pinned_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", index=True)
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    updated_by: Mapped[str] = mapped_column(String(64), default="system")


class GenerationRecord(TimestampMixin, Base):
    __tablename__ = "ai_generation_records"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    sso_user_id: Mapped[str] = mapped_column(String(64), index=True)
    username_snapshot: Mapped[str] = mapped_column(String(128))
    department_snapshot: Mapped[str] = mapped_column(String(128), default="")
    task_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_tasks.id"),
        index=True,
    )
    prompt_external_id: Mapped[int] = mapped_column(BigInteger)
    prompt_version: Mapped[int] = mapped_column(Integer)
    input_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    output_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    input_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    output_nonce: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    key_version: Mapped[str] = mapped_column(String(32))
    completion_token_hash: Mapped[bytes] = mapped_column(LargeBinary)
    model_display_name: Mapped[str] = mapped_column(String(128), default="")
    model_id: Mapped[str] = mapped_column(String(128), default="")
    status: Mapped[str] = mapped_column(String(24), default="PENDING", index=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    usage_json: Mapped[dict] = mapped_column(JSON, default=dict)
    error_code: Mapped[str] = mapped_column(String(64), default="")
    parent_generation_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_generation_records.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error_message_safe: Mapped[str] = mapped_column(Text, default="")
    knowledge_refs_json: Mapped[list] = mapped_column(JSON, default=list)


class KnowledgeItem(TimestampMixin, Base):
    __tablename__ = "ai_knowledge_items"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    title: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(64), index=True)
    tags_json: Mapped[list] = mapped_column(JSON, default=list)
    keywords_json: Mapped[list] = mapped_column(JSON, default=list)
    content_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    content_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[str] = mapped_column(String(32))
    priority: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", index=True)
    created_by: Mapped[str] = mapped_column(String(64))
    updated_by: Mapped[str] = mapped_column(String(64))


class KnowledgeTaskLink(TimestampMixin, Base):
    __tablename__ = "ai_knowledge_task_links"
    __table_args__ = (UniqueConstraint("knowledge_id", "task_id"),)

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    knowledge_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_knowledge_items.id", ondelete="CASCADE"),
        index=True,
    )
    task_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_tasks.id", ondelete="CASCADE"),
        index=True,
    )


class FeedbackRecord(TimestampMixin, Base):
    __tablename__ = "ai_feedback_records"
    __table_args__ = (
        UniqueConstraint("generation_id", "sso_user_id", "feedback_type"),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    generation_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_generation_records.id", ondelete="CASCADE"),
        index=True,
    )
    sso_user_id: Mapped[str] = mapped_column(String(64), index=True)
    feedback_type: Mapped[str] = mapped_column(String(32))
    content_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    content_nonce: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    key_version: Mapped[str] = mapped_column(String(32))


class UserFavorite(TimestampMixin, Base):
    __tablename__ = "ai_user_favorites"
    __table_args__ = (UniqueConstraint("sso_user_id", "task_id"),)

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    sso_user_id: Mapped[str] = mapped_column(String(64), index=True)
    task_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_tasks.id", ondelete="CASCADE"),
        index=True,
    )
