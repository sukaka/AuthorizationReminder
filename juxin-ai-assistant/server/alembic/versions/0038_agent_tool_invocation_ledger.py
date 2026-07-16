"""add durable tool invocation ledger

Revision ID: 0038_agent_tool_invocation_ledger
Revises: 0037_agent_run_state_contract
"""

from alembic import op
import sqlalchemy as sa


revision = "0038_agent_tool_invocation_ledger"
down_revision = "0037_agent_run_state_contract"
branch_labels = None
depends_on = None

id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "ai_agent_tool_invocations",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("run_id", sa.String(64), nullable=False),
        sa.Column("user_id", sa.String(64), nullable=False),
        sa.Column("tool_name", sa.String(96), nullable=False),
        sa.Column("tool_version", sa.String(32), nullable=False, server_default=""),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("effect", sa.String(16), nullable=False, server_default="write"),
        sa.Column("status", sa.String(32), nullable=False, server_default="in_progress"),
        sa.Column("result_payload_json", sa.JSON(), nullable=True),
        sa.Column("output_summary_json", sa.JSON(), nullable=True),
        sa.Column("source_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_code", sa.String(64), nullable=False, server_default=""),
        sa.Column("error_message_safe", sa.Text(), nullable=False, server_default=""),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
        sa.UniqueConstraint("run_id", "tool_name", "idempotency_key"),
    )
    for column in ["run_id", "user_id", "tool_name", "request_hash", "effect", "status", "error_code"]:
        op.create_index(f"ix_ai_agent_tool_invocations_{column}", "ai_agent_tool_invocations", [column])


def downgrade() -> None:
    op.drop_table("ai_agent_tool_invocations")
