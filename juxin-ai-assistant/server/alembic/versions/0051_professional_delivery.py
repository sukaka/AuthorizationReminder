"""add professional delivery domain

Revision ID: 0051_professional_delivery
Revises: 0050_project_task_delivery_activity
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.schema import SchemaItem


revision = "0051_professional_delivery"
down_revision = "0050_project_task_delivery_activity"
branch_labels = None
depends_on = None


id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _column(
    name: str,
    type_: sa.types.TypeEngine,
    *constraints: SchemaItem,
    nullable: bool = False,
) -> sa.Column:
    return sa.Column(name, type_, *constraints, nullable=nullable)


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
    ]


def _create_table(
    name: str,
    columns: Sequence[sa.Column],
    *,
    indexes: Sequence[str] = (),
    unique_columns: Sequence[str] = ("uuid",),
    unique_indexes: Sequence[str] = (),
    uniques: Sequence[tuple[str, Sequence[str]]] = (),
) -> None:
    constraints = [sa.UniqueConstraint(column) for column in unique_columns]
    constraints.extend(
        sa.UniqueConstraint(*columns, name=constraint_name)
        for constraint_name, columns in uniques
    )
    op.create_table(
        name,
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        *columns,
        *_timestamps(),
        *constraints,
    )
    for column in indexes:
        op.create_index(f"ix_{name}_{column}", name, [column])
    for column in unique_indexes:
        op.create_index(f"ix_{name}_{column}", name, [column], unique=True)


def _create_professional_tables() -> None:
    _create_table(
        "ai_approval_flow_definitions",
        [
            _column("uuid", sa.String(36)),
            _column("flow_key", sa.String(96)),
            _column("name", sa.String(128)),
            _column("scope_policy", sa.String(24)),
            _column("deliverable_types_json", sa.JSON()),
            _column("status", sa.String(24)),
            _column("current_published_version_id", id_type, nullable=True),
            _column("created_by", sa.String(64)),
        ],
        indexes=("created_by", "scope_policy", "status"),
        unique_columns=("uuid", "flow_key"),
    )
    _create_table(
        "ai_catalog_mutation_records",
        [
            _column("uuid", sa.String(36)),
            _column("actor_user_id", sa.String(64)),
            _column("operation", sa.String(64)),
            _column("idempotency_key", sa.String(128)),
            _column("request_hash", sa.String(64)),
            _column("entity_type", sa.String(32)),
            _column("entity_uuid", sa.String(36)),
            _column("status", sa.String(24)),
        ],
        indexes=(
            "actor_user_id",
            "entity_type",
            "entity_uuid",
            "operation",
            "status",
        ),
        uniques=(
            (
                "uq_ai_catalog_mutation_actor_operation_key",
                ("actor_user_id", "operation", "idempotency_key"),
            ),
        ),
    )
    _create_table(
        "ai_quality_rule_definitions",
        [
            _column("uuid", sa.String(36)),
            _column("rule_key", sa.String(128)),
            _column("name", sa.String(128)),
            _column("category", sa.String(64)),
            _column("description", sa.Text()),
            _column("status", sa.String(24)),
            _column("current_published_version_id", id_type, nullable=True),
            _column("created_by", sa.String(64)),
        ],
        indexes=("category", "created_by", "status"),
        unique_columns=("uuid", "rule_key"),
    )
    _create_table(
        "ai_skill_definitions",
        [
            _column("uuid", sa.String(36)),
            _column("skill_key", sa.String(96)),
            _column("name", sa.String(128)),
            _column("category", sa.String(64)),
            _column("description", sa.Text()),
            _column("scope_policy", sa.String(24)),
            _column("status", sa.String(24)),
            _column("current_published_version_id", id_type, nullable=True),
            _column("owner_user_id", sa.String(64)),
            _column("owner_department_id", sa.String(64)),
            _column("created_by", sa.String(64)),
        ],
        indexes=(
            "category",
            "created_by",
            "owner_department_id",
            "owner_user_id",
            "scope_policy",
            "status",
        ),
        unique_columns=("uuid", "skill_key"),
    )
    _create_table(
        "ai_template_definitions",
        [
            _column("uuid", sa.String(36)),
            _column("template_key", sa.String(96)),
            _column("name", sa.String(128)),
            _column("purpose", sa.Text()),
            _column("deliverable_types_json", sa.JSON()),
            _column("scope_type", sa.String(24)),
            _column("status", sa.String(24)),
            _column("current_published_version_id", id_type, nullable=True),
            _column("owner_department_id", sa.String(64)),
            _column("owner_project_id", id_type, nullable=True),
            _column("created_by", sa.String(64)),
        ],
        indexes=("created_by", "owner_department_id", "scope_type", "status"),
        unique_columns=("uuid", "template_key"),
    )
    _create_table(
        "ai_approval_flow_versions",
        [
            _column("uuid", sa.String(36)),
            _column(
                "flow_id",
                id_type,
                sa.ForeignKey(
                    "ai_approval_flow_definitions.id",
                    ondelete="CASCADE",
                ),
            ),
            _column("version", sa.Integer()),
            _column("content_hash", sa.String(64)),
            _column("steps_json", sa.JSON()),
            _column("min_approvals", sa.Integer()),
            _column("allow_author_approve", sa.Boolean()),
            _column("reminder_config_json", sa.JSON()),
            _column("return_target", sa.String(64)),
            _column("status", sa.String(24)),
            _column("published_by", sa.String(64)),
            _column("published_at", sa.DateTime(), nullable=True),
            _column("created_by", sa.String(64)),
        ],
        indexes=("created_by", "flow_id", "published_by", "status"),
        uniques=(
            (
                "uq_ai_approval_flow_versions_flow_version",
                ("flow_id", "version"),
            ),
        ),
    )
    _create_table(
        "ai_quality_rule_versions",
        [
            _column("uuid", sa.String(36)),
            _column(
                "rule_id",
                id_type,
                sa.ForeignKey(
                    "ai_quality_rule_definitions.id",
                    ondelete="CASCADE",
                ),
            ),
            _column("version", sa.Integer()),
            _column("content_hash", sa.String(64)),
            _column("evaluator_type", sa.String(64)),
            _column("config_json", sa.JSON()),
            _column("severity", sa.String(16)),
            _column("blocking", sa.Boolean()),
            _column("status", sa.String(24)),
            _column("published_by", sa.String(64)),
            _column("published_at", sa.DateTime(), nullable=True),
            _column("created_by", sa.String(64)),
        ],
        indexes=(
            "created_by",
            "evaluator_type",
            "published_by",
            "rule_id",
            "severity",
            "status",
        ),
        uniques=(
            (
                "uq_ai_quality_rule_versions_rule_version",
                ("rule_id", "version"),
            ),
        ),
    )
    _create_table(
        "ai_template_versions",
        [
            _column("uuid", sa.String(36)),
            _column(
                "template_id",
                id_type,
                sa.ForeignKey("ai_template_definitions.id", ondelete="CASCADE"),
            ),
            _column("version", sa.Integer()),
            _column("content_hash", sa.String(64)),
            _column("input_schema_json", sa.JSON()),
            _column("structure_dsl_json", sa.JSON()),
            _column("dynamic_tables_json", sa.JSON()),
            _column("conditional_sections_json", sa.JSON()),
            _column("style_theme_json", sa.JSON()),
            _column("word_render_config_json", sa.JSON()),
            _column("compatible_skill_version_ids_json", sa.JSON()),
            _column("status", sa.String(24)),
            _column("published_by", sa.String(64)),
            _column("published_at", sa.DateTime(), nullable=True),
            _column("created_by", sa.String(64)),
        ],
        indexes=("created_by", "published_by", "status", "template_id"),
        uniques=(
            (
                "uq_ai_template_versions_template_version",
                ("template_id", "version"),
            ),
        ),
    )
    _create_table(
        "ai_professional_model_step_tokens",
        [
            _column("uuid", sa.String(36)),
            _column(
                "agent_run_uuid",
                sa.String(36),
                sa.ForeignKey("ai_agent_runs.uuid", ondelete="CASCADE"),
            ),
            _column(
                "step_uuid",
                sa.String(36),
                sa.ForeignKey("ai_agent_run_steps.uuid", ondelete="CASCADE"),
            ),
            _column("attempt", sa.Integer()),
            _column("token_hash", sa.String(64)),
            _column("request_hash", sa.String(64)),
            _column("expires_at", sa.DateTime()),
            _column("consumed_at", sa.DateTime(), nullable=True),
            _column("revoked_at", sa.DateTime(), nullable=True),
            _column("output_hash", sa.String(64)),
            _column("metadata_json", sa.JSON()),
        ],
        indexes=("agent_run_uuid", "expires_at", "step_uuid"),
        unique_columns=("uuid", "token_hash"),
        uniques=(
            (
                "uq_ai_professional_model_tokens_attempt",
                ("agent_run_uuid", "step_uuid", "attempt"),
            ),
        ),
    )
    _create_table(
        "ai_skill_versions",
        [
            _column("uuid", sa.String(36)),
            _column(
                "skill_id",
                id_type,
                sa.ForeignKey("ai_skill_definitions.id", ondelete="CASCADE"),
            ),
            _column("version", sa.Integer()),
            _column("content_hash", sa.String(64)),
            _column("input_schema_json", sa.JSON()),
            _column("output_schema_json", sa.JSON()),
            _column("plan_definition_json", sa.JSON()),
            _column("prompt_bundle_ciphertext", sa.LargeBinary(), nullable=True),
            _column("prompt_bundle_nonce", sa.LargeBinary(), nullable=True),
            _column("key_version", sa.String(32)),
            _column("allowed_resource_types_json", sa.JSON()),
            _column("allowed_tool_types_json", sa.JSON()),
            _column("fact_policy_json", sa.JSON()),
            _column("quality_policy_ids_json", sa.JSON()),
            _column(
                "default_template_version_id",
                id_type,
                sa.ForeignKey("ai_template_versions.id", ondelete="RESTRICT"),
                nullable=True,
            ),
            _column("review_checklist_json", sa.JSON()),
            _column("status", sa.String(24)),
            _column("published_by", sa.String(64)),
            _column("published_at", sa.DateTime(), nullable=True),
            _column("created_by", sa.String(64)),
        ],
        indexes=(
            "created_by",
            "default_template_version_id",
            "published_by",
            "skill_id",
            "status",
        ),
        uniques=(
            (
                "uq_ai_skill_versions_skill_version",
                ("skill_id", "version"),
            ),
        ),
    )
    _create_table(
        "ai_skill_selection_records",
        [
            _column("uuid", sa.String(36)),
            _column("actor_user_id", sa.String(64)),
            _column("scope_type", sa.String(24)),
            _column(
                "project_id",
                id_type,
                sa.ForeignKey("ai_projects.id", ondelete="RESTRICT"),
                nullable=True,
            ),
            _column("deliverable_type", sa.String(64)),
            _column("request_hash", sa.String(64)),
            _column("candidate_versions_json", sa.JSON()),
            _column(
                "selected_skill_version_id",
                id_type,
                sa.ForeignKey("ai_skill_versions.id", ondelete="RESTRICT"),
                nullable=True,
            ),
            _column("selection_source", sa.String(32)),
            _column("user_confirmed", sa.Boolean()),
            _column("idempotency_key", sa.String(128)),
            _column("selected_at", sa.DateTime()),
        ],
        indexes=(
            "actor_user_id",
            "deliverable_type",
            "project_id",
            "scope_type",
            "selected_skill_version_id",
        ),
        uniques=(
            (
                "uq_ai_skill_selection_actor_key",
                ("actor_user_id", "idempotency_key"),
            ),
        ),
    )
    _create_table(
        "ai_deliverable_approval_events",
        [
            _column("uuid", sa.String(36)),
            _column(
                "deliverable_id",
                id_type,
                sa.ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
            ),
            _column(
                "deliverable_version_id",
                id_type,
                sa.ForeignKey(
                    "ai_work_artifact_versions.id",
                    ondelete="RESTRICT",
                ),
            ),
            _column(
                "approval_flow_version_id",
                id_type,
                sa.ForeignKey("ai_approval_flow_versions.id", ondelete="RESTRICT"),
                nullable=True,
            ),
            _column("event_type", sa.String(32)),
            _column("content_hash", sa.String(64)),
            _column("actor_user_id", sa.String(64)),
            _column("reason_ciphertext", sa.LargeBinary(), nullable=True),
            _column("reason_nonce", sa.LargeBinary(), nullable=True),
            _column("key_version", sa.String(32)),
            _column("comment_uuids_json", sa.JSON()),
            _column("row_version_before", sa.Integer()),
            _column("row_version_after", sa.Integer()),
            _column("idempotency_key", sa.String(128)),
            _column("request_hash", sa.String(64)),
            _column("audit_request_id", sa.String(128)),
        ],
        indexes=(
            "actor_user_id",
            "approval_flow_version_id",
            "audit_request_id",
            "content_hash",
            "deliverable_id",
            "deliverable_version_id",
            "event_type",
        ),
        uniques=(
            (
                "uq_ai_approval_events_actor_type_key",
                ("actor_user_id", "event_type", "idempotency_key"),
            ),
        ),
    )
    _create_table(
        "ai_deliverable_comments",
        [
            _column("uuid", sa.String(36)),
            _column(
                "deliverable_id",
                id_type,
                sa.ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
            ),
            _column(
                "deliverable_version_id",
                id_type,
                sa.ForeignKey(
                    "ai_work_artifact_versions.id",
                    ondelete="RESTRICT",
                ),
            ),
            _column("block_id", sa.String(128)),
            _column("char_start", sa.Integer(), nullable=True),
            _column("char_end", sa.Integer(), nullable=True),
            _column("content_ciphertext", sa.LargeBinary()),
            _column("content_nonce", sa.LargeBinary()),
            _column("key_version", sa.String(32)),
            _column("status", sa.String(24)),
            _column("author_user_id", sa.String(64)),
            _column("resolved_by", sa.String(64)),
            _column("resolved_at", sa.DateTime(), nullable=True),
            _column("resolution_reason_ciphertext", sa.LargeBinary(), nullable=True),
            _column("resolution_reason_nonce", sa.LargeBinary(), nullable=True),
            _column("resolved_idempotency_key", sa.String(128)),
            _column("resolved_request_hash", sa.String(64)),
            _column("idempotency_key", sa.String(128)),
            _column("request_hash", sa.String(64)),
        ],
        indexes=(
            "author_user_id",
            "block_id",
            "deliverable_id",
            "deliverable_version_id",
            "resolved_by",
            "status",
        ),
        uniques=(
            (
                "uq_ai_deliverable_comments_actor_key",
                ("author_user_id", "idempotency_key"),
            ),
        ),
    )
    _create_table(
        "ai_deliverable_evidence",
        [
            _column("uuid", sa.String(36)),
            _column(
                "deliverable_id",
                id_type,
                sa.ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
            ),
            _column(
                "deliverable_version_id",
                id_type,
                sa.ForeignKey(
                    "ai_work_artifact_versions.id",
                    ondelete="RESTRICT",
                ),
            ),
            _column(
                "project_id",
                id_type,
                sa.ForeignKey("ai_projects.id", ondelete="RESTRICT"),
                nullable=True,
            ),
            _column("source_type", sa.String(32)),
            _column("source_uuid", sa.String(128)),
            _column("source_version", sa.String(64)),
            _column("source_content_hash", sa.String(64)),
            _column("file_name", sa.String(255)),
            _column("page_number", sa.Integer(), nullable=True),
            _column("sheet_name", sa.String(255)),
            _column("cell_range", sa.String(128)),
            _column("section_title", sa.String(255)),
            _column("paragraph_index", sa.Integer(), nullable=True),
            _column("chunk_id", sa.String(128)),
            _column("quote_ciphertext", sa.LargeBinary()),
            _column("quote_nonce", sa.LargeBinary()),
            _column("quote_hash", sa.String(64)),
            _column("key_version", sa.String(32)),
            _column("captured_by", sa.String(64)),
            _column("captured_at", sa.DateTime()),
            _column("permission_snapshot_hash", sa.String(64)),
            _column("status", sa.String(24)),
            _column("stale_reason", sa.Text()),
            _column("revoked_reason", sa.Text()),
            _column("row_version", sa.Integer()),
        ],
        indexes=(
            "captured_by",
            "chunk_id",
            "deliverable_id",
            "deliverable_version_id",
            "project_id",
            "quote_hash",
            "source_content_hash",
            "source_type",
            "source_uuid",
            "status",
        ),
        uniques=(
            (
                "uq_ai_deliverable_evidence_version_source_hash",
                (
                    "deliverable_version_id",
                    "source_type",
                    "source_uuid",
                    "source_content_hash",
                ),
            ),
        ),
    )
    _create_table(
        "ai_deliverable_exports",
        [
            _column("uuid", sa.String(36)),
            _column(
                "deliverable_id",
                id_type,
                sa.ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
            ),
            _column(
                "deliverable_version_id",
                id_type,
                sa.ForeignKey(
                    "ai_work_artifact_versions.id",
                    ondelete="RESTRICT",
                ),
            ),
            _column("content_hash", sa.String(64)),
            _column("export_format", sa.String(16)),
            _column("status", sa.String(24)),
            _column("watermarked", sa.Boolean()),
            _column("file_name", sa.String(255)),
            _column("file_path", sa.String(1024)),
            _column("file_hash", sa.String(64)),
            _column("file_size", sa.Integer()),
            _column("renderer_version", sa.String(64)),
            _column("created_by", sa.String(64)),
            _column("idempotency_key", sa.String(128)),
            _column("request_hash", sa.String(64)),
            _column("audit_request_id", sa.String(128)),
        ],
        indexes=(
            "audit_request_id",
            "content_hash",
            "created_by",
            "deliverable_id",
            "deliverable_version_id",
            "export_format",
            "status",
        ),
        uniques=(
            (
                "uq_ai_deliverable_exports_actor_key",
                ("created_by", "idempotency_key"),
            ),
        ),
    )
    _create_table(
        "ai_deliverable_facts",
        [
            _column("uuid", sa.String(36)),
            _column(
                "deliverable_id",
                id_type,
                sa.ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
            ),
            _column(
                "deliverable_version_id",
                id_type,
                sa.ForeignKey(
                    "ai_work_artifact_versions.id",
                    ondelete="RESTRICT",
                ),
            ),
            _column("deliverable_content_hash", sa.String(64)),
            _column("block_id", sa.String(128)),
            _column("char_start", sa.Integer(), nullable=True),
            _column("char_end", sa.Integer(), nullable=True),
            _column("claim_type", sa.String(24)),
            _column("claim_ciphertext", sa.LargeBinary()),
            _column("claim_nonce", sa.LargeBinary()),
            _column("claim_hash", sa.String(64)),
            _column("key_version", sa.String(32)),
            _column("critical", sa.Boolean()),
            _column("status", sa.String(32)),
            _column("source_required", sa.Boolean()),
            _column("human_confirmation_required", sa.Boolean()),
            _column("rationale_ciphertext", sa.LargeBinary(), nullable=True),
            _column("rationale_nonce", sa.LargeBinary(), nullable=True),
            _column("confirmed_by", sa.String(64)),
            _column("confirmed_at", sa.DateTime(), nullable=True),
            _column("extraction_batch_uuid", sa.String(36)),
            _column("created_by", sa.String(64)),
            _column("updated_by", sa.String(64)),
            _column("row_version", sa.Integer()),
        ],
        indexes=(
            "block_id",
            "claim_hash",
            "claim_type",
            "confirmed_by",
            "created_by",
            "critical",
            "deliverable_content_hash",
            "deliverable_id",
            "deliverable_version_id",
            "extraction_batch_uuid",
            "status",
            "updated_by",
        ),
        uniques=(
            (
                "uq_ai_deliverable_facts_version_block_claim",
                ("deliverable_version_id", "block_id", "claim_hash"),
            ),
        ),
    )
    _create_table(
        "ai_deliverable_idempotency_records",
        [
            _column("uuid", sa.String(36)),
            _column("actor_user_id", sa.String(64)),
            _column("operation", sa.String(64)),
            _column("idempotency_key", sa.String(128)),
            _column("request_hash", sa.String(64)),
            _column(
                "deliverable_id",
                id_type,
                sa.ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
            ),
            _column(
                "version_id",
                id_type,
                sa.ForeignKey(
                    "ai_work_artifact_versions.id",
                    ondelete="CASCADE",
                ),
            ),
            _column("status", sa.String(24)),
        ],
        indexes=(
            "actor_user_id",
            "deliverable_id",
            "operation",
            "status",
            "version_id",
        ),
        uniques=(
            (
                "uq_ai_deliverable_idempotency_actor_operation_key",
                ("actor_user_id", "operation", "idempotency_key"),
            ),
        ),
    )
    _create_table(
        "ai_deliverable_review_runs",
        [
            _column("uuid", sa.String(36)),
            _column(
                "deliverable_id",
                id_type,
                sa.ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
            ),
            _column(
                "deliverable_version_id",
                id_type,
                sa.ForeignKey(
                    "ai_work_artifact_versions.id",
                    ondelete="RESTRICT",
                ),
            ),
            _column("content_hash", sa.String(64)),
            _column(
                "skill_version_id",
                id_type,
                sa.ForeignKey("ai_skill_versions.id", ondelete="RESTRICT"),
            ),
            _column(
                "template_version_id",
                id_type,
                sa.ForeignKey("ai_template_versions.id", ondelete="RESTRICT"),
            ),
            _column("rule_version_ids_json", sa.JSON()),
            _column("execution_context_hash", sa.String(64)),
            _column("project_scope_hash", sa.String(64)),
            _column("status", sa.String(24)),
            _column("gates_passed", sa.Boolean()),
            _column("total_score", sa.Integer()),
            _column("steps_json", sa.JSON()),
            _column("result_summary_json", sa.JSON()),
            _column("model_identity_hash", sa.String(64)),
            _column("initiated_by", sa.String(64)),
            _column("completed_at", sa.DateTime(), nullable=True),
            _column("audit_request_id", sa.String(128)),
            _column("duration_ms", sa.Integer()),
            _column("idempotency_key", sa.String(128)),
            _column("request_hash", sa.String(64)),
        ],
        indexes=(
            "audit_request_id",
            "content_hash",
            "deliverable_id",
            "deliverable_version_id",
            "initiated_by",
            "skill_version_id",
            "status",
            "template_version_id",
        ),
        uniques=(
            (
                "uq_ai_review_runs_actor_idempotency_key",
                ("initiated_by", "idempotency_key"),
            ),
        ),
    )
    _create_table(
        "ai_professional_run_bindings",
        [
            _column("uuid", sa.String(36)),
            _column(
                "agent_run_uuid",
                sa.String(36),
                sa.ForeignKey("ai_agent_runs.uuid", ondelete="CASCADE"),
            ),
            _column(
                "deliverable_id",
                id_type,
                sa.ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
            ),
            _column(
                "source_version_id",
                id_type,
                sa.ForeignKey(
                    "ai_work_artifact_versions.id",
                    ondelete="RESTRICT",
                ),
            ),
            _column(
                "skill_version_id",
                id_type,
                sa.ForeignKey("ai_skill_versions.id", ondelete="RESTRICT"),
            ),
            _column(
                "template_version_id",
                id_type,
                sa.ForeignKey("ai_template_versions.id", ondelete="RESTRICT"),
            ),
            _column("owner_user_id", sa.String(64)),
            _column(
                "project_id",
                id_type,
                sa.ForeignKey("ai_projects.id", ondelete="RESTRICT"),
                nullable=True,
            ),
            _column("request_hash", sa.String(64)),
            _column("idempotency_key", sa.String(128)),
            _column("input_ciphertext", sa.LargeBinary()),
            _column("input_nonce", sa.LargeBinary()),
            _column("key_version", sa.String(32)),
            _column("execution_context_json", sa.JSON()),
            _column("context_hash", sa.String(64)),
            _column("resource_refs_json", sa.JSON()),
            _column("model_profile_uuid", sa.String(64)),
            _column("current_phase", sa.String(32)),
            _column("waiting_reason", sa.String(32)),
            _column("status", sa.String(32)),
            _column(
                "created_version_id",
                id_type,
                sa.ForeignKey(
                    "ai_work_artifact_versions.id",
                    ondelete="RESTRICT",
                ),
                nullable=True,
            ),
            _column("automatic_revision_count", sa.Integer()),
        ],
        indexes=(
            "context_hash",
            "created_version_id",
            "current_phase",
            "deliverable_id",
            "owner_user_id",
            "project_id",
            "skill_version_id",
            "source_version_id",
            "status",
            "template_version_id",
        ),
        unique_indexes=("agent_run_uuid",),
        uniques=(
            (
                "uq_ai_professional_run_bindings_owner_key",
                ("owner_user_id", "idempotency_key"),
            ),
        ),
    )
    _create_table(
        "ai_deliverable_comment_replies",
        [
            _column("uuid", sa.String(36)),
            _column(
                "comment_id",
                id_type,
                sa.ForeignKey("ai_deliverable_comments.id", ondelete="CASCADE"),
            ),
            _column("content_ciphertext", sa.LargeBinary()),
            _column("content_nonce", sa.LargeBinary()),
            _column("key_version", sa.String(32)),
            _column("author_user_id", sa.String(64)),
            _column("idempotency_key", sa.String(128)),
            _column("request_hash", sa.String(64)),
        ],
        indexes=("author_user_id", "comment_id"),
        uniques=(
            (
                "uq_ai_deliverable_comment_replies_actor_key",
                ("author_user_id", "idempotency_key"),
            ),
        ),
    )
    _create_table(
        "ai_deliverable_delivery_records",
        [
            _column("uuid", sa.String(36)),
            _column(
                "deliverable_id",
                id_type,
                sa.ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
            ),
            _column(
                "deliverable_version_id",
                id_type,
                sa.ForeignKey(
                    "ai_work_artifact_versions.id",
                    ondelete="RESTRICT",
                ),
            ),
            _column(
                "export_id",
                id_type,
                sa.ForeignKey("ai_deliverable_exports.id", ondelete="RESTRICT"),
            ),
            _column("content_hash", sa.String(64)),
            _column("delivered_by", sa.String(64)),
            _column("delivery_metadata_ciphertext", sa.LargeBinary()),
            _column("delivery_metadata_nonce", sa.LargeBinary()),
            _column("key_version", sa.String(32)),
            _column("delivered_at", sa.DateTime()),
            _column("idempotency_key", sa.String(128)),
            _column("request_hash", sa.String(64)),
            _column("audit_request_id", sa.String(128)),
        ],
        indexes=(
            "audit_request_id",
            "content_hash",
            "deliverable_id",
            "deliverable_version_id",
            "delivered_by",
            "export_id",
        ),
        uniques=(
            (
                "uq_ai_delivery_records_actor_key",
                ("delivered_by", "idempotency_key"),
            ),
        ),
    )
    _create_table(
        "ai_deliverable_experience_candidates",
        [
            _column("uuid", sa.String(36)),
            _column(
                "deliverable_id",
                id_type,
                sa.ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
            ),
            _column(
                "deliverable_version_id",
                id_type,
                sa.ForeignKey(
                    "ai_work_artifact_versions.id",
                    ondelete="RESTRICT",
                ),
            ),
            _column(
                "project_id",
                id_type,
                sa.ForeignKey("ai_projects.id", ondelete="RESTRICT"),
                nullable=True,
            ),
            _column("candidate_type", sa.String(24)),
            _column("content_hash", sa.String(64)),
            _column("payload_ciphertext", sa.LargeBinary()),
            _column("payload_nonce", sa.LargeBinary()),
            _column("key_version", sa.String(32)),
            _column("status", sa.String(24)),
            _column("submitted_by", sa.String(64)),
            _column("idempotency_key", sa.String(128)),
            _column("request_hash", sa.String(64)),
            _column("audit_request_id", sa.String(128)),
        ],
        indexes=(
            "audit_request_id",
            "candidate_type",
            "content_hash",
            "deliverable_id",
            "deliverable_version_id",
            "project_id",
            "status",
            "submitted_by",
        ),
        uniques=(
            (
                "uq_ai_experience_candidates_actor_key",
                ("submitted_by", "idempotency_key"),
            ),
        ),
    )
    _create_table(
        "ai_legacy_deliverable_mappings",
        [
            _column("uuid", sa.String(36)),
            _column("source_type", sa.String(32)),
            _column("source_uuid", sa.String(36)),
            _column(
                "source_project_id",
                id_type,
                sa.ForeignKey("ai_projects.id", ondelete="RESTRICT"),
                nullable=True,
            ),
            _column(
                "deliverable_id",
                id_type,
                sa.ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
            ),
            _column(
                "deliverable_version_id",
                id_type,
                sa.ForeignKey(
                    "ai_work_artifact_versions.id",
                    ondelete="RESTRICT",
                ),
                nullable=True,
            ),
            _column("status", sa.String(24)),
        ],
        indexes=(
            "deliverable_id",
            "deliverable_version_id",
            "source_project_id",
            "source_type",
            "source_uuid",
            "status",
        ),
        uniques=(
            (
                "uq_ai_legacy_deliverable_source",
                ("source_type", "source_uuid"),
            ),
        ),
    )
    _create_table(
        "ai_deliverable_review_issues",
        [
            _column("uuid", sa.String(36)),
            _column(
                "review_run_id",
                id_type,
                sa.ForeignKey("ai_deliverable_review_runs.id", ondelete="CASCADE"),
            ),
            _column(
                "rule_version_id",
                id_type,
                sa.ForeignKey("ai_quality_rule_versions.id", ondelete="RESTRICT"),
            ),
            _column("category", sa.String(64)),
            _column("severity", sa.String(16)),
            _column("blocking", sa.Boolean()),
            _column("block_id", sa.String(128)),
            _column("char_start", sa.Integer(), nullable=True),
            _column("char_end", sa.Integer(), nullable=True),
            _column("message", sa.Text()),
            _column("evidence_ids_json", sa.JSON()),
            _column("suggested_fix", sa.Text()),
            _column("status", sa.String(24)),
            _column("handled_by", sa.String(64)),
            _column("handling_reason", sa.Text()),
            _column("handled_at", sa.DateTime(), nullable=True),
        ],
        indexes=(
            "block_id",
            "category",
            "handled_by",
            "review_run_id",
            "rule_version_id",
            "severity",
            "status",
        ),
    )
    _create_table(
        "ai_fact_evidence_links",
        [
            _column("uuid", sa.String(36)),
            _column(
                "fact_id",
                id_type,
                sa.ForeignKey("ai_deliverable_facts.id", ondelete="CASCADE"),
            ),
            _column(
                "evidence_id",
                id_type,
                sa.ForeignKey("ai_deliverable_evidence.id", ondelete="CASCADE"),
            ),
            _column("relation", sa.String(24)),
            _column("derived_expression", sa.Text()),
            _column("input_fact_uuids_json", sa.JSON()),
            _column("rounding_rule", sa.String(128)),
            _column("status", sa.String(24)),
            _column("linked_by", sa.String(64)),
        ],
        indexes=("evidence_id", "fact_id", "linked_by", "relation", "status"),
        uniques=(
            (
                "uq_ai_fact_evidence_links_relation",
                ("fact_id", "evidence_id", "relation"),
            ),
        ),
    )


def _add_deliverable_columns() -> None:
    with op.batch_alter_table("ai_work_artifacts") as batch_op:
        batch_op.add_column(
            sa.Column(
                "deliverable_type",
                sa.String(48),
                nullable=False,
                server_default="",
            )
        )
        batch_op.add_column(
            sa.Column(
                "scope_type",
                sa.String(16),
                nullable=False,
                server_default="personal",
            )
        )
        batch_op.add_column(
            sa.Column(
                "formality",
                sa.String(16),
                nullable=False,
                server_default="working",
            )
        )
        batch_op.add_column(sa.Column("project_id", id_type, nullable=True))
        batch_op.add_column(sa.Column("project_task_id", id_type, nullable=True))
        batch_op.add_column(
            sa.Column(
                "lifecycle_status",
                sa.String(24),
                nullable=False,
                server_default="draft",
            )
        )
        batch_op.add_column(sa.Column("current_version_id", id_type, nullable=True))
        batch_op.add_column(
            sa.Column("approval_flow_version_id", id_type, nullable=True)
        )
        batch_op.add_column(sa.Column("approved_version_id", id_type, nullable=True))
        batch_op.add_column(
            sa.Column(
                "approved_content_hash",
                sa.String(64),
                nullable=False,
                server_default="",
            )
        )
        batch_op.add_column(sa.Column("delivered_version_id", id_type, nullable=True))
        batch_op.add_column(
            sa.Column(
                "row_version",
                sa.Integer(),
                nullable=False,
                server_default="1",
            )
        )
        batch_op.add_column(
            sa.Column(
                "created_by",
                sa.String(64),
                nullable=False,
                server_default="",
            )
        )
        batch_op.add_column(
            sa.Column(
                "archived_by",
                sa.String(64),
                nullable=False,
                server_default="",
            )
        )
        batch_op.add_column(sa.Column("archived_at", sa.DateTime(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "record_status",
                sa.String(24),
                nullable=False,
                server_default="active",
            )
        )

    op.execute(
        sa.text(
            "UPDATE ai_work_artifacts "
            "SET deliverable_type = artifact_type "
            "WHERE deliverable_type = ''"
        )
    )
    op.execute(
        sa.text(
            "UPDATE ai_work_artifacts "
            "SET created_by = owner_user_id "
            "WHERE created_by = ''"
        )
    )
    op.execute(
        sa.text(
            "UPDATE ai_work_artifacts "
            "SET current_version_id = ("
            "SELECT version_row.id FROM ai_work_artifact_versions AS version_row "
            "WHERE version_row.artifact_id = ai_work_artifacts.id "
            "ORDER BY version_row.version DESC, version_row.id DESC LIMIT 1"
            ")"
        )
    )

    with op.batch_alter_table("ai_work_artifacts") as batch_op:
        batch_op.alter_column(
            "deliverable_type",
            existing_type=sa.String(48),
            server_default=None,
        )
        batch_op.alter_column(
            "scope_type",
            existing_type=sa.String(16),
            server_default=None,
        )
        batch_op.alter_column(
            "formality",
            existing_type=sa.String(16),
            server_default=None,
        )
        batch_op.alter_column(
            "lifecycle_status",
            existing_type=sa.String(24),
            server_default=None,
        )
        batch_op.alter_column(
            "approved_content_hash",
            existing_type=sa.String(64),
            server_default=None,
        )
        batch_op.alter_column(
            "row_version",
            existing_type=sa.Integer(),
            server_default=None,
        )
        batch_op.alter_column(
            "created_by",
            existing_type=sa.String(64),
            server_default=None,
        )
        batch_op.alter_column(
            "archived_by",
            existing_type=sa.String(64),
            server_default=None,
        )
        batch_op.alter_column(
            "record_status",
            existing_type=sa.String(24),
            server_default=None,
        )
        batch_op.create_foreign_key(
            "fk_ai_work_artifacts_project",
            "ai_projects",
            ["project_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch_op.create_foreign_key(
            "fk_ai_work_artifacts_project_task",
            "ai_project_tasks",
            ["project_task_id"],
            ["id"],
            ondelete="SET NULL",
        )
        for column in (
            "deliverable_type",
            "scope_type",
            "formality",
            "project_id",
            "project_task_id",
            "lifecycle_status",
            "created_by",
            "record_status",
        ):
            batch_op.create_index(
                f"ix_ai_work_artifacts_{column}",
                [column],
            )


def _add_deliverable_version_columns() -> None:
    duplicate = op.get_bind().execute(
        sa.text(
            "SELECT artifact_id, version, COUNT(*) AS duplicate_count "
            "FROM ai_work_artifact_versions "
            "GROUP BY artifact_id, version HAVING COUNT(*) > 1 LIMIT 1"
        )
    ).first()
    if duplicate is not None:
        raise RuntimeError(
            "ai_work_artifact_versions 存在重复 artifact_id/version，"
            "请先修复历史数据后再升级 3.0"
        )

    with op.batch_alter_table("ai_work_artifact_versions") as batch_op:
        batch_op.add_column(sa.Column("parent_version_id", id_type, nullable=True))
        batch_op.add_column(sa.Column("skill_version_id", id_type, nullable=True))
        batch_op.add_column(sa.Column("template_version_id", id_type, nullable=True))
        batch_op.add_column(
            sa.Column(
                "content_format",
                sa.String(32),
                nullable=False,
                server_default="structured_json",
            )
        )
        batch_op.add_column(
            sa.Column(
                "content_schema_version",
                sa.String(32),
                nullable=False,
                server_default="1",
            )
        )
        batch_op.add_column(sa.Column("content_ciphertext", sa.LargeBinary(), nullable=True))
        batch_op.add_column(sa.Column("content_nonce", sa.LargeBinary(), nullable=True))
        batch_op.add_column(
            sa.Column("key_version", sa.String(32), nullable=False, server_default="")
        )
        batch_op.add_column(
            sa.Column("content_hash", sa.String(64), nullable=False, server_default="")
        )
        batch_op.add_column(
            sa.Column("title_snapshot", sa.String(255), nullable=False, server_default="")
        )
        batch_op.add_column(sa.Column("summary_snapshot", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("change_summary", sa.Text(), nullable=True))
        batch_op.add_column(
            sa.Column("project_scope_snapshot_json", sa.JSON(), nullable=True)
        )
        batch_op.add_column(sa.Column("input_summary_json", sa.JSON(), nullable=True))
        batch_op.add_column(
            sa.Column("source_policy_snapshot_json", sa.JSON(), nullable=True)
        )
        batch_op.add_column(
            sa.Column("created_by", sa.String(64), nullable=False, server_default="")
        )
        batch_op.add_column(
            sa.Column(
                "creation_reason",
                sa.String(32),
                nullable=False,
                server_default="legacy",
            )
        )
        batch_op.add_column(
            sa.Column(
                "legacy_incomplete",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            )
        )

    op.execute(
        sa.text(
            "UPDATE ai_work_artifact_versions "
            "SET title_snapshot = COALESCE(("
            "SELECT artifact.title FROM ai_work_artifacts AS artifact "
            "WHERE artifact.id = ai_work_artifact_versions.artifact_id"
            "), '')"
        )
    )
    op.execute(
        sa.text(
            "UPDATE ai_work_artifact_versions "
            "SET summary_snapshot = COALESCE(content_summary, '') "
            "WHERE summary_snapshot IS NULL"
        )
    )
    op.execute(
        sa.text(
            "UPDATE ai_work_artifact_versions "
            "SET change_summary = '' WHERE change_summary IS NULL"
        )
    )
    for column in (
        "project_scope_snapshot_json",
        "input_summary_json",
        "source_policy_snapshot_json",
    ):
        op.execute(
            sa.text(
                f"UPDATE ai_work_artifact_versions SET {column} = '{{}}' "
                f"WHERE {column} IS NULL"
            )
        )

    with op.batch_alter_table("ai_work_artifact_versions") as batch_op:
        for column in (
            "content_format",
            "content_schema_version",
            "key_version",
            "content_hash",
            "title_snapshot",
            "created_by",
            "creation_reason",
            "legacy_incomplete",
        ):
            existing_type: sa.types.TypeEngine
            if column == "legacy_incomplete":
                existing_type = sa.Boolean()
            elif column == "title_snapshot":
                existing_type = sa.String(255)
            elif column == "content_hash":
                existing_type = sa.String(64)
            else:
                existing_type = sa.String(32 if column != "created_by" else 64)
            batch_op.alter_column(
                column,
                existing_type=existing_type,
                server_default=None,
            )
        for column in (
            "summary_snapshot",
            "change_summary",
        ):
            batch_op.alter_column(
                column,
                existing_type=sa.Text(),
                nullable=False,
            )
        for column in (
            "project_scope_snapshot_json",
            "input_summary_json",
            "source_policy_snapshot_json",
        ):
            batch_op.alter_column(
                column,
                existing_type=sa.JSON(),
                nullable=False,
            )
        batch_op.create_foreign_key(
            "fk_ai_work_artifact_versions_parent_version",
            "ai_work_artifact_versions",
            ["parent_version_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch_op.create_foreign_key(
            "fk_ai_work_artifact_versions_skill_version",
            "ai_skill_versions",
            ["skill_version_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch_op.create_foreign_key(
            "fk_ai_work_artifact_versions_template_version",
            "ai_template_versions",
            ["template_version_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch_op.create_unique_constraint(
            "uq_ai_work_artifact_versions_artifact_version",
            ["artifact_id", "version"],
        )
        for column in (
            "parent_version_id",
            "skill_version_id",
            "template_version_id",
            "created_by",
            "legacy_incomplete",
        ):
            batch_op.create_index(
                f"ix_ai_work_artifact_versions_{column}",
                [column],
            )


def _drop_deliverable_version_columns() -> None:
    with op.batch_alter_table("ai_work_artifact_versions") as batch_op:
        batch_op.drop_constraint(
            "fk_ai_work_artifact_versions_template_version",
            type_="foreignkey",
        )
        batch_op.drop_constraint(
            "fk_ai_work_artifact_versions_skill_version",
            type_="foreignkey",
        )
        batch_op.drop_constraint(
            "fk_ai_work_artifact_versions_parent_version",
            type_="foreignkey",
        )
        for column in (
            "legacy_incomplete",
            "created_by",
            "template_version_id",
            "skill_version_id",
            "parent_version_id",
        ):
            batch_op.drop_index(f"ix_ai_work_artifact_versions_{column}")
        batch_op.drop_constraint(
            "uq_ai_work_artifact_versions_artifact_version",
            type_="unique",
        )
        for column in (
            "legacy_incomplete",
            "creation_reason",
            "created_by",
            "source_policy_snapshot_json",
            "input_summary_json",
            "project_scope_snapshot_json",
            "change_summary",
            "summary_snapshot",
            "title_snapshot",
            "content_hash",
            "key_version",
            "content_nonce",
            "content_ciphertext",
            "content_schema_version",
            "content_format",
            "template_version_id",
            "skill_version_id",
            "parent_version_id",
        ):
            batch_op.drop_column(column)


def _drop_deliverable_columns() -> None:
    with op.batch_alter_table("ai_work_artifacts") as batch_op:
        batch_op.drop_constraint(
            "fk_ai_work_artifacts_project_task",
            type_="foreignkey",
        )
        batch_op.drop_constraint(
            "fk_ai_work_artifacts_project",
            type_="foreignkey",
        )
        for column in (
            "record_status",
            "created_by",
            "lifecycle_status",
            "project_task_id",
            "project_id",
            "formality",
            "scope_type",
            "deliverable_type",
        ):
            batch_op.drop_index(f"ix_ai_work_artifacts_{column}")
        for column in (
            "record_status",
            "archived_at",
            "archived_by",
            "created_by",
            "row_version",
            "delivered_version_id",
            "approved_content_hash",
            "approved_version_id",
            "approval_flow_version_id",
            "current_version_id",
            "lifecycle_status",
            "project_task_id",
            "project_id",
            "formality",
            "scope_type",
            "deliverable_type",
        ):
            batch_op.drop_column(column)


PROFESSIONAL_TABLES = (
    "ai_approval_flow_definitions",
    "ai_catalog_mutation_records",
    "ai_quality_rule_definitions",
    "ai_skill_definitions",
    "ai_template_definitions",
    "ai_approval_flow_versions",
    "ai_quality_rule_versions",
    "ai_template_versions",
    "ai_professional_model_step_tokens",
    "ai_skill_versions",
    "ai_skill_selection_records",
    "ai_deliverable_approval_events",
    "ai_deliverable_comments",
    "ai_deliverable_evidence",
    "ai_deliverable_exports",
    "ai_deliverable_facts",
    "ai_deliverable_idempotency_records",
    "ai_deliverable_review_runs",
    "ai_professional_run_bindings",
    "ai_deliverable_comment_replies",
    "ai_deliverable_delivery_records",
    "ai_deliverable_experience_candidates",
    "ai_legacy_deliverable_mappings",
    "ai_deliverable_review_issues",
    "ai_fact_evidence_links",
)


def upgrade() -> None:
    _create_professional_tables()
    _add_deliverable_columns()
    _add_deliverable_version_columns()


def downgrade() -> None:
    _drop_deliverable_version_columns()
    _drop_deliverable_columns()
    for table_name in reversed(PROFESSIONAL_TABLES):
        op.drop_table(table_name)
