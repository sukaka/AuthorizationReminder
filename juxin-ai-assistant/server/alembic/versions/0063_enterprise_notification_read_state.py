"""add owner-scoped read state for enterprise in-app notifications

Revision ID: 0063_enterprise_notification_read_state
Revises: 0062_enterprise_capability_evaluation
"""

from alembic import op
import sqlalchemy as sa


revision = "0063_enterprise_notification_read_state"
down_revision = "0062_enterprise_capability_evaluation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_workflow_notification_outbox",
        sa.Column("read_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "ai_workflow_notification_outbox",
        sa.Column("read_by_user_id", sa.String(64), nullable=True),
    )
    op.create_index(
        "ix_ai_workflow_notification_outbox_read_at",
        "ai_workflow_notification_outbox",
        ["read_at"],
    )
    op.create_index(
        "ix_ai_workflow_notification_outbox_read_by_user_id",
        "ai_workflow_notification_outbox",
        ["read_by_user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ai_workflow_notification_outbox_read_by_user_id",
        table_name="ai_workflow_notification_outbox",
    )
    op.drop_index(
        "ix_ai_workflow_notification_outbox_read_at",
        table_name="ai_workflow_notification_outbox",
    )
    op.drop_column("ai_workflow_notification_outbox", "read_by_user_id")
    op.drop_column("ai_workflow_notification_outbox", "read_at")
