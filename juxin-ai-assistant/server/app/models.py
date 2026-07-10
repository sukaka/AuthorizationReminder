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
    key_version: Mapped[str] = mapped_column(String(32))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    hard_deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    usage_count: Mapped[int] = mapped_column(Integer, default=0)


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
    request_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    request_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    draft_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, default=b"")
    draft_nonce: Mapped[bytes] = mapped_column(LargeBinary, default=b"")
    key_version: Mapped[str] = mapped_column(String(32), default="v1")
    checkpoint_json: Mapped[dict] = mapped_column(JSON, default=dict)
    result_json: Mapped[dict] = mapped_column(JSON, default=dict)
    error_code: Mapped[str] = mapped_column(String(64), default="", index=True)
    error_message_safe: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


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


class ChatSession(TimestampMixin, Base):
    __tablename__ = "ai_chat_sessions"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    sso_user_id: Mapped[str] = mapped_column(String(64), index=True)
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
    chunk_id: Mapped[str] = mapped_column(String(64), default="")
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    section_title: Mapped[str] = mapped_column(String(255), default="")
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
    source_scope: Mapped[str] = mapped_column(String(64), default="")
    source_summary_json: Mapped[list] = mapped_column(JSON, default=list)
    content_summary: Mapped[str] = mapped_column(Text, default="")
    file_name: Mapped[str] = mapped_column(String(255), default="")
    file_path_or_blob_ref: Mapped[str] = mapped_column(String(1024), default="")
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)


class WorkArtifactVersion(TimestampMixin, Base):
    __tablename__ = "ai_work_artifact_versions"

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
