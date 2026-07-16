"""add tool reconciliation audit fields

Revision ID: 0039_agent_tool_reconciliation_audit
Revises: 0038_agent_tool_invocation_ledger
"""

from alembic import op
import sqlalchemy as sa


revision = "0039_agent_tool_reconciliation_audit"
down_revision = "0038_agent_tool_invocation_ledger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_agent_tool_invocations",
        sa.Column("reconciliation_resolution", sa.String(48), nullable=False, server_default=""),
    )
    op.add_column(
        "ai_agent_tool_invocations",
        sa.Column("reconciled_by_user_id", sa.String(64), nullable=False, server_default=""),
    )
    op.add_column(
        "ai_agent_tool_invocations",
        sa.Column("reconciled_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_ai_agent_tool_invocations_reconciliation_resolution",
        "ai_agent_tool_invocations",
        ["reconciliation_resolution"],
    )
    op.create_index(
        "ix_ai_agent_tool_invocations_reconciled_by_user_id",
        "ai_agent_tool_invocations",
        ["reconciled_by_user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ai_agent_tool_invocations_reconciled_by_user_id",
        table_name="ai_agent_tool_invocations",
    )
    op.drop_index(
        "ix_ai_agent_tool_invocations_reconciliation_resolution",
        table_name="ai_agent_tool_invocations",
    )
    op.drop_column("ai_agent_tool_invocations", "reconciled_at")
    op.drop_column("ai_agent_tool_invocations", "reconciled_by_user_id")
    op.drop_column("ai_agent_tool_invocations", "reconciliation_resolution")
