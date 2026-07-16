"""add versioned HarnessSpec registry and run bindings

Revision ID: 0044_harness_spec_registry
Revises: 0043_direct_action_reconciliation_audit
"""

from alembic import op
import sqlalchemy as sa


revision = "0044_harness_spec_registry"
down_revision = "0043_direct_action_reconciliation_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")
    op.create_table(
        "ai_harness_spec_versions",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("semantic_version", sa.String(32), nullable=False, unique=True),
        sa.Column("content_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("content_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="draft"),
        sa.Column("created_by_user_id", sa.String(64), nullable=False, server_default="system"),
        sa.Column("approved_by_user_id", sa.String(64), nullable=False, server_default=""),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("activated_by_user_id", sa.String(64), nullable=False, server_default=""),
        sa.Column("activated_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_ai_harness_spec_versions_status", "ai_harness_spec_versions", ["status"])
    op.create_index("ix_ai_harness_spec_versions_created_by_user_id", "ai_harness_spec_versions", ["created_by_user_id"])
    op.create_table(
        "ai_harness_spec_audit_events",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("spec_uuid", sa.String(36), sa.ForeignKey("ai_harness_spec_versions.uuid", ondelete="CASCADE"), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("actor_id", sa.String(64), nullable=False, server_default="system"),
        sa.Column("from_status", sa.String(24), nullable=False, server_default=""),
        sa.Column("to_status", sa.String(24), nullable=False, server_default=""),
        sa.Column("detail_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_ai_harness_spec_audit_events_spec_uuid", "ai_harness_spec_audit_events", ["spec_uuid"])
    op.create_index("ix_ai_harness_spec_audit_events_action", "ai_harness_spec_audit_events", ["action"])
    op.create_index("ix_ai_harness_spec_audit_events_actor_id", "ai_harness_spec_audit_events", ["actor_id"])
    op.add_column("ai_agent_runs", sa.Column("harness_spec_uuid", sa.String(36), nullable=False, server_default=""))
    op.add_column("ai_agent_runs", sa.Column("harness_spec_version", sa.String(32), nullable=False, server_default="legacy"))
    op.add_column("ai_agent_runs", sa.Column("harness_spec_hash", sa.String(64), nullable=False, server_default=""))
    op.create_index("ix_ai_agent_runs_harness_spec_uuid", "ai_agent_runs", ["harness_spec_uuid"])
    op.create_index("ix_ai_agent_runs_harness_spec_version", "ai_agent_runs", ["harness_spec_version"])


def downgrade() -> None:
    op.drop_index("ix_ai_agent_runs_harness_spec_version", table_name="ai_agent_runs")
    op.drop_index("ix_ai_agent_runs_harness_spec_uuid", table_name="ai_agent_runs")
    op.drop_column("ai_agent_runs", "harness_spec_hash")
    op.drop_column("ai_agent_runs", "harness_spec_version")
    op.drop_column("ai_agent_runs", "harness_spec_uuid")
    op.drop_index("ix_ai_harness_spec_audit_events_actor_id", table_name="ai_harness_spec_audit_events")
    op.drop_index("ix_ai_harness_spec_audit_events_action", table_name="ai_harness_spec_audit_events")
    op.drop_index("ix_ai_harness_spec_audit_events_spec_uuid", table_name="ai_harness_spec_audit_events")
    op.drop_table("ai_harness_spec_audit_events")
    op.drop_index("ix_ai_harness_spec_versions_created_by_user_id", table_name="ai_harness_spec_versions")
    op.drop_index("ix_ai_harness_spec_versions_status", table_name="ai_harness_spec_versions")
    op.drop_table("ai_harness_spec_versions")
