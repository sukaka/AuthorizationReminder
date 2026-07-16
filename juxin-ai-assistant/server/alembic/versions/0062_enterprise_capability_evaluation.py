"""add version-separated enterprise capability evaluation and optimization gates

Revision ID: 0062_enterprise_capability_evaluation
Revises: 0061_enterprise_insights_recommendations

Evaluations are immutable snapshots of a capability version and fixed window.
Optimization proposals and observations are review/release records only; this
migration does not publish a catalog version or change runtime behavior.
"""

from alembic import op
import sqlalchemy as sa


revision = "0062_enterprise_capability_evaluation"
down_revision = "0061_enterprise_insights_recommendations"
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
        "ai_enterprise_capability_evaluations",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("organization_id", id_type, sa.ForeignKey("ai_organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("capability_type", sa.String(32), nullable=False),
        sa.Column("capability_key", sa.String(128), nullable=False),
        sa.Column("capability_version", sa.String(64), nullable=False),
        sa.Column("period_start", sa.DateTime(), nullable=False),
        sa.Column("period_end", sa.DateTime(), nullable=False),
        sa.Column("data_cutoff_at", sa.DateTime(), nullable=False),
        sa.Column("source_version", sa.String(128), nullable=False, server_default=""),
        sa.Column("definition_version", sa.String(32), nullable=False, server_default="1.0.0"),
        sa.Column("scope_fingerprint", sa.String(64), nullable=False),
        sa.Column("policy_version", sa.String(64), nullable=False, server_default=""),
        sa.Column("evaluation_fingerprint", sa.String(64), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False, server_default=""),
        sa.Column("request_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("sample_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("success_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("quality_pass_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("quality_sample_size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("human_modified_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_cost_micros", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("confidence_label", sa.String(24), nullable=False, server_default="low_sample"),
        sa.Column("status", sa.String(24), nullable=False, server_default="ready"),
        sa.Column("evidence_refs_json", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False, server_default="system"),
        sa.Column("row_version", sa.Integer(), nullable=False, server_default="1"),
        *_timestamps(),
        sa.UniqueConstraint("organization_id", "evaluation_fingerprint", name="uq_ai_enterprise_capability_evaluations_fingerprint"),
        sa.UniqueConstraint("organization_id", "idempotency_key", name="uq_ai_enterprise_capability_evaluations_idempotency"),
    )
    for name, columns in (
        ("ix_ai_enterprise_capability_evaluations_organization_id", ["organization_id"]),
        ("ix_ai_enterprise_capability_evaluations_capability_type", ["capability_type"]),
        ("ix_ai_enterprise_capability_evaluations_capability_key", ["capability_key"]),
        ("ix_ai_enterprise_capability_evaluations_capability_version", ["capability_version"]),
        ("ix_ai_enterprise_capability_evaluations_data_cutoff_at", ["data_cutoff_at"]),
        ("ix_ai_enterprise_capability_evaluations_scope_fingerprint", ["scope_fingerprint"]),
        ("ix_ai_enterprise_capability_evaluations_evaluation_fingerprint", ["evaluation_fingerprint"]),
        ("ix_ai_enterprise_capability_evaluations_idempotency_key", ["idempotency_key"]),
        ("ix_ai_enterprise_capability_evaluations_status", ["status"]),
    ):
        op.create_index(name, "ai_enterprise_capability_evaluations", columns)

    op.create_table(
        "ai_enterprise_optimization_proposals",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("organization_id", id_type, sa.ForeignKey("ai_organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("evaluation_id", id_type, sa.ForeignKey("ai_enterprise_capability_evaluations.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("capability_type", sa.String(32), nullable=False),
        sa.Column("capability_key", sa.String(128), nullable=False),
        sa.Column("current_version", sa.String(64), nullable=False, server_default=""),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False, server_default=""),
        sa.Column("proposed_change_json", sa.JSON(), nullable=False),
        sa.Column("risk_level", sa.String(16), nullable=False, server_default="medium"),
        sa.Column("status", sa.String(32), nullable=False, server_default="draft"),
        sa.Column("scope_fingerprint", sa.String(64), nullable=False),
        sa.Column("policy_version", sa.String(64), nullable=False, server_default=""),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("proposed_by", sa.String(64), nullable=False, server_default="system"),
        sa.Column("reviewed_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("published_at", sa.DateTime(), nullable=True),
        sa.Column("rolled_back_at", sa.DateTime(), nullable=True),
        sa.Column("row_version", sa.Integer(), nullable=False, server_default="1"),
        *_timestamps(),
        sa.UniqueConstraint("organization_id", "idempotency_key", name="uq_ai_enterprise_optimization_proposals_org_idempotency"),
    )
    for name, columns in (
        ("ix_ai_enterprise_optimization_proposals_organization_id", ["organization_id"]),
        ("ix_ai_enterprise_optimization_proposals_evaluation_id", ["evaluation_id"]),
        ("ix_ai_enterprise_optimization_proposals_capability_type", ["capability_type"]),
        ("ix_ai_enterprise_optimization_proposals_capability_key", ["capability_key"]),
        ("ix_ai_enterprise_optimization_proposals_status", ["status"]),
        ("ix_ai_enterprise_optimization_proposals_risk_level", ["risk_level"]),
        ("ix_ai_enterprise_optimization_proposals_scope_fingerprint", ["scope_fingerprint"]),
    ):
        op.create_index(name, "ai_enterprise_optimization_proposals", columns)

    op.create_table(
        "ai_enterprise_optimization_proposal_events",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("proposal_id", id_type, sa.ForeignKey("ai_enterprise_optimization_proposals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("from_status", sa.String(32), nullable=False, server_default=""),
        sa.Column("to_status", sa.String(32), nullable=False, server_default=""),
        sa.Column("actor_user_id", sa.String(64), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False, server_default=""),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("detail_json", sa.JSON(), nullable=False),
        *_timestamps(),
        sa.UniqueConstraint("proposal_id", "idempotency_key", name="uq_ai_enterprise_optimization_proposal_events_key"),
    )
    for name, columns in (
        ("ix_ai_enterprise_optimization_proposal_events_proposal_id", ["proposal_id"]),
        ("ix_ai_enterprise_optimization_proposal_events_action", ["action"]),
        ("ix_ai_enterprise_optimization_proposal_events_actor_user_id", ["actor_user_id"]),
    ):
        op.create_index(name, "ai_enterprise_optimization_proposal_events", columns)

    op.create_table(
        "ai_enterprise_capability_observations",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("proposal_id", id_type, sa.ForeignKey("ai_enterprise_optimization_proposals.id", ondelete="CASCADE"), nullable=False),
        sa.Column("observed_version", sa.String(64), nullable=False),
        sa.Column("window_start", sa.DateTime(), nullable=False),
        sa.Column("window_end", sa.DateTime(), nullable=False),
        sa.Column("baseline_metrics_json", sa.JSON(), nullable=False),
        sa.Column("candidate_metrics_json", sa.JSON(), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False, server_default=""),
        sa.Column("request_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("status", sa.String(24), nullable=False, server_default="pending"),
        sa.Column("rollback_recommended", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("evidence_refs_json", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False, server_default="system"),
        *_timestamps(),
        sa.UniqueConstraint(
            "proposal_id", "observed_version", "window_start", "window_end",
            name="uq_ai_enterprise_capability_observations_window",
        ),
        sa.UniqueConstraint(
            "proposal_id", "idempotency_key",
            name="uq_ai_enterprise_capability_observations_idempotency",
        ),
    )
    for name, columns in (
        ("ix_ai_enterprise_capability_observations_proposal_id", ["proposal_id"]),
        ("ix_ai_enterprise_capability_observations_observed_version", ["observed_version"]),
        ("ix_ai_enterprise_capability_observations_idempotency_key", ["idempotency_key"]),
        ("ix_ai_enterprise_capability_observations_status", ["status"]),
        ("ix_ai_enterprise_capability_observations_rollback_recommended", ["rollback_recommended"]),
    ):
        op.create_index(name, "ai_enterprise_capability_observations", columns)


def downgrade() -> None:
    for name in (
        "ix_ai_enterprise_capability_observations_rollback_recommended",
        "ix_ai_enterprise_capability_observations_status",
        "ix_ai_enterprise_capability_observations_idempotency_key",
        "ix_ai_enterprise_capability_observations_observed_version",
        "ix_ai_enterprise_capability_observations_proposal_id",
    ):
        op.drop_index(name, table_name="ai_enterprise_capability_observations")
    op.drop_table("ai_enterprise_capability_observations")

    for name in (
        "ix_ai_enterprise_optimization_proposal_events_actor_user_id",
        "ix_ai_enterprise_optimization_proposal_events_action",
        "ix_ai_enterprise_optimization_proposal_events_proposal_id",
    ):
        op.drop_index(name, table_name="ai_enterprise_optimization_proposal_events")
    op.drop_table("ai_enterprise_optimization_proposal_events")

    for name in (
        "ix_ai_enterprise_optimization_proposals_scope_fingerprint",
        "ix_ai_enterprise_optimization_proposals_risk_level",
        "ix_ai_enterprise_optimization_proposals_status",
        "ix_ai_enterprise_optimization_proposals_capability_key",
        "ix_ai_enterprise_optimization_proposals_capability_type",
        "ix_ai_enterprise_optimization_proposals_evaluation_id",
        "ix_ai_enterprise_optimization_proposals_organization_id",
    ):
        op.drop_index(name, table_name="ai_enterprise_optimization_proposals")
    op.drop_table("ai_enterprise_optimization_proposals")

    for name in (
        "ix_ai_enterprise_capability_evaluations_status",
        "ix_ai_enterprise_capability_evaluations_scope_fingerprint",
        "ix_ai_enterprise_capability_evaluations_data_cutoff_at",
        "ix_ai_enterprise_capability_evaluations_evaluation_fingerprint",
        "ix_ai_enterprise_capability_evaluations_idempotency_key",
        "ix_ai_enterprise_capability_evaluations_capability_version",
        "ix_ai_enterprise_capability_evaluations_capability_key",
        "ix_ai_enterprise_capability_evaluations_capability_type",
        "ix_ai_enterprise_capability_evaluations_organization_id",
    ):
        op.drop_index(name, table_name="ai_enterprise_capability_evaluations")
    op.drop_table("ai_enterprise_capability_evaluations")
