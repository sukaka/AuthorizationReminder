import uuid as uuid_lib
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.mysql import MEDIUMBLOB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from . import governance_models as governance_models
from .database import Base


primary_key_type = BigInteger().with_variant(Integer, "sqlite")
foreign_key_type = BigInteger().with_variant(Integer, "sqlite")
# Long-running chat/PPT requests include prepared context and can exceed MySQL
# BLOB's 64 KiB limit after encryption.  Keep SQLite's portable BLOB type while
# allocating sufficient room in production MySQL.
long_task_payload_type = LargeBinary().with_variant(MEDIUMBLOB, "mysql")


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
    allowed_tools_json: Mapped[list] = mapped_column(JSON, default=list)
    default_source_scope: Mapped[str] = mapped_column(String(32), default="company")
    default_output_structure: Mapped[str] = mapped_column(Text, default="")
    word_template: Mapped[str] = mapped_column(String(64), default="juxin_standard")
    version: Mapped[int] = mapped_column(Integer, default=1)
    test_cases_json: Mapped[list] = mapped_column(JSON, default=list)
    review_status: Mapped[str] = mapped_column(String(24), default="approved", index=True)
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    updated_by: Mapped[str] = mapped_column(String(64), default="system")


class AssistantModeVersion(TimestampMixin, Base):
    __tablename__ = "ai_assistant_mode_versions"
    __table_args__ = (UniqueConstraint("assistant_id", "version"),)

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
    version: Mapped[int] = mapped_column(Integer)
    snapshot_json: Mapped[dict] = mapped_column(JSON, default=dict)
    action: Mapped[str] = mapped_column(String(32), default="update", index=True)
    created_by: Mapped[str] = mapped_column(String(64), default="system", index=True)


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
    document_template_code: Mapped[str] = mapped_column(String(64), default="")
    output_schema_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    attachment_policy_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
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
    rollout_token: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", index=True)
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    updated_by: Mapped[str] = mapped_column(String(64), default="system")


class PromptCatalogRollout(TimestampMixin, Base):
    __tablename__ = "ai_prompt_catalog_rollouts"

    id: Mapped[int] = mapped_column(
        primary_key_type,
        primary_key=True,
        autoincrement=True,
    )
    token: Mapped[str] = mapped_column(String(64), unique=True)
    status: Mapped[str] = mapped_column(String(16), index=True)
    force_config: Mapped[bool] = mapped_column(Boolean, default=False)
    target_json: Mapped[dict] = mapped_column(JSON)
    frozen_tasks_json: Mapped[list] = mapped_column(JSON, default=list)


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


class GenerationAttachment(TimestampMixin, Base):
    __tablename__ = "ai_generation_attachments"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    sso_user_id: Mapped[str] = mapped_column(String(64), index=True)
    task_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_tasks.id"),
        index=True,
    )
    generation_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_generation_records.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    file_name: Mapped[str] = mapped_column(String(255))
    file_type: Mapped[str] = mapped_column(String(128))
    file_size: Mapped[int] = mapped_column(Integer)
    content_sha256: Mapped[str] = mapped_column(String(64), index=True)
    extracted_text_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    extracted_text_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(24), default="READY", index=True)
    error_code: Mapped[str] = mapped_column(String(64), default="")


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


class KnowledgeBase(TimestampMixin, Base):
    __tablename__ = "ai_knowledge_bases"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    name: Mapped[str] = mapped_column(String(128))
    description: Mapped[str] = mapped_column(Text, default="")
    scope: Mapped[str] = mapped_column(String(24), default="company", index=True)
    owner_user_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    department_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    project_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    created_by: Mapped[str] = mapped_column(String(64), default="", index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class KnowledgeCategory(TimestampMixin, Base):
    __tablename__ = "ai_knowledge_categories"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    name: Mapped[str] = mapped_column(String(64), index=True)
    parent_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_knowledge_categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    scope: Mapped[str] = mapped_column(String(24), default="company", index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", index=True)
    created_by: Mapped[str] = mapped_column(String(64), default="", index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class KnowledgeDocumentType(TimestampMixin, Base):
    __tablename__ = "ai_knowledge_document_types"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    name: Mapped[str] = mapped_column(String(64), index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", index=True)
    created_by: Mapped[str] = mapped_column(String(64), default="", index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class KnowledgeFile(TimestampMixin, Base):
    __tablename__ = "ai_knowledge_files"

    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)
        if getattr(self, "original_file_name", None) is None:
            self.original_file_name = getattr(self, "file_name", "")
        if getattr(self, "stored_file_name", None) is None:
            self.stored_file_name = ""
        if getattr(self, "file_path", None) is None:
            self.file_path = ""
        defaults = {
            "category": "个人素材",
            "document_type": "其他",
            "key_version": "v1",
            "tags_json": [],
            "summary": "",
            "parse_status": "parsed",
            "index_status": "indexed",
            "source_type": "user_upload",
            "source_origin": "upload",
            "web_capture_id": "",
            "source_url": "",
            "usage_type": "personal_reference",
            "review_status": "draft",
            "rag_enabled": False,
            "reference_enabled": True,
            "rag_scope": "personal",
            "permission_scope": "private",
            "owner_user_id": getattr(self, "sso_user_id", ""),
            "conversation_id": "",
            "version": 1,
            "is_current_version": True,
            "uploaded_by": getattr(self, "sso_user_id", ""),
            "reviewed_by": "",
            "review_comment": "",
            "usage_count": 0,
            "external_public": False,
            "external_download_allowed": False,
        }
        for key, value in defaults.items():
            if getattr(self, key, None) is None:
                setattr(self, key, value)

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    knowledge_base_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_knowledge_bases.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    sso_user_id: Mapped[str] = mapped_column(String(64), index=True)
    file_name: Mapped[str] = mapped_column(String(255))
    original_file_name: Mapped[str] = mapped_column(String(255), default="")
    stored_file_name: Mapped[str] = mapped_column(String(255), default="")
    file_type: Mapped[str] = mapped_column(String(128))
    file_size: Mapped[int] = mapped_column(Integer)
    file_path: Mapped[str] = mapped_column(String(1024), default="")
    category: Mapped[str] = mapped_column(String(64), default="个人素材", index=True)
    document_type: Mapped[str] = mapped_column(String(64), default="其他", index=True)
    tags_json: Mapped[list] = mapped_column(JSON, default=list)
    summary: Mapped[str] = mapped_column(Text, default="")
    parse_status: Mapped[str] = mapped_column(String(24), default="parsed", index=True)
    index_status: Mapped[str] = mapped_column(String(24), default="indexed", index=True)
    source_type: Mapped[str] = mapped_column(String(24), default="user_upload", index=True)
    source_origin: Mapped[str] = mapped_column(String(32), default="upload", index=True)
    web_capture_id: Mapped[str] = mapped_column(String(36), default="", index=True)
    source_url: Mapped[str] = mapped_column(String(2048), default="")
    usage_type: Mapped[str] = mapped_column(String(32), default="personal_reference", index=True)
    review_status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    rag_enabled: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    reference_enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    rag_scope: Mapped[str] = mapped_column(String(24), default="personal", index=True)
    permission_scope: Mapped[str] = mapped_column(String(24), default="private", index=True)
    owner_user_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    conversation_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    parent_file_id: Mapped[int | None] = mapped_column(foreign_key_type, nullable=True)
    is_current_version: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    replaced_by_file_id: Mapped[int | None] = mapped_column(foreign_key_type, nullable=True)
    uploaded_by: Mapped[str] = mapped_column(String(64), default="", index=True)
    reviewed_by: Mapped[str] = mapped_column(String(64), default="", index=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    review_comment: Mapped[str] = mapped_column(Text, default="")
    content_sha256: Mapped[str] = mapped_column(String(64), index=True)
    visibility: Mapped[str] = mapped_column(String(24), default="PRIVATE", index=True)
    status: Mapped[str] = mapped_column(String(24), default="READY", index=True)
    error_code: Mapped[str] = mapped_column(String(64), default="")
    key_version: Mapped[str] = mapped_column(String(32), default="v1")
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    hard_deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    usage_count: Mapped[int] = mapped_column(Integer, default=0)
    external_public: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    external_download_allowed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)


class WechatExternalVisitor(TimestampMixin, Base):
    __tablename__ = "ai_wechat_external_visitors"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    openid_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", index=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)


class WechatExternalQuestionAudit(TimestampMixin, Base):
    __tablename__ = "ai_wechat_external_question_audits"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    visitor_id: Mapped[int] = mapped_column(foreign_key_type, ForeignKey("ai_wechat_external_visitors.id", ondelete="CASCADE"), index=True)
    quota_event_id: Mapped[str] = mapped_column(String(64), unique=True)
    question_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), default="RESERVED", index=True)
    failure_code: Mapped[str] = mapped_column(String(64), default="")
    model_id: Mapped[str] = mapped_column(String(128), default="")
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_file_ids_json: Mapped[list] = mapped_column(JSON, default=list)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ExternalQuestionEvent(TimestampMixin, Base):
    """Encrypted customer question event shared by external channels."""

    __tablename__ = "ai_external_question_events"
    __table_args__ = (UniqueConstraint("source_channel", "external_message_id"),)

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    source_channel: Mapped[str] = mapped_column(String(32), index=True)
    external_identity_hash: Mapped[str] = mapped_column(String(64), index=True)
    conversation_key: Mapped[str] = mapped_column(String(128), default="", index=True)
    external_message_id: Mapped[str] = mapped_column(String(128), index=True)
    question_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    question_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    status: Mapped[str] = mapped_column(String(24), default="RECEIVED", index=True)
    source_file_ids_json: Mapped[list] = mapped_column(JSON, default=list)
    handoff_ticket_id: Mapped[str] = mapped_column(String(36), default="", index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ExternalSupportTicket(TimestampMixin, Base):
    """A human handoff for one external customer question."""

    __tablename__ = "ai_external_support_tickets"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    external_question_event_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_external_question_events.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    source_channel: Mapped[str] = mapped_column(String(32), index=True)
    conversation_key: Mapped[str] = mapped_column(String(128), default="", index=True)
    reason_code: Mapped[str] = mapped_column(String(32), default="NO_EVIDENCE", index=True)
    status: Mapped[str] = mapped_column(String(24), default="PENDING", index=True)
    priority: Mapped[str] = mapped_column(String(16), default="NORMAL", index=True)
    assigned_to: Mapped[str] = mapped_column(String(64), default="", index=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    replied_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    recipient_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    recipient_nonce: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)


class ExternalSupportTicketMessage(TimestampMixin, Base):
    """Encrypted reply audit trail for an external support ticket."""

    __tablename__ = "ai_external_support_ticket_messages"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    ticket_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_external_support_tickets.id", ondelete="CASCADE"),
        index=True,
    )
    sender_type: Mapped[str] = mapped_column(String(16), default="ENGINEER", index=True)
    sender_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    message_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    message_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    delivery_status: Mapped[str] = mapped_column(String(24), default="STORED", index=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class WechatExternalDownloadAudit(TimestampMixin, Base):
    __tablename__ = "ai_wechat_external_download_audits"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    visitor_id: Mapped[int] = mapped_column(foreign_key_type, ForeignKey("ai_wechat_external_visitors.id", ondelete="CASCADE"), index=True)
    file_id: Mapped[int] = mapped_column(foreign_key_type, ForeignKey("ai_knowledge_files.id", ondelete="CASCADE"), index=True)
    download_token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    status: Mapped[str] = mapped_column(String(16), default="ISSUED", index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    downloaded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class KnowledgeChunk(TimestampMixin, Base):
    __tablename__ = "ai_knowledge_chunks"
    __table_args__ = (UniqueConstraint("file_id", "chunk_index"),)

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    chunk_id: Mapped[str] = mapped_column(String(64), unique=True)
    file_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_knowledge_files.id", ondelete="CASCADE"),
        index=True,
    )
    knowledge_base_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_knowledge_bases.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    file_name: Mapped[str] = mapped_column(String(255))
    chunk_text_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    chunk_text_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    section_title: Mapped[str] = mapped_column(String(255), default="")
    chunk_index: Mapped[int] = mapped_column(Integer)
    token_estimate: Mapped[int] = mapped_column(Integer, default=0)
    token_count: Mapped[int] = mapped_column(Integer, default=0)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    embedding_id: Mapped[str] = mapped_column(String(128), default="", index=True)
    status: Mapped[str] = mapped_column(String(24), default="READY", index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class KnowledgeSearchLog(TimestampMixin, Base):
    __tablename__ = "ai_knowledge_search_logs"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    question: Mapped[str] = mapped_column(Text)
    mode: Mapped[str] = mapped_column(String(64), default="", index=True)
    search_type: Mapped[str] = mapped_column(String(32), index=True)
    knowledge_base_ids_json: Mapped[list] = mapped_column(JSON, default=list)
    filters_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    retrieved_chunk_ids_json: Mapped[list] = mapped_column(JSON, default=list)
    answer_message_id: Mapped[str] = mapped_column(String(64), default="", index=True)


class KnowledgeReviewLog(TimestampMixin, Base):
    __tablename__ = "ai_knowledge_review_logs"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    file_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_knowledge_files.id", ondelete="CASCADE"),
        index=True,
    )
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    reviewer_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    action: Mapped[str] = mapped_column(String(32), index=True)
    old_status: Mapped[str] = mapped_column(String(24), default="")
    new_status: Mapped[str] = mapped_column(String(24), default="")
    comment: Mapped[str] = mapped_column(Text, default="")


class WebCapture(TimestampMixin, Base):
    __tablename__ = "ai_web_captures"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    conversation_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    url: Mapped[str] = mapped_column(String(2048))
    final_url: Mapped[str] = mapped_column(String(2048), default="")
    site_name: Mapped[str] = mapped_column(String(128), default="")
    title: Mapped[str] = mapped_column(String(255), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    extracted_text: Mapped[str] = mapped_column(Text, default="")
    published_at_text: Mapped[str] = mapped_column(String(64), default="")
    fetched_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    suggested_category: Mapped[str] = mapped_column(String(64), default="个人素材")
    suggested_document_type: Mapped[str] = mapped_column(String(64), default="其他")
    status: Mapped[str] = mapped_column(String(24), default="previewed", index=True)
    save_target: Mapped[str] = mapped_column(String(32), default="", index=True)
    review_status: Mapped[str] = mapped_column(String(24), default="none", index=True)
    content_hash: Mapped[str] = mapped_column(String(64), default="", index=True)
    knowledge_file_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_knowledge_files.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    error_message: Mapped[str] = mapped_column(Text, default="")


class WebSearchLog(TimestampMixin, Base):
    __tablename__ = "ai_web_search_logs"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    conversation_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    query: Mapped[str] = mapped_column(Text)
    provider: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    result_count: Mapped[int] = mapped_column(Integer, default=0)
    result_urls_json: Mapped[list] = mapped_column(JSON, default=list)
    used_urls_json: Mapped[list] = mapped_column(JSON, default=list)
    answer_message_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    error_message: Mapped[str] = mapped_column(Text, default="")


class AgentToolCallLog(TimestampMixin, Base):
    __tablename__ = "ai_agent_tool_calls"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    run_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    message_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    conversation_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    mode: Mapped[str] = mapped_column(String(64), default="", index=True)
    tool_name: Mapped[str] = mapped_column(String(96), index=True)
    tool_version: Mapped[str] = mapped_column(String(32), default="")
    status: Mapped[str] = mapped_column(String(24), default="success", index=True)
    permission: Mapped[str] = mapped_column(String(128), default="")
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    source_count: Mapped[int] = mapped_column(Integer, default=0)
    input_summary_json: Mapped[dict] = mapped_column(JSON, default=dict)
    output_summary_json: Mapped[dict] = mapped_column(JSON, default=dict)
    error_code: Mapped[str] = mapped_column(String(64), default="", index=True)
    error_message_safe: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reconciliation_resolution: Mapped[str] = mapped_column(String(48), default="", index=True)
    reconciled_by_user_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    reconciled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AgentToolInvocation(TimestampMixin, Base):
    """Durable, idempotent outcome record for side-effecting tool calls."""

    __tablename__ = "ai_agent_tool_invocations"
    __table_args__ = (UniqueConstraint("run_id", "tool_name", "idempotency_key"),)

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    run_id: Mapped[str] = mapped_column(String(64), index=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    tool_name: Mapped[str] = mapped_column(String(96), index=True)
    tool_version: Mapped[str] = mapped_column(String(32), default="")
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64), index=True)
    effect: Mapped[str] = mapped_column(String(16), default="write", index=True)
    status: Mapped[str] = mapped_column(String(32), default="in_progress", index=True)
    result_payload_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    output_summary_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    source_count: Mapped[int] = mapped_column(Integer, default=0)
    error_code: Mapped[str] = mapped_column(String(64), default="", index=True)
    error_message_safe: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reconciliation_resolution: Mapped[str] = mapped_column(String(48), default="", index=True)
    reconciled_by_user_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    reconciled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class DirectActionInvocation(TimestampMixin, Base):
    """Durable idempotency ledger for user-initiated side effects outside AgentRun."""

    __tablename__ = "ai_direct_action_invocations"
    __table_args__ = (UniqueConstraint("user_id", "action_name", "idempotency_key"),)

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    action_name: Mapped[str] = mapped_column(String(96), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(32), default="in_progress", index=True)
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_payload_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_code: Mapped[str] = mapped_column(String(64), default="", index=True)
    error_message_safe: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reconciliation_resolution: Mapped[str] = mapped_column(String(48), default="", index=True)
    reconciled_by_user_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    reconciled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class SearchCache(TimestampMixin, Base):
    __tablename__ = "ai_search_cache"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    cache_key: Mapped[str] = mapped_column(String(128), unique=True)
    provider: Mapped[str] = mapped_column(String(64), default="", index=True)
    query: Mapped[str] = mapped_column(Text)
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)


class AgentTaskState(TimestampMixin, Base):
    __tablename__ = "ai_agent_task_states"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    conversation_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    stage: Mapped[str] = mapped_column(String(64), default="analyzing", index=True)
    goal: Mapped[str] = mapped_column(Text, default="")
    selected_sources_json: Mapped[list] = mapped_column(JSON, default=list)
    tool_calls_json: Mapped[list] = mapped_column(JSON, default=list)
    verification_status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    verification_json: Mapped[dict] = mapped_column(JSON, default=dict)
    next_action: Mapped[str] = mapped_column(String(256), default="")
    stage_history_json: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)


class LongTask(TimestampMixin, Base):
    __tablename__ = "ai_long_tasks"
    __table_args__ = (UniqueConstraint("message_id"),)

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    owner_user_id: Mapped[str] = mapped_column(String(64), index=True)
    conversation_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    message_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    task_type: Mapped[str] = mapped_column(String(48), default="chat_generation", index=True)
    title: Mapped[str] = mapped_column(String(255), default="后台任务")
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    stage: Mapped[str] = mapped_column(String(64), default="queued", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    request_ciphertext: Mapped[bytes] = mapped_column(long_task_payload_type)
    request_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    draft_ciphertext: Mapped[bytes] = mapped_column(long_task_payload_type, default=b"")
    draft_nonce: Mapped[bytes] = mapped_column(LargeBinary, default=b"")
    key_version: Mapped[str] = mapped_column(String(32), default="v1")
    checkpoint_json: Mapped[dict] = mapped_column(JSON, default=dict)
    result_json: Mapped[dict] = mapped_column(JSON, default=dict)
    error_code: Mapped[str] = mapped_column(String(64), default="", index=True)
    error_message_safe: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class HarnessSpecVersion(TimestampMixin, Base):
    __tablename__ = "ai_harness_spec_versions"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    semantic_version: Mapped[str] = mapped_column(String(32), unique=True)
    content_hash: Mapped[str] = mapped_column(String(64), unique=True)
    content_json: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    created_by_user_id: Mapped[str] = mapped_column(String(64), default="system", index=True)
    approved_by_user_id: Mapped[str] = mapped_column(String(64), default="")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    activated_by_user_id: Mapped[str] = mapped_column(String(64), default="")
    activated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class HarnessSpecAuditEvent(TimestampMixin, Base):
    __tablename__ = "ai_harness_spec_audit_events"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    spec_uuid: Mapped[str] = mapped_column(
        String(36), ForeignKey("ai_harness_spec_versions.uuid", ondelete="CASCADE"), index=True
    )
    action: Mapped[str] = mapped_column(String(32), index=True)
    actor_id: Mapped[str] = mapped_column(String(64), default="system", index=True)
    from_status: Mapped[str] = mapped_column(String(24), default="")
    to_status: Mapped[str] = mapped_column(String(24), default="")
    detail_json: Mapped[dict] = mapped_column(JSON, default=dict)


class AgentRun(TimestampMixin, Base):
    __tablename__ = "ai_agent_runs"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    owner_user_id: Mapped[str] = mapped_column(String(64), index=True)
    conversation_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    message_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    run_type: Mapped[str] = mapped_column(String(48), default="chat", index=True)
    title: Mapped[str] = mapped_column(String(255), default="AI 任务")
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    stage: Mapped[str] = mapped_column(String(64), default="accepted", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    max_steps: Mapped[int] = mapped_column(Integer, default=32)
    max_model_calls: Mapped[int] = mapped_column(Integer, default=20)
    max_cost_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    max_step_tool_calls: Mapped[int] = mapped_column(Integer, default=0)
    max_step_tokens: Mapped[int] = mapped_column(Integer, default=0)
    max_step_latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    model_calls: Mapped[int] = mapped_column(Integer, default=0)
    cost_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    request_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    request_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[str] = mapped_column(String(32), default="v1")
    state_schema_version: Mapped[str] = mapped_column(String(16), default="0", index=True)
    harness_spec_uuid: Mapped[str] = mapped_column(String(36), default="", index=True)
    harness_spec_version: Mapped[str] = mapped_column(String(32), default="legacy", index=True)
    harness_spec_hash: Mapped[str] = mapped_column(String(64), default="")
    state_revision: Mapped[int] = mapped_column(Integer, default=0)
    lease_owner: Mapped[str] = mapped_column(String(128), default="", index=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    fencing_token: Mapped[int] = mapped_column(Integer, default=0)
    checkpoint_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    result_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_code: Mapped[str] = mapped_column(String(64), default="", index=True)
    error_message_safe: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __mapper_args__ = {"version_id_col": state_revision}


class AgentRunLangGraphCheckpoint(TimestampMixin, Base):
    """Versioned, independently committed LangGraph checkpoint records."""

    __tablename__ = "ai_agent_langgraph_checkpoints"
    __table_args__ = (
        UniqueConstraint(
            "run_id",
            "thread_id",
            "checkpoint_id",
            name="uq_ai_agent_langgraph_checkpoint_identity",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("ai_agent_runs.uuid", ondelete="CASCADE"),
        index=True,
    )
    thread_id: Mapped[str] = mapped_column(String(64), index=True)
    checkpoint_ns: Mapped[str] = mapped_column(String(255), default="")
    checkpoint_id: Mapped[str] = mapped_column(String(255))
    parent_checkpoint_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    checkpoint_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    pending_writes_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    new_versions_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    writer_id: Mapped[str] = mapped_column(String(128), default="")
    fencing_token: Mapped[int] = mapped_column(Integer, default=0, index=True)


class AgentRunStep(TimestampMixin, Base):
    __tablename__ = "ai_agent_run_steps"
    __table_args__ = (UniqueConstraint("run_id", "sequence"),)

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    run_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("ai_agent_runs.uuid", ondelete="CASCADE"),
        index=True,
    )
    sequence: Mapped[int] = mapped_column(Integer)
    step_type: Mapped[str] = mapped_column(String(64), index=True)
    role: Mapped[str] = mapped_column(String(48), default="")
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    input_summary_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    output_summary_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    checkpoint_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    usage_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    error_code: Mapped[str] = mapped_column(String(64), default="", index=True)
    error_message_safe: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AgentRunEvent(TimestampMixin, Base):
    __tablename__ = "ai_run_events"
    __table_args__ = (
        UniqueConstraint("run_id", "sequence"),
        UniqueConstraint("run_id", "event_key"),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    run_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("ai_agent_runs.uuid", ondelete="CASCADE"),
        index=True,
    )
    sequence: Mapped[int] = mapped_column(Integer)
    event_key: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(24), index=True)
    stage: Mapped[str] = mapped_column(String(64), default="")
    label: Mapped[str] = mapped_column(String(255), default="")
    progress: Mapped[int | None] = mapped_column(Integer, nullable=True)
    content: Mapped[str] = mapped_column(Text, default="")
    source_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    artifact_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    quality_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class SharedFaq(TimestampMixin, Base):
    """Company-wide FAQ for zero-model unified replies (6.0 P0)."""

    __tablename__ = "ai_shared_faqs"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    question: Mapped[str] = mapped_column(String(500))
    question_normalized: Mapped[str] = mapped_column(String(500), unique=True, index=True)
    aliases_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    answer: Mapped[str] = mapped_column(Text)
    previous_answer: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    match_threshold: Mapped[float] = mapped_column(Float, default=0.88)
    # draft | published | active | disabled
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    hit_count: Mapped[int] = mapped_column(Integer, default=0)
    last_hit_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    updated_by: Mapped[str] = mapped_column(String(64), default="system")



class AgentArtifact(TimestampMixin, Base):
    """Formal deliverable artifact (6.0)."""

    __tablename__ = "ai_artifacts"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    owner_user_id: Mapped[str] = mapped_column(String(64), index=True)
    run_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    artifact_type: Mapped[str] = mapped_column(String(48), default="markdown", index=True)
    title: Mapped[str] = mapped_column(String(255), default="成果")
    status: Mapped[str] = mapped_column(String(24), default="ready", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    content_markdown: Mapped[str] = mapped_column(Text, default="")
    download_ref: Mapped[str] = mapped_column(String(1024), default="")
    quality_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class AgentArtifactVersion(TimestampMixin, Base):
    __tablename__ = "ai_artifact_versions"
    __table_args__ = (UniqueConstraint("artifact_id", "version"),)

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    artifact_id: Mapped[str] = mapped_column(String(64), index=True)
    version: Mapped[int] = mapped_column(Integer)
    content_markdown: Mapped[str] = mapped_column(Text, default="")
    change_summary: Mapped[str] = mapped_column(String(500), default="")
    created_by: Mapped[str] = mapped_column(String(64), default="")


class AgentArtifactReview(TimestampMixin, Base):
    """Separate AI and human review records for a deliverable."""

    __tablename__ = "ai_artifact_reviews"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    artifact_id: Mapped[str] = mapped_column(String(64), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    reviewer_type: Mapped[str] = mapped_column(String(16), index=True)
    reviewer_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    decision: Mapped[str] = mapped_column(String(24), index=True)
    comment: Mapped[str] = mapped_column(Text, default="")
    findings_json: Mapped[list | None] = mapped_column(JSON, nullable=True)


class WorkflowDefinition(TimestampMixin, Base):
    __tablename__ = "ai_workflow_definitions"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    workflow_id: Mapped[str] = mapped_column(String(48), unique=True, index=True)
    owner_user_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(128), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    current_version: Mapped[int] = mapped_column(Integer, default=0)


class WorkflowVersion(TimestampMixin, Base):
    __tablename__ = "ai_workflow_versions"
    __table_args__ = (UniqueConstraint("workflow_definition_id", "version"),)

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    workflow_definition_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_workflow_definitions.id", ondelete="CASCADE"),
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer)
    definition_json: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    created_by: Mapped[str] = mapped_column(String(64), default="system", index=True)


class WorkflowSchedule(TimestampMixin, Base):
    """Durable schedule lease; a scheduler only creates an idempotent run."""

    __tablename__ = "ai_workflow_schedules"
    __table_args__ = (
        UniqueConstraint(
            "owner_user_id",
            "workflow_id",
            "name",
            name="uq_ai_workflow_schedules_owner_workflow_name",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    owner_user_id: Mapped[str] = mapped_column(String(64), index=True)
    workflow_id: Mapped[str] = mapped_column(String(48), index=True)
    name: Mapped[str] = mapped_column(String(128), default="")
    cron_expression: Mapped[str] = mapped_column(String(128), default="")
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    misfire_policy: Mapped[str] = mapped_column(String(24), default="skip")
    catch_up: Mapped[bool] = mapped_column(Boolean, default=False)
    concurrency_policy: Mapped[str] = mapped_column(String(24), default="forbid")
    next_fire_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    last_fire_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    lease_owner: Mapped[str] = mapped_column(String(128), default="", index=True)
    lease_token: Mapped[int] = mapped_column(Integer, default=0)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    idempotency_prefix: Mapped[str] = mapped_column(String(128), default="")
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class WorkflowTriggerInbox(TimestampMixin, Base):
    """Deduplicated external/manual trigger envelope."""

    __tablename__ = "ai_workflow_trigger_inbox"
    __table_args__ = (
        UniqueConstraint(
            "owner_user_id",
            "event_type",
            "event_key",
            name="uq_ai_workflow_trigger_inbox_owner_type_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    owner_user_id: Mapped[str] = mapped_column(String(64), index=True)
    workflow_id: Mapped[str] = mapped_column(String(48), index=True)
    event_type: Mapped[str] = mapped_column(String(96), index=True)
    event_key: Mapped[str] = mapped_column(String(128))
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    run_id: Mapped[str] = mapped_column(String(36), default="", index=True)
    received_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error_message: Mapped[str] = mapped_column(Text, default="")
    # Dispatch workers fence one another with the same lease contract used by
    # schedules and notifications.  The token is monotonic and survives a
    # lease recovery so a stale worker cannot finalize a reclaimed event.
    lease_owner: Mapped[str] = mapped_column(String(128), default="", index=True)
    lease_token: Mapped[int] = mapped_column(Integer, default=0)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)


class WorkflowNotificationOutbox(TimestampMixin, Base):
    """Durable notification intent; delivery is a separately controlled worker."""

    __tablename__ = "ai_workflow_notification_outbox"
    __table_args__ = (
        UniqueConstraint(
            "run_id",
            "node_id",
            "idempotency_key",
            name="uq_ai_workflow_notification_outbox_run_node_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    owner_user_id: Mapped[str] = mapped_column(String(64), index=True)
    run_id: Mapped[str] = mapped_column(String(36), index=True)
    node_id: Mapped[str] = mapped_column(String(48), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    channel: Mapped[str] = mapped_column(String(32), default="in_app")
    recipient: Mapped[str] = mapped_column(String(255), default="")
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    lease_owner: Mapped[str] = mapped_column(String(128), default="", index=True)
    lease_token: Mapped[int] = mapped_column(Integer, default=0)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[str] = mapped_column(Text, default="")
    # Delivery status and user-facing read state are intentionally separate:
    # a provider can deliver an item while the owner still has not seen it.
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    read_by_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)


class WorkflowWait(TimestampMixin, Base):
    """Durable pause boundary for a workflow waiting on a signal or time."""

    __tablename__ = "ai_workflow_waits"
    __table_args__ = (
        UniqueConstraint(
            "run_id",
            "node_id",
            "wait_key",
            name="uq_ai_workflow_waits_run_node_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    owner_user_id: Mapped[str] = mapped_column(String(64), index=True)
    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("ai_agent_runs.uuid", ondelete="CASCADE"), index=True
    )
    node_id: Mapped[str] = mapped_column(String(48), index=True)
    wait_key: Mapped[str] = mapped_column(String(128))
    signal_key: Mapped[str] = mapped_column(String(128), default="")
    status: Mapped[str] = mapped_column(String(24), default="waiting", index=True)
    resume_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    payload_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    resumed_by: Mapped[str] = mapped_column(String(64), default="")
    resumed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Only the hash is durable; the one-time token is returned once to the
    # caller that created the wait and is never exposed by list endpoints.
    resume_token_hash: Mapped[str] = mapped_column(String(64), default="")
    resume_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)



class LearningCandidate(TimestampMixin, Base):
    """Controlled learning candidate (never auto-publish to production)."""

    __tablename__ = "ai_learning_candidates"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    owner_user_id: Mapped[str] = mapped_column(String(64), index=True)
    source_run_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    candidate_type: Mapped[str] = mapped_column(String(48), default="correction", index=True)
    title: Mapped[str] = mapped_column(String(255), default="学习候选")
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    payload_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_by: Mapped[str] = mapped_column(String(64), default="")
    updated_by: Mapped[str] = mapped_column(String(64), default="")


class AgentProvider(TimestampMixin, Base):
    """7.0 external/internal agent provider registry."""

    __tablename__ = "ai_agent_providers"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    provider_key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128), default="")
    kind: Mapped[str] = mapped_column(String(32), default="external", index=True)
    # available | disabled | draft
    status: Mapped[str] = mapped_column(String(24), default="available", index=True)
    base_url: Mapped[str] = mapped_column(String(1024), default="")
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class AgentConnection(TimestampMixin, Base):
    """Installed agent connection (market install state)."""

    __tablename__ = "ai_agent_connections"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    agent_id: Mapped[str] = mapped_column(String(96), unique=True, index=True)
    provider_key: Mapped[str] = mapped_column(String(64), default="", index=True)
    name: Mapped[str] = mapped_column(String(128), default="")
    endpoint: Mapped[str] = mapped_column(String(1024), default="")
    # installed | authorized | disabled
    status: Mapped[str] = mapped_column(String(24), default="installed", index=True)
    capabilities_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    policy_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    budget_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    cost_per_call_micros: Mapped[int] = mapped_column(Integer, default=0)
    installed_by: Mapped[str] = mapped_column(String(64), default="")
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class AgentCallLog(TimestampMixin, Base):
    """Agent invoke audit + cost ledger (7.0 §11.11)."""

    __tablename__ = "ai_agent_call_logs"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    agent_id: Mapped[str] = mapped_column(String(96), index=True)
    run_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    channel: Mapped[str] = mapped_column(String(32), default="", index=True)
    destination: Mapped[str] = mapped_column(String(32), default="", index=True)
    data_level: Mapped[int] = mapped_column(Integer, default=0, index=True)
    status: Mapped[str] = mapped_column(String(24), default="succeeded", index=True)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    cost_micros: Mapped[int] = mapped_column(Integer, default=0)
    egress_allowed: Mapped[bool] = mapped_column(Boolean, default=True)
    request_summary: Mapped[str] = mapped_column(String(500), default="")
    result_summary: Mapped[str] = mapped_column(String(500), default="")
    detail_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class EgressAuditLog(TimestampMixin, Base):
    """Data egress decision audit trail."""

    __tablename__ = "ai_egress_audit_logs"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    destination: Mapped[str] = mapped_column(String(32), default="", index=True)
    channel: Mapped[str] = mapped_column(String(32), default="", index=True)
    agent_id: Mapped[str] = mapped_column(String(96), default="", index=True)
    run_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    data_level: Mapped[int] = mapped_column(Integer, default=0, index=True)
    allowed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    requires_confirmation: Mapped[bool] = mapped_column(Boolean, default=False)
    redaction_applied: Mapped[bool] = mapped_column(Boolean, default=False)
    policy: Mapped[str] = mapped_column(String(255), default="")
    findings_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    reasons_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    text_fingerprint: Mapped[str] = mapped_column(String(64), default="")


class ChannelJob(TimestampMixin, Base):
    """Persistent channel inbound job with retry / dead-letter support."""

    __tablename__ = "ai_channel_jobs"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    channel: Mapped[str] = mapped_column(String(32), default="web", index=True)
    job_key: Mapped[str] = mapped_column(String(128), default="", index=True)
    external_user_id: Mapped[str] = mapped_column(String(128), default="", index=True)
    thread_id: Mapped[str] = mapped_column(String(128), default="")
    # queued | running | succeeded | failed | dead
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    attempt: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    run_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    payload_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    result_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_error: Mapped[str] = mapped_column(Text, default="")
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ChannelIdentityBinding(TimestampMixin, Base):
    """Stable mapping between a channel identity and its run owner."""

    __tablename__ = "ai_channel_identity_bindings"
    __table_args__ = (UniqueConstraint("channel", "external_user_id"),)

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    channel: Mapped[str] = mapped_column(String(32), index=True)
    external_user_id: Mapped[str] = mapped_column(String(128), index=True)
    owner_user_id: Mapped[str] = mapped_column(String(64), index=True)
    last_thread_id: Mapped[str] = mapped_column(String(128), default="")


class ChannelMessageBinding(TimestampMixin, Base):
    """Inbound/outbound channel message linkage for an Agent Run."""

    __tablename__ = "ai_channel_message_bindings"
    __table_args__ = (UniqueConstraint("channel", "external_message_id", "direction"),)

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    identity_binding_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_channel_identity_bindings.id", ondelete="CASCADE"),
        index=True,
    )
    channel: Mapped[str] = mapped_column(String(32), index=True)
    external_message_id: Mapped[str] = mapped_column(String(128), index=True)
    direction: Mapped[str] = mapped_column(String(16), index=True)
    thread_id: Mapped[str] = mapped_column(String(128), default="")
    run_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    related_message_id: Mapped[str] = mapped_column(String(128), default="")
    metadata_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class SkillRunLog(TimestampMixin, Base):
    __tablename__ = "ai_skill_run_logs"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    skill_id: Mapped[str] = mapped_column(String(96), index=True)
    skill_version: Mapped[str] = mapped_column(String(32), default="")
    task_id: Mapped[str] = mapped_column(String(96), default="", index=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(24), default="running", index=True)
    tools_used_json: Mapped[list] = mapped_column(JSON, default=list)
    input_summary_json: Mapped[dict] = mapped_column(JSON, default=dict)
    output_summary_json: Mapped[dict] = mapped_column(JSON, default=dict)
    error_message: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class SkillReview(TimestampMixin, Base):
    __tablename__ = "ai_skill_reviews"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    skill_id: Mapped[str] = mapped_column(String(96), index=True)
    version: Mapped[str] = mapped_column(String(32), default="")
    submitter_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    reviewer_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    comment: Mapped[str] = mapped_column(Text, default="")
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class UploadedSkill(TimestampMixin, Base):
    """Metadata for a user-uploaded Skill package.

    The package itself lives outside the database.  ``storage_key`` is a
    generated directory name under ``Settings.skill_storage_dir`` so a
    database value can never select an arbitrary filesystem path.
    """

    __tablename__ = "ai_uploaded_skills"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    skill_id: Mapped[str] = mapped_column(String(96), unique=True, index=True)
    source_name: Mapped[str] = mapped_column(String(255), default="")
    storage_key: Mapped[str] = mapped_column(String(128), unique=True)
    name: Mapped[str] = mapped_column(String(128), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(96), default="")
    version: Mapped[str] = mapped_column(String(32), default="")
    scope: Mapped[str] = mapped_column(String(24), default="personal", index=True)
    owner: Mapped[str] = mapped_column(String(128), default="", index=True)
    uploaded_by: Mapped[str] = mapped_column(String(64), default="", index=True)
    status: Mapped[str] = mapped_column(String(24), default="pending_review", index=True)
    manifest_json: Mapped[dict] = mapped_column(JSON, default=dict)


class ChatSession(TimestampMixin, Base):
    __tablename__ = "ai_chat_sessions"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    sso_user_id: Mapped[str] = mapped_column(String(64), index=True)
    workspace_type: Mapped[str] = mapped_column(String(24), default="personal", index=True)
    project_uuid: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(255), default="新会话")
    mode: Mapped[str] = mapped_column(String(24), default="NORMAL", index=True)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    hard_deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ChatMessage(TimestampMixin, Base):
    __tablename__ = "ai_chat_messages"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    session_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_chat_sessions.id", ondelete="CASCADE"),
        index=True,
    )
    sso_user_id: Mapped[str] = mapped_column(String(64), index=True)
    role: Mapped[str] = mapped_column(String(16), index=True)
    content_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    content_nonce: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    key_version: Mapped[str] = mapped_column(String(32), default="")
    status: Mapped[str] = mapped_column(String(24), default="PENDING", index=True)
    model_display_name: Mapped[str] = mapped_column(String(128), default="")
    model_id: Mapped[str] = mapped_column(String(128), default="")
    usage_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    generated_files_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_token_hash: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    error_code: Mapped[str] = mapped_column(String(64), default="")
    error_message_safe: Mapped[str] = mapped_column(Text, default="")
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ChatMessageSource(TimestampMixin, Base):
    __tablename__ = "ai_chat_message_sources"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    message_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_chat_messages.id", ondelete="CASCADE"),
        index=True,
    )
    source_type: Mapped[str] = mapped_column(String(32), index=True)
    source_uuid: Mapped[str] = mapped_column(String(64), default="")
    title: Mapped[str] = mapped_column(String(255), default="")
    file_name: Mapped[str] = mapped_column(String(255), default="")
    # Web-search sources use their original URL as the identifier.  It can be
    # substantially longer than the 64-character vector-store chunk id.
    chunk_id: Mapped[str] = mapped_column(Text, default="")
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Web citations may use a canonical URL as their location label.  Those
    # URLs can exceed VARCHAR(255), particularly after search-engine redirects.
    section_title: Mapped[str] = mapped_column(Text, default="")
    chunk_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    score: Mapped[int] = mapped_column(Integer, default=0)


class UserModelProfile(TimestampMixin, Base):
    __tablename__ = "ai_user_model_profiles"
    __table_args__ = (UniqueConstraint("sso_user_id", "display_name"),)

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    sso_user_id: Mapped[str] = mapped_column(String(64), index=True)
    display_name: Mapped[str] = mapped_column(String(128))
    base_url: Mapped[str] = mapped_column(String(512))
    model_id: Mapped[str] = mapped_column(String(128))
    temperature: Mapped[float] = mapped_column(Float, default=0.3)
    max_output_tokens: Mapped[int] = mapped_column(Integer, default=8192)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=300)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    api_key_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    api_key_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[str] = mapped_column(String(32), default="")
    status: Mapped[str] = mapped_column(String(24), default="ACTIVE", index=True)


class ExportRecord(TimestampMixin, Base):
    __tablename__ = "export_records"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    conversation_id: Mapped[str] = mapped_column(String(64), index=True)
    message_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    file_name: Mapped[str] = mapped_column(String(255))
    file_path: Mapped[str] = mapped_column(String(1024))
    export_type: Mapped[str] = mapped_column(String(32), index=True)
    template_name: Mapped[str] = mapped_column(String(64), default="juxin_standard")
    created_by: Mapped[str] = mapped_column(String(64), index=True)


class WorkArtifact(TimestampMixin, Base):
    __tablename__ = "ai_work_artifacts"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    owner_user_id: Mapped[str] = mapped_column(String(64), index=True)
    conversation_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    message_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    task_state_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    export_record_uuid: Mapped[str] = mapped_column(String(64), default="", index=True)
    title: Mapped[str] = mapped_column(String(255))
    artifact_type: Mapped[str] = mapped_column(String(48), index=True)
    deliverable_type: Mapped[str] = mapped_column(String(48), default="", index=True)
    scope_type: Mapped[str] = mapped_column(String(16), default="personal", index=True)
    formality: Mapped[str] = mapped_column(String(16), default="working", index=True)
    project_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    project_task_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_project_tasks.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    lifecycle_status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    current_version_id: Mapped[int | None] = mapped_column(foreign_key_type, nullable=True)
    approval_flow_version_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        nullable=True,
    )
    approved_version_id: Mapped[int | None] = mapped_column(foreign_key_type, nullable=True)
    approved_content_hash: Mapped[str] = mapped_column(String(64), default="")
    delivered_version_id: Mapped[int | None] = mapped_column(foreign_key_type, nullable=True)
    row_version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[str] = mapped_column(String(64), default="", index=True)
    archived_by: Mapped[str] = mapped_column(String(64), default="")
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    record_status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    source_scope: Mapped[str] = mapped_column(String(64), default="")
    source_summary_json: Mapped[list] = mapped_column(JSON, default=list)
    content_summary: Mapped[str] = mapped_column(Text, default="")
    file_name: Mapped[str] = mapped_column(String(255), default="")
    file_path_or_blob_ref: Mapped[str] = mapped_column(String(1024), default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)


class WorkArtifactVersion(TimestampMixin, Base):
    __tablename__ = "ai_work_artifact_versions"
    __table_args__ = (
        UniqueConstraint(
            "artifact_id",
            "version",
            name="uq_ai_work_artifact_versions_artifact_version",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    artifact_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    parent_version_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifact_versions.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    skill_version_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_skill_versions.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    template_version_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_template_versions.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    content_format: Mapped[str] = mapped_column(String(32), default="structured_json")
    content_schema_version: Mapped[str] = mapped_column(String(32), default="1")
    content_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    content_nonce: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    key_version: Mapped[str] = mapped_column(String(32), default="")
    content_hash: Mapped[str] = mapped_column(String(64), default="")
    title_snapshot: Mapped[str] = mapped_column(String(255), default="")
    summary_snapshot: Mapped[str] = mapped_column(Text, default="")
    change_summary: Mapped[str] = mapped_column(Text, default="")
    project_scope_snapshot_json: Mapped[dict] = mapped_column(JSON, default=dict)
    input_summary_json: Mapped[dict] = mapped_column(JSON, default=dict)
    source_policy_snapshot_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by: Mapped[str] = mapped_column(String(64), default="", index=True)
    creation_reason: Mapped[str] = mapped_column(String(32), default="legacy")
    legacy_incomplete: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    source: Mapped[str] = mapped_column(String(64), default="")
    source_ref: Mapped[str] = mapped_column(String(128), default="")
    file_name: Mapped[str] = mapped_column(String(255), default="")
    file_path_or_blob_ref: Mapped[str] = mapped_column(String(1024), default="")
    source_summary_json: Mapped[list] = mapped_column(JSON, default=list)
    content_summary: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)


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


class UserMemory(TimestampMixin, Base):
    __tablename__ = "ai_user_memories"

    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)
        if getattr(self, "title", None) is None:
            self.title = ""
        if getattr(self, "priority", None) is None:
            self.priority = "medium"
        if getattr(self, "tags_json", None) is None:
            self.tags_json = []

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    sso_user_id: Mapped[str] = mapped_column(String(64), index=True)
    memory_type: Mapped[str] = mapped_column(String(32), default="preference", index=True)
    title: Mapped[str] = mapped_column(String(128), default="")
    content: Mapped[str] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(String(16), default="medium", index=True)
    tags_json: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    source: Mapped[str] = mapped_column(String(64), default="assistant")
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)


class ExperienceLibrary(TimestampMixin, Base):
    __tablename__ = "ai_experience_library"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    task_type: Mapped[str] = mapped_column(String(64), default="", index=True)
    title: Mapped[str] = mapped_column(String(128), default="")
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(Text)
    tags_json: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)


class TemplateLibrary(TimestampMixin, Base):
    __tablename__ = "ai_template_library"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    template_name: Mapped[str] = mapped_column(String(128))
    task_type: Mapped[str] = mapped_column(String(64), default="", index=True)
    template_content: Mapped[str] = mapped_column(Text)
    variables_json: Mapped[dict] = mapped_column(JSON, default=dict)
    scope: Mapped[str] = mapped_column(String(24), default="personal", index=True)
    review_status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)


class FailureCaseLibrary(TimestampMixin, Base):
    __tablename__ = "ai_failure_case_library"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    task_type: Mapped[str] = mapped_column(String(64), default="", index=True)
    wrong_answer: Mapped[str] = mapped_column(Text)
    correction: Mapped[str] = mapped_column(Text)
    prevention_rule: Mapped[str] = mapped_column(Text)
    tags_json: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)


class FeedbackLog(TimestampMixin, Base):
    __tablename__ = "ai_feedback_logs"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    conversation_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    message_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    feedback_type: Mapped[str] = mapped_column(String(32))
    comment: Mapped[str] = mapped_column(Text, default="")
    saved_as: Mapped[str] = mapped_column(String(32), default="")


class HotQuestionReportItem(TimestampMixin, Base):
    __tablename__ = "ai_hot_question_report_items"
    __table_args__ = (UniqueConstraint("period_type", "period_start", "period_end", "rank"),)

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    period_type: Mapped[str] = mapped_column(String(16), index=True)
    period_start: Mapped[datetime] = mapped_column(DateTime, index=True)
    period_end: Mapped[datetime] = mapped_column(DateTime, index=True)
    rank: Mapped[int] = mapped_column(Integer)
    question_count: Mapped[int] = mapped_column(Integer, default=0)
    question_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    question_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    samples_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    samples_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    reply_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    reply_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    analysis_summary: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    reviewed_by: Mapped[str] = mapped_column(String(64), default="")
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ExternalHotQuestionReportItem(TimestampMixin, Base):
    """Daily external customer hot-question report, separated from internal chat reports."""

    __tablename__ = "ai_external_hot_question_report_items"
    __table_args__ = (
        UniqueConstraint(
            "period_type", "period_start", "period_end", "source_channel", "rank"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    period_type: Mapped[str] = mapped_column(String(16), index=True)
    period_start: Mapped[datetime] = mapped_column(DateTime, index=True)
    period_end: Mapped[datetime] = mapped_column(DateTime, index=True)
    source_channel: Mapped[str] = mapped_column(String(32), index=True)
    rank: Mapped[int] = mapped_column(Integer)
    question_count: Mapped[int] = mapped_column(Integer, default=0)
    direct_answer_count: Mapped[int] = mapped_column(Integer, default=0)
    handoff_count: Mapped[int] = mapped_column(Integer, default=0)
    question_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    question_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    samples_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    samples_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    source_file_ids_json: Mapped[list] = mapped_column(JSON, default=list)
    analysis_summary: Mapped[str] = mapped_column(Text, default="")


# Import project workspace models into the shared metadata registry.
from . import project_workspace_models as project_workspace_models  # noqa: E402,F401
from . import project_initialization_models as project_initialization_models  # noqa: E402,F401
from . import project_context_models as project_context_models  # noqa: E402,F401
from . import project_task_models as project_task_models  # noqa: E402,F401
from .professional_delivery import models as professional_delivery_models  # noqa: E402,F401
from . import enterprise_intelligence_models as enterprise_intelligence_models  # noqa: E402,F401
from . import enterprise_business_lineage_models as enterprise_business_lineage_models  # noqa: E402,F401
from . import enterprise_metrics_models as enterprise_metrics_models  # noqa: E402,F401
from . import enterprise_graph_memory_models as enterprise_graph_memory_models  # noqa: E402,F401
from . import enterprise_insight_models as enterprise_insight_models  # noqa: E402,F401
from . import enterprise_capability_models as enterprise_capability_models  # noqa: E402,F401
