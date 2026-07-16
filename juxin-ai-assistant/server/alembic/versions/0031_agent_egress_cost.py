"""agent providers, connections, call logs, egress audit

Revision ID: 0031_agent_egress_cost
Revises: 0030_channel_jobs
"""

from alembic import op
import sqlalchemy as sa

revision = "0031_agent_egress_cost"
down_revision = "0030_channel_jobs"
branch_labels = None
depends_on = None

id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "ai_agent_providers",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("provider_key", sa.String(64), nullable=False),
        sa.Column("name", sa.String(128), nullable=False, server_default=""),
        sa.Column("kind", sa.String(32), nullable=False, server_default="external"),
        sa.Column("status", sa.String(24), nullable=False, server_default="available"),
        sa.Column("base_url", sa.String(1024), nullable=False, server_default=""),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
        sa.UniqueConstraint("provider_key"),
    )
    op.create_index("ix_ai_agent_providers_kind", "ai_agent_providers", ["kind"])
    op.create_index("ix_ai_agent_providers_status", "ai_agent_providers", ["status"])

    op.create_table(
        "ai_agent_connections",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("agent_id", sa.String(96), nullable=False),
        sa.Column("provider_key", sa.String(64), nullable=False, server_default=""),
        sa.Column("name", sa.String(128), nullable=False, server_default=""),
        sa.Column("endpoint", sa.String(1024), nullable=False, server_default=""),
        sa.Column("status", sa.String(24), nullable=False, server_default="installed"),
        sa.Column("capabilities_json", sa.JSON(), nullable=True),
        sa.Column("cost_per_call_micros", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("installed_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
        sa.UniqueConstraint("agent_id"),
    )
    for col in ["provider_key", "status"]:
        op.create_index(f"ix_ai_agent_connections_{col}", "ai_agent_connections", [col])

    op.create_table(
        "ai_agent_call_logs",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("user_id", sa.String(64), nullable=False),
        sa.Column("agent_id", sa.String(96), nullable=False),
        sa.Column("run_id", sa.String(64), nullable=False, server_default=""),
        sa.Column("channel", sa.String(32), nullable=False, server_default=""),
        sa.Column("destination", sa.String(32), nullable=False, server_default=""),
        sa.Column("data_level", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(24), nullable=False, server_default="succeeded"),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_micros", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("egress_allowed", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("request_summary", sa.String(500), nullable=False, server_default=""),
        sa.Column("result_summary", sa.String(500), nullable=False, server_default=""),
        sa.Column("detail_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    for col in ["user_id", "agent_id", "run_id", "channel", "destination", "data_level", "status"]:
        op.create_index(f"ix_ai_agent_call_logs_{col}", "ai_agent_call_logs", [col])

    op.create_table(
        "ai_egress_audit_logs",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("user_id", sa.String(64), nullable=False),
        sa.Column("destination", sa.String(32), nullable=False, server_default=""),
        sa.Column("channel", sa.String(32), nullable=False, server_default=""),
        sa.Column("agent_id", sa.String(96), nullable=False, server_default=""),
        sa.Column("run_id", sa.String(64), nullable=False, server_default=""),
        sa.Column("data_level", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("allowed", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("requires_confirmation", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("redaction_applied", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("policy", sa.String(255), nullable=False, server_default=""),
        sa.Column("findings_json", sa.JSON(), nullable=True),
        sa.Column("reasons_json", sa.JSON(), nullable=True),
        sa.Column("text_fingerprint", sa.String(64), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    for col in ["user_id", "destination", "channel", "agent_id", "run_id", "data_level", "allowed"]:
        op.create_index(f"ix_ai_egress_audit_logs_{col}", "ai_egress_audit_logs", [col])


def downgrade() -> None:
    op.drop_table("ai_egress_audit_logs")
    op.drop_table("ai_agent_call_logs")
    op.drop_table("ai_agent_connections")
    op.drop_table("ai_agent_providers")
