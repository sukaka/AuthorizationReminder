import uuid as uuid_lib
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from ..models import TimestampMixin, foreign_key_type, primary_key_type


class TemplateDefinition(TimestampMixin, Base):
    __tablename__ = "ai_template_definitions"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    template_key: Mapped[str] = mapped_column(String(96), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    purpose: Mapped[str] = mapped_column(Text, default="")
    deliverable_types_json: Mapped[list] = mapped_column(JSON, default=list)
    scope_type: Mapped[str] = mapped_column(String(24), default="system", index=True)
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    current_published_version_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        nullable=True,
    )
    owner_department_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    owner_project_id: Mapped[int | None] = mapped_column(foreign_key_type, nullable=True)
    created_by: Mapped[str] = mapped_column(String(64), default="system", index=True)


class TemplateVersion(TimestampMixin, Base):
    __tablename__ = "ai_template_versions"
    __table_args__ = (
        UniqueConstraint(
            "template_id",
            "version",
            name="uq_ai_template_versions_template_version",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    template_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_template_definitions.id", ondelete="CASCADE"),
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(String(64))
    input_schema_json: Mapped[dict] = mapped_column(JSON, default=dict)
    structure_dsl_json: Mapped[dict] = mapped_column(JSON, default=dict)
    dynamic_tables_json: Mapped[list] = mapped_column(JSON, default=list)
    conditional_sections_json: Mapped[list] = mapped_column(JSON, default=list)
    style_theme_json: Mapped[dict] = mapped_column(JSON, default=dict)
    word_render_config_json: Mapped[dict] = mapped_column(JSON, default=dict)
    compatible_skill_version_ids_json: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    published_by: Mapped[str] = mapped_column(String(64), default="", index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str] = mapped_column(String(64), default="system", index=True)


class SkillDefinition(TimestampMixin, Base):
    __tablename__ = "ai_skill_definitions"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    skill_key: Mapped[str] = mapped_column(String(96), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    category: Mapped[str] = mapped_column(String(64), default="", index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    scope_policy: Mapped[str] = mapped_column(String(24), default="both", index=True)
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    current_published_version_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        nullable=True,
    )
    owner_user_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    owner_department_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    created_by: Mapped[str] = mapped_column(String(64), default="system", index=True)


class SkillVersion(TimestampMixin, Base):
    __tablename__ = "ai_skill_versions"
    __table_args__ = (
        UniqueConstraint(
            "skill_id",
            "version",
            name="uq_ai_skill_versions_skill_version",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    skill_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_skill_definitions.id", ondelete="CASCADE"),
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(String(64))
    input_schema_json: Mapped[dict] = mapped_column(JSON, default=dict)
    output_schema_json: Mapped[dict] = mapped_column(JSON, default=dict)
    plan_definition_json: Mapped[dict] = mapped_column(JSON, default=dict)
    prompt_bundle_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    prompt_bundle_nonce: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    key_version: Mapped[str] = mapped_column(String(32), default="")
    allowed_resource_types_json: Mapped[list] = mapped_column(JSON, default=list)
    allowed_tool_types_json: Mapped[list] = mapped_column(JSON, default=list)
    fact_policy_json: Mapped[dict] = mapped_column(JSON, default=dict)
    quality_policy_ids_json: Mapped[list] = mapped_column(JSON, default=list)
    default_template_version_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_template_versions.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    review_checklist_json: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    published_by: Mapped[str] = mapped_column(String(64), default="", index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str] = mapped_column(String(64), default="system", index=True)


class SkillSelectionRecord(TimestampMixin, Base):
    __tablename__ = "ai_skill_selection_records"
    __table_args__ = (
        UniqueConstraint(
            "actor_user_id",
            "idempotency_key",
            name="uq_ai_skill_selection_actor_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    actor_user_id: Mapped[str] = mapped_column(String(64), index=True)
    scope_type: Mapped[str] = mapped_column(String(24), index=True)
    project_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    deliverable_type: Mapped[str] = mapped_column(String(64), index=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    candidate_versions_json: Mapped[list] = mapped_column(JSON, default=list)
    selected_skill_version_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_skill_versions.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    selection_source: Mapped[str] = mapped_column(String(32), default="")
    user_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    selected_at: Mapped[datetime] = mapped_column(DateTime)


class CatalogMutationRecord(TimestampMixin, Base):
    __tablename__ = "ai_catalog_mutation_records"
    __table_args__ = (
        UniqueConstraint(
            "actor_user_id",
            "operation",
            "idempotency_key",
            name="uq_ai_catalog_mutation_actor_operation_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    actor_user_id: Mapped[str] = mapped_column(String(64), index=True)
    operation: Mapped[str] = mapped_column(String(64), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64))
    entity_type: Mapped[str] = mapped_column(String(32), index=True)
    entity_uuid: Mapped[str] = mapped_column(String(36), index=True)
    status: Mapped[str] = mapped_column(String(24), default="completed", index=True)


class ProfessionalRunBinding(TimestampMixin, Base):
    __tablename__ = "ai_professional_run_bindings"
    __table_args__ = (
        UniqueConstraint(
            "owner_user_id",
            "idempotency_key",
            name="uq_ai_professional_run_bindings_owner_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    agent_run_uuid: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("ai_agent_runs.uuid", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    deliverable_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
        index=True,
    )
    source_version_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifact_versions.id", ondelete="RESTRICT"),
        index=True,
    )
    skill_version_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_skill_versions.id", ondelete="RESTRICT"),
        index=True,
    )
    template_version_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_template_versions.id", ondelete="RESTRICT"),
        index=True,
    )
    owner_user_id: Mapped[str] = mapped_column(String(64), index=True)
    project_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    request_hash: Mapped[str] = mapped_column(String(64))
    idempotency_key: Mapped[str] = mapped_column(String(128))
    input_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    input_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[str] = mapped_column(String(32))
    execution_context_json: Mapped[dict] = mapped_column(JSON, default=dict)
    context_hash: Mapped[str] = mapped_column(String(64), index=True)
    resource_refs_json: Mapped[list] = mapped_column(JSON, default=list)
    model_profile_uuid: Mapped[str] = mapped_column(String(64), default="")
    current_phase: Mapped[str] = mapped_column(String(32), default="select_skill", index=True)
    waiting_reason: Mapped[str] = mapped_column(String(32), default="")
    status: Mapped[str] = mapped_column(String(32), default="running", index=True)
    created_version_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifact_versions.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    automatic_revision_count: Mapped[int] = mapped_column(Integer, default=0)


class ProfessionalModelStepToken(TimestampMixin, Base):
    __tablename__ = "ai_professional_model_step_tokens"
    __table_args__ = (
        UniqueConstraint(
            "agent_run_uuid",
            "step_uuid",
            "attempt",
            name="uq_ai_professional_model_tokens_attempt",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    agent_run_uuid: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("ai_agent_runs.uuid", ondelete="CASCADE"),
        index=True,
    )
    step_uuid: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("ai_agent_run_steps.uuid", ondelete="CASCADE"),
        index=True,
    )
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    request_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    output_hash: Mapped[str] = mapped_column(String(64), default="")
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)


class DeliverableIdempotencyRecord(TimestampMixin, Base):
    __tablename__ = "ai_deliverable_idempotency_records"
    __table_args__ = (
        UniqueConstraint(
            "actor_user_id",
            "operation",
            "idempotency_key",
            name="uq_ai_deliverable_idempotency_actor_operation_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    actor_user_id: Mapped[str] = mapped_column(String(64), index=True)
    operation: Mapped[str] = mapped_column(String(64), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64))
    deliverable_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
        index=True,
    )
    version_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifact_versions.id", ondelete="CASCADE"),
        index=True,
    )
    status: Mapped[str] = mapped_column(String(24), default="completed", index=True)


class DeliverableDraft(TimestampMixin, Base):
    """Mutable editor state; immutable versions remain the audit boundary."""

    __tablename__ = "ai_deliverable_drafts"
    __table_args__ = (
        UniqueConstraint("deliverable_id", name="uq_ai_deliverable_drafts_deliverable"),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    deliverable_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
        index=True,
    )
    base_version_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifact_versions.id", ondelete="RESTRICT"),
        index=True,
    )
    revision: Mapped[int] = mapped_column(Integer, default=0)
    content_format: Mapped[str] = mapped_column(String(32), default="structured_json")
    content_schema_version: Mapped[str] = mapped_column(String(32), default="2")
    content_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    content_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[str] = mapped_column(String(32), default="")
    content_hash: Mapped[str] = mapped_column(String(64), default="")
    content_summary: Mapped[str] = mapped_column(Text, default="")
    updated_by: Mapped[str] = mapped_column(String(64), default="", index=True)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)


class DeliverableMediaAsset(TimestampMixin, Base):
    """Encrypted, deliverable-scoped media bytes used by the structured editor."""

    __tablename__ = "ai_deliverable_media_assets"
    __table_args__ = (
        UniqueConstraint(
            "deliverable_id",
            "owner_user_id",
            "idempotency_key",
            name="uq_ai_deliverable_media_assets_idempotency",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    deliverable_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
        index=True,
    )
    owner_user_id: Mapped[str] = mapped_column(String(64), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    original_file_name: Mapped[str] = mapped_column(String(255), default="")
    media_type: Mapped[str] = mapped_column(String(64), index=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    content_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    content_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[str] = mapped_column(String(32), default="")
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)


class DeliverableEditLease(TimestampMixin, Base):
    """Short-lived fencing lease for a single editable deliverable."""

    __tablename__ = "ai_deliverable_edit_leases"
    __table_args__ = (
        UniqueConstraint("deliverable_id", name="uq_ai_deliverable_edit_leases_deliverable"),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36), unique=True, default=lambda: str(uuid_lib.uuid4())
    )
    deliverable_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
        index=True,
    )
    owner_user_id: Mapped[str] = mapped_column(String(64), index=True)
    fencing_token: Mapped[int] = mapped_column(Integer, default=1)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)


class DeliverableFact(TimestampMixin, Base):
    __tablename__ = "ai_deliverable_facts"
    __table_args__ = (
        UniqueConstraint(
            "deliverable_version_id",
            "block_id",
            "claim_hash",
            name="uq_ai_deliverable_facts_version_block_claim",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    deliverable_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
        index=True,
    )
    deliverable_version_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifact_versions.id", ondelete="RESTRICT"),
        index=True,
    )
    deliverable_content_hash: Mapped[str] = mapped_column(String(64), index=True)
    block_id: Mapped[str] = mapped_column(String(128), index=True)
    char_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    char_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    claim_type: Mapped[str] = mapped_column(String(24), default="fact", index=True)
    claim_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    claim_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    claim_hash: Mapped[str] = mapped_column(String(64), index=True)
    key_version: Mapped[str] = mapped_column(String(32))
    critical: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    status: Mapped[str] = mapped_column(
        String(32),
        default="pending_confirmation",
        index=True,
    )
    source_required: Mapped[bool] = mapped_column(Boolean, default=False)
    human_confirmation_required: Mapped[bool] = mapped_column(Boolean, default=False)
    rationale_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    rationale_nonce: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    confirmed_by: Mapped[str] = mapped_column(String(64), default="", index=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    extraction_batch_uuid: Mapped[str] = mapped_column(String(36), index=True)
    created_by: Mapped[str] = mapped_column(String(64), index=True)
    updated_by: Mapped[str] = mapped_column(String(64), default="", index=True)
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class DeliverableEvidence(TimestampMixin, Base):
    __tablename__ = "ai_deliverable_evidence"
    __table_args__ = (
        UniqueConstraint(
            "deliverable_version_id",
            "source_type",
            "source_uuid",
            "source_content_hash",
            name="uq_ai_deliverable_evidence_version_source_hash",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    deliverable_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
        index=True,
    )
    deliverable_version_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifact_versions.id", ondelete="RESTRICT"),
        index=True,
    )
    project_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    source_type: Mapped[str] = mapped_column(String(32), index=True)
    source_uuid: Mapped[str] = mapped_column(String(128), index=True)
    source_version: Mapped[str] = mapped_column(String(64), default="")
    source_content_hash: Mapped[str] = mapped_column(String(64), index=True)
    file_name: Mapped[str] = mapped_column(String(255), default="")
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sheet_name: Mapped[str] = mapped_column(String(255), default="")
    cell_range: Mapped[str] = mapped_column(String(128), default="")
    section_title: Mapped[str] = mapped_column(String(255), default="")
    paragraph_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    chunk_id: Mapped[str] = mapped_column(String(128), default="", index=True)
    quote_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    quote_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    quote_hash: Mapped[str] = mapped_column(String(64), index=True)
    key_version: Mapped[str] = mapped_column(String(32))
    captured_by: Mapped[str] = mapped_column(String(64), index=True)
    captured_at: Mapped[datetime] = mapped_column(DateTime)
    permission_snapshot_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    stale_reason: Mapped[str] = mapped_column(Text, default="")
    revoked_reason: Mapped[str] = mapped_column(Text, default="")
    row_version: Mapped[int] = mapped_column(Integer, default=1)


class FactEvidenceLink(TimestampMixin, Base):
    __tablename__ = "ai_fact_evidence_links"
    __table_args__ = (
        UniqueConstraint(
            "fact_id",
            "evidence_id",
            "relation",
            name="uq_ai_fact_evidence_links_relation",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    fact_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_deliverable_facts.id", ondelete="CASCADE"),
        index=True,
    )
    evidence_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_deliverable_evidence.id", ondelete="CASCADE"),
        index=True,
    )
    relation: Mapped[str] = mapped_column(String(24), index=True)
    derived_expression: Mapped[str] = mapped_column(Text, default="")
    input_fact_uuids_json: Mapped[list] = mapped_column(JSON, default=list)
    rounding_rule: Mapped[str] = mapped_column(String(128), default="")
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    linked_by: Mapped[str] = mapped_column(String(64), index=True)


class QualityRuleDefinition(TimestampMixin, Base):
    __tablename__ = "ai_quality_rule_definitions"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    rule_key: Mapped[str] = mapped_column(String(128), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    category: Mapped[str] = mapped_column(String(64), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    current_published_version_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        nullable=True,
    )
    created_by: Mapped[str] = mapped_column(String(64), default="system", index=True)


class QualityRuleVersion(TimestampMixin, Base):
    __tablename__ = "ai_quality_rule_versions"
    __table_args__ = (
        UniqueConstraint(
            "rule_id",
            "version",
            name="uq_ai_quality_rule_versions_rule_version",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    rule_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_quality_rule_definitions.id", ondelete="CASCADE"),
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(String(64))
    evaluator_type: Mapped[str] = mapped_column(String(64), index=True)
    config_json: Mapped[dict] = mapped_column(JSON, default=dict)
    severity: Mapped[str] = mapped_column(String(16), default="error", index=True)
    blocking: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    published_by: Mapped[str] = mapped_column(String(64), default="", index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str] = mapped_column(String(64), default="system", index=True)


class ReviewRun(TimestampMixin, Base):
    __tablename__ = "ai_deliverable_review_runs"
    __table_args__ = (
        UniqueConstraint(
            "initiated_by",
            "idempotency_key",
            name="uq_ai_review_runs_actor_idempotency_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    deliverable_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
        index=True,
    )
    deliverable_version_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifact_versions.id", ondelete="RESTRICT"),
        index=True,
    )
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    skill_version_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_skill_versions.id", ondelete="RESTRICT"),
        index=True,
    )
    template_version_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_template_versions.id", ondelete="RESTRICT"),
        index=True,
    )
    rule_version_ids_json: Mapped[list] = mapped_column(JSON, default=list)
    execution_context_hash: Mapped[str] = mapped_column(String(64), default="")
    project_scope_hash: Mapped[str] = mapped_column(String(64), default="")
    status: Mapped[str] = mapped_column(String(24), index=True)
    gates_passed: Mapped[bool] = mapped_column(Boolean, default=False)
    total_score: Mapped[int] = mapped_column(Integer, default=0)
    steps_json: Mapped[list] = mapped_column(JSON, default=list)
    result_summary_json: Mapped[dict] = mapped_column(JSON, default=dict)
    model_identity_hash: Mapped[str] = mapped_column(String(64), default="")
    initiated_by: Mapped[str] = mapped_column(String(64), index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    audit_request_id: Mapped[str] = mapped_column(String(128), default="", index=True)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64))


class ReviewIssue(TimestampMixin, Base):
    __tablename__ = "ai_deliverable_review_issues"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    review_run_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_deliverable_review_runs.id", ondelete="CASCADE"),
        index=True,
    )
    rule_version_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_quality_rule_versions.id", ondelete="RESTRICT"),
        index=True,
    )
    category: Mapped[str] = mapped_column(String(64), index=True)
    severity: Mapped[str] = mapped_column(String(16), index=True)
    blocking: Mapped[bool] = mapped_column(Boolean, default=True)
    block_id: Mapped[str] = mapped_column(String(128), default="", index=True)
    char_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    char_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    message: Mapped[str] = mapped_column(Text)
    evidence_ids_json: Mapped[list] = mapped_column(JSON, default=list)
    suggested_fix: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="open", index=True)
    handled_by: Mapped[str] = mapped_column(String(64), default="", index=True)
    handling_reason: Mapped[str] = mapped_column(Text, default="")
    handled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ApprovalFlowDefinition(TimestampMixin, Base):
    __tablename__ = "ai_approval_flow_definitions"

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    flow_key: Mapped[str] = mapped_column(String(96), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    scope_policy: Mapped[str] = mapped_column(String(24), default="both", index=True)
    deliverable_types_json: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    current_published_version_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        nullable=True,
    )
    created_by: Mapped[str] = mapped_column(String(64), default="system", index=True)


class ApprovalFlowVersion(TimestampMixin, Base):
    __tablename__ = "ai_approval_flow_versions"
    __table_args__ = (
        UniqueConstraint(
            "flow_id",
            "version",
            name="uq_ai_approval_flow_versions_flow_version",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    flow_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_approval_flow_definitions.id", ondelete="CASCADE"),
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(String(64))
    steps_json: Mapped[list] = mapped_column(JSON, default=list)
    min_approvals: Mapped[int] = mapped_column(Integer, default=1)
    allow_author_approve: Mapped[bool] = mapped_column(Boolean, default=False)
    reminder_config_json: Mapped[dict] = mapped_column(JSON, default=dict)
    return_target: Mapped[str] = mapped_column(String(64), default="author")
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    published_by: Mapped[str] = mapped_column(String(64), default="", index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str] = mapped_column(String(64), default="system", index=True)


class ApprovalEvent(TimestampMixin, Base):
    __tablename__ = "ai_deliverable_approval_events"
    __table_args__ = (
        UniqueConstraint(
            "actor_user_id",
            "event_type",
            "idempotency_key",
            name="uq_ai_approval_events_actor_type_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    deliverable_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
        index=True,
    )
    deliverable_version_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifact_versions.id", ondelete="RESTRICT"),
        index=True,
    )
    approval_flow_version_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_approval_flow_versions.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(32), index=True)
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    actor_user_id: Mapped[str] = mapped_column(String(64), index=True)
    reason_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    reason_nonce: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    key_version: Mapped[str] = mapped_column(String(32), default="")
    comment_uuids_json: Mapped[list] = mapped_column(JSON, default=list)
    row_version_before: Mapped[int] = mapped_column(Integer)
    row_version_after: Mapped[int] = mapped_column(Integer)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64))
    audit_request_id: Mapped[str] = mapped_column(String(128), default="", index=True)


class DeliverableComment(TimestampMixin, Base):
    __tablename__ = "ai_deliverable_comments"
    __table_args__ = (
        UniqueConstraint(
            "author_user_id",
            "idempotency_key",
            name="uq_ai_deliverable_comments_actor_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    deliverable_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
        index=True,
    )
    deliverable_version_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifact_versions.id", ondelete="RESTRICT"),
        index=True,
    )
    block_id: Mapped[str] = mapped_column(String(128), index=True)
    char_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    char_end: Mapped[int | None] = mapped_column(Integer, nullable=True)
    content_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    content_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(24), default="open", index=True)
    author_user_id: Mapped[str] = mapped_column(String(64), index=True)
    resolved_by: Mapped[str] = mapped_column(String(64), default="", index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    resolution_reason_ciphertext: Mapped[bytes | None] = mapped_column(
        LargeBinary,
        nullable=True,
    )
    resolution_reason_nonce: Mapped[bytes | None] = mapped_column(
        LargeBinary,
        nullable=True,
    )
    resolved_idempotency_key: Mapped[str] = mapped_column(String(128), default="")
    resolved_request_hash: Mapped[str] = mapped_column(String(64), default="")
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64))


class DeliverableCommentReply(TimestampMixin, Base):
    __tablename__ = "ai_deliverable_comment_replies"
    __table_args__ = (
        UniqueConstraint(
            "author_user_id",
            "idempotency_key",
            name="uq_ai_deliverable_comment_replies_actor_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    comment_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_deliverable_comments.id", ondelete="CASCADE"),
        index=True,
    )
    content_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    content_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[str] = mapped_column(String(32))
    author_user_id: Mapped[str] = mapped_column(String(64), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64))


class DeliverableExport(TimestampMixin, Base):
    __tablename__ = "ai_deliverable_exports"
    __table_args__ = (
        UniqueConstraint(
            "created_by",
            "idempotency_key",
            name="uq_ai_deliverable_exports_actor_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    deliverable_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
        index=True,
    )
    deliverable_version_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifact_versions.id", ondelete="RESTRICT"),
        index=True,
    )
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    export_format: Mapped[str] = mapped_column(String(16), default="docx", index=True)
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    watermarked: Mapped[bool] = mapped_column(Boolean, default=True)
    file_name: Mapped[str] = mapped_column(String(255), default="")
    file_path: Mapped[str] = mapped_column(String(1024), default="")
    file_hash: Mapped[str] = mapped_column(String(64), default="")
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    renderer_version: Mapped[str] = mapped_column(
        String(64),
        default="professional-docx-v1",
    )
    created_by: Mapped[str] = mapped_column(String(64), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), default="")
    request_hash: Mapped[str] = mapped_column(String(64), default="")
    audit_request_id: Mapped[str] = mapped_column(String(128), default="", index=True)


class DeliveryRecord(TimestampMixin, Base):
    __tablename__ = "ai_deliverable_delivery_records"
    __table_args__ = (
        UniqueConstraint(
            "delivered_by",
            "idempotency_key",
            name="uq_ai_delivery_records_actor_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    deliverable_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
        index=True,
    )
    deliverable_version_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifact_versions.id", ondelete="RESTRICT"),
        index=True,
    )
    export_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_deliverable_exports.id", ondelete="RESTRICT"),
        index=True,
    )
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    delivered_by: Mapped[str] = mapped_column(String(64), index=True)
    delivery_metadata_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    delivery_metadata_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[str] = mapped_column(String(32))
    delivered_at: Mapped[datetime] = mapped_column(DateTime)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64))
    audit_request_id: Mapped[str] = mapped_column(String(128), default="", index=True)


class DeliverableExperienceCandidate(TimestampMixin, Base):
    __tablename__ = "ai_deliverable_experience_candidates"
    __table_args__ = (
        UniqueConstraint(
            "submitted_by",
            "idempotency_key",
            name="uq_ai_experience_candidates_actor_key",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    deliverable_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
        index=True,
    )
    deliverable_version_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifact_versions.id", ondelete="RESTRICT"),
        index=True,
    )
    project_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    candidate_type: Mapped[str] = mapped_column(String(24), index=True)
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    payload_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    payload_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(24), default="pending_review", index=True)
    submitted_by: Mapped[str] = mapped_column(String(64), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    request_hash: Mapped[str] = mapped_column(String(64))
    audit_request_id: Mapped[str] = mapped_column(String(128), default="", index=True)


class LegacyDeliverableMapping(TimestampMixin, Base):
    __tablename__ = "ai_legacy_deliverable_mappings"
    __table_args__ = (
        UniqueConstraint(
            "source_type",
            "source_uuid",
            name="uq_ai_legacy_deliverable_source",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key_type, primary_key=True, autoincrement=True)
    uuid: Mapped[str] = mapped_column(
        String(36),
        unique=True,
        default=lambda: str(uuid_lib.uuid4()),
    )
    source_type: Mapped[str] = mapped_column(String(32), index=True)
    source_uuid: Mapped[str] = mapped_column(String(36), index=True)
    source_project_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_projects.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    deliverable_id: Mapped[int] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
        index=True,
    )
    deliverable_version_id: Mapped[int | None] = mapped_column(
        foreign_key_type,
        ForeignKey("ai_work_artifact_versions.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(24), default="completed", index=True)
