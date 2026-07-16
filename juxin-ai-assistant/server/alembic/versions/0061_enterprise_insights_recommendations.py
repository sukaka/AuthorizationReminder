"""add evidence-bound enterprise insights and recommendation action gates

Revision ID: 0061_enterprise_insights_recommendations
Revises: 0060_enterprise_graph_memory

Insight rows are immutable conclusions for a fixed rule, scope and evidence
fingerprint.  Recommendation actions are durable approval/idempotency records;
they do not execute a business side effect by themselves.
"""

from alembic import op
import sqlalchemy as sa


revision = "0061_enterprise_insights_recommendations"
down_revision = "0060_enterprise_graph_memory"
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
        "ai_enterprise_insight_rules",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("organization_id", id_type, sa.ForeignKey("ai_organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rule_key", sa.String(96), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("owner", sa.String(64), nullable=False, server_default="enterprise-intelligence"),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("latest_version", sa.String(32), nullable=False, server_default="1.0.0"),
        sa.Column("created_by", sa.String(64), nullable=False, server_default="system"),
        sa.Column("row_version", sa.Integer(), nullable=False, server_default="1"),
        *_timestamps(),
        sa.UniqueConstraint("organization_id", "rule_key", name="uq_ai_enterprise_insight_rules_org_key"),
    )
    for name, columns in (
        ("ix_ai_enterprise_insight_rules_organization_id", ["organization_id"]),
        ("ix_ai_enterprise_insight_rules_rule_key", ["rule_key"]),
        ("ix_ai_enterprise_insight_rules_status", ["status"]),
    ):
        op.create_index(name, "ai_enterprise_insight_rules", columns)

    op.create_table(
        "ai_enterprise_insight_rule_versions",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("rule_id", id_type, sa.ForeignKey("ai_enterprise_insight_rules.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.String(32), nullable=False),
        sa.Column("rule_type", sa.String(64), nullable=False),
        sa.Column("config_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="published"),
        sa.Column("effective_from", sa.DateTime(), nullable=True),
        sa.Column("created_by", sa.String(64), nullable=False, server_default="system"),
        *_timestamps(),
        sa.UniqueConstraint("rule_id", "version", name="uq_ai_enterprise_insight_rule_versions_rule_version"),
    )
    for name, columns in (
        ("ix_ai_enterprise_insight_rule_versions_rule_id", ["rule_id"]),
        ("ix_ai_enterprise_insight_rule_versions_rule_type", ["rule_type"]),
        ("ix_ai_enterprise_insight_rule_versions_status", ["status"]),
    ):
        op.create_index(name, "ai_enterprise_insight_rule_versions", columns)

    op.create_table(
        "ai_enterprise_insights",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("organization_id", id_type, sa.ForeignKey("ai_organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", id_type, sa.ForeignKey("ai_projects.id", ondelete="CASCADE"), nullable=True),
        sa.Column("rule_version_id", id_type, sa.ForeignKey("ai_enterprise_insight_rule_versions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("insight_type", sa.String(64), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("scope_fingerprint", sa.String(64), nullable=False),
        sa.Column("policy_version", sa.String(64), nullable=False, server_default=""),
        sa.Column("data_cutoff_at", sa.DateTime(), nullable=False),
        sa.Column("data_version", sa.String(128), nullable=False, server_default=""),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="0"),
        sa.Column("severity", sa.String(24), nullable=False, server_default="medium"),
        sa.Column("impact_scope_json", sa.JSON(), nullable=False),
        sa.Column("evidence_fingerprint", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="open"),
        sa.Column("assigned_to", sa.String(64), nullable=False, server_default=""),
        sa.Column("feedback", sa.Text(), nullable=False, server_default=""),
        sa.Column("acknowledged_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("acknowledged_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("row_version", sa.Integer(), nullable=False, server_default="1"),
        *_timestamps(),
        sa.UniqueConstraint(
            "rule_version_id",
            "scope_fingerprint",
            "evidence_fingerprint",
            name="uq_ai_enterprise_insights_rule_scope_evidence",
        ),
    )
    for name, columns in (
        ("ix_ai_enterprise_insights_organization_id", ["organization_id"]),
        ("ix_ai_enterprise_insights_project_id", ["project_id"]),
        ("ix_ai_enterprise_insights_rule_version_id", ["rule_version_id"]),
        ("ix_ai_enterprise_insights_insight_type", ["insight_type"]),
        ("ix_ai_enterprise_insights_scope_fingerprint", ["scope_fingerprint"]),
        ("ix_ai_enterprise_insights_data_cutoff_at", ["data_cutoff_at"]),
        ("ix_ai_enterprise_insights_severity", ["severity"]),
        ("ix_ai_enterprise_insights_evidence_fingerprint", ["evidence_fingerprint"]),
        ("ix_ai_enterprise_insights_status", ["status"]),
    ):
        op.create_index(name, "ai_enterprise_insights", columns)

    op.create_table(
        "ai_enterprise_insight_evidence",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("insight_id", id_type, sa.ForeignKey("ai_enterprise_insights.id", ondelete="CASCADE"), nullable=False),
        sa.Column("evidence_type", sa.String(64), nullable=False),
        sa.Column("evidence_uuid", sa.String(64), nullable=False),
        sa.Column("source_table", sa.String(128), nullable=False, server_default=""),
        sa.Column("source_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("detail_json", sa.JSON(), nullable=False),
        *_timestamps(),
        sa.UniqueConstraint(
            "insight_id", "evidence_type", "evidence_uuid", "source_version",
            name="uq_ai_enterprise_insight_evidence_natural_key",
        ),
    )
    for name, columns in (
        ("ix_ai_enterprise_insight_evidence_insight_id", ["insight_id"]),
        ("ix_ai_enterprise_insight_evidence_evidence_type", ["evidence_type"]),
        ("ix_ai_enterprise_insight_evidence_evidence_uuid", ["evidence_uuid"]),
    ):
        op.create_index(name, "ai_enterprise_insight_evidence", columns)

    op.create_table(
        "ai_enterprise_recommendations",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("organization_id", id_type, sa.ForeignKey("ai_organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("insight_id", id_type, sa.ForeignKey("ai_enterprise_insights.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recommendation_type", sa.String(64), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("risk_level", sa.String(16), nullable=False, server_default="low"),
        sa.Column("status", sa.String(32), nullable=False, server_default="proposed"),
        sa.Column("scope_fingerprint", sa.String(64), nullable=False),
        sa.Column("policy_version", sa.String(64), nullable=False, server_default=""),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("proposed_by", sa.String(64), nullable=False, server_default="system"),
        sa.Column("approved_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("workflow_run_id", sa.String(36), nullable=False, server_default=""),
        sa.Column("row_version", sa.Integer(), nullable=False, server_default="1"),
        *_timestamps(),
        sa.UniqueConstraint("organization_id", "idempotency_key", name="uq_ai_enterprise_recommendations_org_idempotency"),
    )
    for name, columns in (
        ("ix_ai_enterprise_recommendations_organization_id", ["organization_id"]),
        ("ix_ai_enterprise_recommendations_insight_id", ["insight_id"]),
        ("ix_ai_enterprise_recommendations_recommendation_type", ["recommendation_type"]),
        ("ix_ai_enterprise_recommendations_risk_level", ["risk_level"]),
        ("ix_ai_enterprise_recommendations_status", ["status"]),
        ("ix_ai_enterprise_recommendations_scope_fingerprint", ["scope_fingerprint"]),
    ):
        op.create_index(name, "ai_enterprise_recommendations", columns)

    op.create_table(
        "ai_enterprise_recommendation_actions",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("recommendation_id", id_type, sa.ForeignKey("ai_enterprise_recommendations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("action_type", sa.String(64), nullable=False),
        sa.Column("risk_level", sa.String(16), nullable=False, server_default="low"),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending_approval"),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("requires_approval", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("approval_token_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("executed_at", sa.DateTime(), nullable=True),
        sa.Column("result_json", sa.JSON(), nullable=False),
        sa.Column("reconciliation_status", sa.String(32), nullable=False, server_default="not_required"),
        sa.Column("row_version", sa.Integer(), nullable=False, server_default="1"),
        *_timestamps(),
        sa.UniqueConstraint("recommendation_id", "idempotency_key", name="uq_ai_enterprise_recommendation_actions_idempotency"),
    )
    for name, columns in (
        ("ix_ai_enterprise_recommendation_actions_recommendation_id", ["recommendation_id"]),
        ("ix_ai_enterprise_recommendation_actions_action_type", ["action_type"]),
        ("ix_ai_enterprise_recommendation_actions_risk_level", ["risk_level"]),
        ("ix_ai_enterprise_recommendation_actions_status", ["status"]),
        ("ix_ai_enterprise_recommendation_actions_reconciliation_status", ["reconciliation_status"]),
    ):
        op.create_index(name, "ai_enterprise_recommendation_actions", columns)


def downgrade() -> None:
    for name in (
        "ix_ai_enterprise_recommendation_actions_reconciliation_status",
        "ix_ai_enterprise_recommendation_actions_status",
        "ix_ai_enterprise_recommendation_actions_risk_level",
        "ix_ai_enterprise_recommendation_actions_action_type",
        "ix_ai_enterprise_recommendation_actions_recommendation_id",
    ):
        op.drop_index(name, table_name="ai_enterprise_recommendation_actions")
    op.drop_table("ai_enterprise_recommendation_actions")

    for name in (
        "ix_ai_enterprise_recommendations_scope_fingerprint",
        "ix_ai_enterprise_recommendations_status",
        "ix_ai_enterprise_recommendations_risk_level",
        "ix_ai_enterprise_recommendations_recommendation_type",
        "ix_ai_enterprise_recommendations_insight_id",
        "ix_ai_enterprise_recommendations_organization_id",
    ):
        op.drop_index(name, table_name="ai_enterprise_recommendations")
    op.drop_table("ai_enterprise_recommendations")

    for name in (
        "ix_ai_enterprise_insight_evidence_evidence_uuid",
        "ix_ai_enterprise_insight_evidence_evidence_type",
        "ix_ai_enterprise_insight_evidence_insight_id",
    ):
        op.drop_index(name, table_name="ai_enterprise_insight_evidence")
    op.drop_table("ai_enterprise_insight_evidence")

    for name in (
        "ix_ai_enterprise_insights_status",
        "ix_ai_enterprise_insights_evidence_fingerprint",
        "ix_ai_enterprise_insights_severity",
        "ix_ai_enterprise_insights_data_cutoff_at",
        "ix_ai_enterprise_insights_scope_fingerprint",
        "ix_ai_enterprise_insights_insight_type",
        "ix_ai_enterprise_insights_rule_version_id",
        "ix_ai_enterprise_insights_project_id",
        "ix_ai_enterprise_insights_organization_id",
    ):
        op.drop_index(name, table_name="ai_enterprise_insights")
    op.drop_table("ai_enterprise_insights")

    for name in (
        "ix_ai_enterprise_insight_rule_versions_status",
        "ix_ai_enterprise_insight_rule_versions_rule_type",
        "ix_ai_enterprise_insight_rule_versions_rule_id",
    ):
        op.drop_index(name, table_name="ai_enterprise_insight_rule_versions")
    op.drop_table("ai_enterprise_insight_rule_versions")

    for name in (
        "ix_ai_enterprise_insight_rules_status",
        "ix_ai_enterprise_insight_rules_rule_key",
        "ix_ai_enterprise_insight_rules_organization_id",
    ):
        op.drop_index(name, table_name="ai_enterprise_insight_rules")
    op.drop_table("ai_enterprise_insight_rules")
