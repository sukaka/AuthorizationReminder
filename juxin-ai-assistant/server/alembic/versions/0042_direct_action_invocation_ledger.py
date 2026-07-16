"""add durable direct action invocation ledger

Revision ID: 0042_direct_action_invocation_ledger
Revises: 0041_merge_agent_reconciliation_and_external_support
"""

from alembic import op
import sqlalchemy as sa


revision = "0042_direct_action_invocation_ledger"
down_revision = "0041_merge_agent_reconciliation_and_external_support"
branch_labels = None
depends_on = None

id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "ai_direct_action_invocations",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("user_id", sa.String(64), nullable=False),
        sa.Column("action_name", sa.String(96), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="in_progress"),
        sa.Column("response_status", sa.Integer(), nullable=True),
        sa.Column("response_payload_json", sa.JSON(), nullable=True),
        sa.Column("error_code", sa.String(64), nullable=False, server_default=""),
        sa.Column("error_message_safe", sa.Text(), nullable=False, server_default=""),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
        sa.UniqueConstraint("user_id", "action_name", "idempotency_key"),
    )
    for column in ["user_id", "action_name", "request_hash", "status", "error_code"]:
        op.create_index(f"ix_ai_direct_action_invocations_{column}", "ai_direct_action_invocations", [column])


def downgrade() -> None:
    op.drop_table("ai_direct_action_invocations")
