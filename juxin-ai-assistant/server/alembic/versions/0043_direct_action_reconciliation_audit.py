"""add direct action reconciliation audit fields

Revision ID: 0043_direct_action_reconciliation_audit
Revises: 0042_direct_action_invocation_ledger
"""

from alembic import op
import sqlalchemy as sa


revision = "0043_direct_action_reconciliation_audit"
down_revision = "0042_direct_action_invocation_ledger"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_direct_action_invocations",
        sa.Column("reconciliation_resolution", sa.String(48), nullable=False, server_default=""),
    )
    op.add_column(
        "ai_direct_action_invocations",
        sa.Column("reconciled_by_user_id", sa.String(64), nullable=False, server_default=""),
    )
    op.add_column(
        "ai_direct_action_invocations",
        sa.Column("reconciled_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_ai_direct_action_invocations_reconciliation_resolution",
        "ai_direct_action_invocations",
        ["reconciliation_resolution"],
    )
    op.create_index(
        "ix_ai_direct_action_invocations_reconciled_by_user_id",
        "ai_direct_action_invocations",
        ["reconciled_by_user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ai_direct_action_invocations_reconciled_by_user_id",
        table_name="ai_direct_action_invocations",
    )
    op.drop_index(
        "ix_ai_direct_action_invocations_reconciliation_resolution",
        table_name="ai_direct_action_invocations",
    )
    op.drop_column("ai_direct_action_invocations", "reconciled_at")
    op.drop_column("ai_direct_action_invocations", "reconciled_by_user_id")
    op.drop_column("ai_direct_action_invocations", "reconciliation_resolution")
