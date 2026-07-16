"""add immutable enterprise metric and health snapshots

Revision ID: 0059_enterprise_metrics_health
Revises: 0058_enterprise_business_lineage

The snapshot tables are append-only records.  Their natural keys include the
scope, definition/rule version and cutoff, so recalculating the same cutoff is
idempotent and never overwrites an earlier result.
"""

from alembic import op
import sqlalchemy as sa


revision = "0059_enterprise_metrics_health"
down_revision = "0058_enterprise_business_lineage"
branch_labels = None
depends_on = None


id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    ]


def upgrade() -> None:
    op.create_table(
        "ai_enterprise_metric_definitions",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("metric_code", sa.String(96), nullable=False),
        sa.Column("definition_version", sa.String(32), nullable=False),
        sa.Column("owner", sa.String(64), nullable=False, server_default="enterprise-intelligence"),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("formula", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(24), nullable=False, server_default="published"),
        sa.Column("effective_from", sa.DateTime(), nullable=True),
        sa.Column("retired_at", sa.DateTime(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        *_timestamps(),
        sa.UniqueConstraint(
            "metric_code",
            "definition_version",
            name="uq_ai_enterprise_metric_definitions_code_version",
        ),
    )
    for index_name, columns in (
        ("ix_ai_enterprise_metric_definitions_metric_code", ["metric_code"]),
        ("ix_ai_enterprise_metric_definitions_status", ["status"]),
    ):
        op.create_index(index_name, "ai_enterprise_metric_definitions", columns)

    op.create_table(
        "ai_enterprise_metric_snapshots",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column(
            "organization_id",
            id_type,
            sa.ForeignKey("ai_organizations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("scope_fingerprint", sa.String(64), nullable=False),
        sa.Column("policy_version", sa.String(64), nullable=False, server_default=""),
        sa.Column("scope_type", sa.String(48), nullable=False, server_default="project_membership"),
        sa.Column("scope_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("metric_code", sa.String(96), nullable=False),
        sa.Column("definition_version", sa.String(32), nullable=False),
        sa.Column("period_start", sa.DateTime(), nullable=False),
        sa.Column("period_end", sa.DateTime(), nullable=False),
        sa.Column("data_cutoff_at", sa.DateTime(), nullable=False),
        sa.Column("data_version", sa.String(128), nullable=False),
        sa.Column("numerator", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("denominator", sa.Integer(), nullable=True),
        sa.Column("value", sa.Float(), nullable=True),
        sa.Column("freshness", sa.String(24), nullable=False, server_default="fresh"),
        sa.Column("data_completeness", sa.Float(), nullable=False, server_default="0"),
        sa.Column("suppressed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("exclusions_json", sa.JSON(), nullable=False),
        sa.Column("evidence_refs_json", sa.JSON(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("source_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "scope_fingerprint",
            "metric_code",
            "definition_version",
            "period_start",
            "period_end",
            "data_cutoff_at",
            "data_version",
            name="uq_ai_enterprise_metric_snapshots_immutable_key",
        ),
    )
    for index_name, columns in (
        ("ix_ai_enterprise_metric_snapshots_organization_id", ["organization_id"]),
        ("ix_ai_enterprise_metric_snapshots_scope_fingerprint", ["scope_fingerprint"]),
        ("ix_ai_enterprise_metric_snapshots_scope_type", ["scope_type"]),
        ("ix_ai_enterprise_metric_snapshots_metric_code", ["metric_code"]),
        ("ix_ai_enterprise_metric_snapshots_period_start", ["period_start"]),
        ("ix_ai_enterprise_metric_snapshots_period_end", ["period_end"]),
        ("ix_ai_enterprise_metric_snapshots_data_cutoff_at", ["data_cutoff_at"]),
        ("ix_ai_enterprise_metric_snapshots_freshness", ["freshness"]),
        ("ix_ai_enterprise_metric_snapshots_suppressed", ["suppressed"]),
        ("ix_ai_enterprise_metric_snapshots_source_hash", ["source_hash"]),
        (
            "ix_ai_enterprise_metric_snapshots_scope_metric_cutoff",
            ["scope_fingerprint", "metric_code", "data_cutoff_at"],
        ),
    ):
        op.create_index(index_name, "ai_enterprise_metric_snapshots", columns)

    op.create_table(
        "ai_enterprise_project_health_snapshots",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column(
            "organization_id",
            id_type,
            sa.ForeignKey("ai_organizations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "project_id",
            id_type,
            sa.ForeignKey("ai_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("project_uuid", sa.String(36), nullable=False),
        sa.Column("scope_fingerprint", sa.String(64), nullable=False),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="0"),
        sa.Column("rule_version", sa.String(64), nullable=False),
        sa.Column("as_of", sa.DateTime(), nullable=False),
        sa.Column("dimensions_json", sa.JSON(), nullable=False),
        sa.Column("deductions_json", sa.JSON(), nullable=False),
        sa.Column("source_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "project_id",
            "scope_fingerprint",
            "rule_version",
            "as_of",
            name="uq_ai_enterprise_project_health_snapshots_immutable_key",
        ),
    )
    for index_name, columns in (
        ("ix_ai_enterprise_project_health_snapshots_organization_id", ["organization_id"]),
        ("ix_ai_enterprise_project_health_snapshots_project_id", ["project_id"]),
        ("ix_ai_enterprise_project_health_snapshots_project_uuid", ["project_uuid"]),
        ("ix_ai_enterprise_project_health_snapshots_scope_fingerprint", ["scope_fingerprint"]),
        ("ix_ai_enterprise_project_health_snapshots_status", ["status"]),
        ("ix_ai_enterprise_project_health_snapshots_rule_version", ["rule_version"]),
        ("ix_ai_enterprise_project_health_snapshots_as_of", ["as_of"]),
        ("ix_ai_enterprise_project_health_snapshots_source_hash", ["source_hash"]),
    ):
        op.create_index(index_name, "ai_enterprise_project_health_snapshots", columns)

    op.create_table(
        "ai_enterprise_data_quality_issues",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("scope_fingerprint", sa.String(64), nullable=False),
        sa.Column("project_uuid", sa.String(36), nullable=False),
        sa.Column("entity_type", sa.String(48), nullable=False),
        sa.Column("entity_uuid", sa.String(36), nullable=False),
        sa.Column("code", sa.String(96), nullable=False),
        sa.Column("severity", sa.String(24), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("resolution", sa.String(32), nullable=False, server_default="manual_review"),
        sa.Column("status", sa.String(24), nullable=False, server_default="unresolved"),
        sa.Column("issue_fingerprint", sa.String(64), nullable=False),
        sa.Column("detected_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("source_version", sa.Integer(), nullable=False, server_default="1"),
        *_timestamps(),
        sa.UniqueConstraint(
            "issue_fingerprint",
            name="uq_ai_enterprise_data_quality_issues_fingerprint",
        ),
    )
    for index_name, columns in (
        ("ix_ai_enterprise_data_quality_issues_scope_fingerprint", ["scope_fingerprint"]),
        ("ix_ai_enterprise_data_quality_issues_project_uuid", ["project_uuid"]),
        ("ix_ai_enterprise_data_quality_issues_entity_type", ["entity_type"]),
        ("ix_ai_enterprise_data_quality_issues_entity_uuid", ["entity_uuid"]),
        ("ix_ai_enterprise_data_quality_issues_code", ["code"]),
        ("ix_ai_enterprise_data_quality_issues_severity", ["severity"]),
        ("ix_ai_enterprise_data_quality_issues_status", ["status"]),
        ("ix_ai_enterprise_data_quality_issues_issue_fingerprint", ["issue_fingerprint"]),
    ):
        op.create_index(index_name, "ai_enterprise_data_quality_issues", columns)


def downgrade() -> None:
    for index_name in (
        "ix_ai_enterprise_data_quality_issues_issue_fingerprint",
        "ix_ai_enterprise_data_quality_issues_status",
        "ix_ai_enterprise_data_quality_issues_severity",
        "ix_ai_enterprise_data_quality_issues_code",
        "ix_ai_enterprise_data_quality_issues_entity_uuid",
        "ix_ai_enterprise_data_quality_issues_entity_type",
        "ix_ai_enterprise_data_quality_issues_project_uuid",
        "ix_ai_enterprise_data_quality_issues_scope_fingerprint",
    ):
        op.drop_index(index_name, table_name="ai_enterprise_data_quality_issues")
    op.drop_table("ai_enterprise_data_quality_issues")

    for index_name in (
        "ix_ai_enterprise_project_health_snapshots_source_hash",
        "ix_ai_enterprise_project_health_snapshots_as_of",
        "ix_ai_enterprise_project_health_snapshots_rule_version",
        "ix_ai_enterprise_project_health_snapshots_status",
        "ix_ai_enterprise_project_health_snapshots_scope_fingerprint",
        "ix_ai_enterprise_project_health_snapshots_project_uuid",
        "ix_ai_enterprise_project_health_snapshots_project_id",
        "ix_ai_enterprise_project_health_snapshots_organization_id",
    ):
        op.drop_index(index_name, table_name="ai_enterprise_project_health_snapshots")
    op.drop_table("ai_enterprise_project_health_snapshots")

    for index_name in (
        "ix_ai_enterprise_metric_snapshots_scope_metric_cutoff",
        "ix_ai_enterprise_metric_snapshots_source_hash",
        "ix_ai_enterprise_metric_snapshots_suppressed",
        "ix_ai_enterprise_metric_snapshots_freshness",
        "ix_ai_enterprise_metric_snapshots_data_cutoff_at",
        "ix_ai_enterprise_metric_snapshots_period_end",
        "ix_ai_enterprise_metric_snapshots_period_start",
        "ix_ai_enterprise_metric_snapshots_metric_code",
        "ix_ai_enterprise_metric_snapshots_scope_type",
        "ix_ai_enterprise_metric_snapshots_scope_fingerprint",
        "ix_ai_enterprise_metric_snapshots_organization_id",
    ):
        op.drop_index(index_name, table_name="ai_enterprise_metric_snapshots")
    op.drop_table("ai_enterprise_metric_snapshots")

    for index_name in (
        "ix_ai_enterprise_metric_definitions_status",
        "ix_ai_enterprise_metric_definitions_metric_code",
    ):
        op.drop_index(index_name, table_name="ai_enterprise_metric_definitions")
    op.drop_table("ai_enterprise_metric_definitions")
