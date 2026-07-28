"""add reconciliation audit fields to the active agent tool call ledger

Revision ID: 0067_agent_tool_calls_reconciliation_fields
Revises: 0066_skill_uploads
"""

from alembic import op
import sqlalchemy as sa


revision = "0067_agent_tool_calls_reconciliation_fields"
down_revision = "0066_skill_uploads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_agent_tool_calls",
        sa.Column("reconciliation_resolution", sa.String(48), nullable=False, server_default=""),
    )
    op.add_column(
        "ai_agent_tool_calls",
        sa.Column("reconciled_by_user_id", sa.String(64), nullable=False, server_default=""),
    )
    op.add_column(
        "ai_agent_tool_calls",
        sa.Column("reconciled_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_ai_agent_tool_calls_reconciliation_resolution",
        "ai_agent_tool_calls",
        ["reconciliation_resolution"],
    )
    op.create_index(
        "ix_ai_agent_tool_calls_reconciled_by_user_id",
        "ai_agent_tool_calls",
        ["reconciled_by_user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ai_agent_tool_calls_reconciled_by_user_id",
        table_name="ai_agent_tool_calls",
    )
    op.drop_index(
        "ix_ai_agent_tool_calls_reconciliation_resolution",
        table_name="ai_agent_tool_calls",
    )
    op.drop_column("ai_agent_tool_calls", "reconciled_at")
    op.drop_column("ai_agent_tool_calls", "reconciled_by_user_id")
    op.drop_column("ai_agent_tool_calls", "reconciliation_resolution")
