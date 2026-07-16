"""add workflow trigger fencing and one-time wait tokens

Revision ID: 0056_workflow_fencing_and_wait_tokens
Revises: 0055_workflow_control_plane

The control-plane tables were introduced in 0055 before the dispatch lease
and wait-resume token contracts were finalized.  This migration adds the
durable fields required by the runtime without changing or rewriting existing
workflow rows.
"""

from alembic import op
import sqlalchemy as sa


revision = "0056_workflow_fencing_and_wait_tokens"
down_revision = "0055_workflow_control_plane"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use batch mode for SQLite rehearsal databases and for deployments where
    # the backend requires a table rebuild when adding a non-null column.
    with op.batch_alter_table("ai_workflow_trigger_inbox") as batch_op:
        batch_op.add_column(
            sa.Column("lease_owner", sa.String(128), nullable=False, server_default="")
        )
        batch_op.add_column(
            sa.Column("lease_token", sa.Integer(), nullable=False, server_default="0")
        )
        batch_op.add_column(sa.Column("lease_expires_at", sa.DateTime(), nullable=True))
        batch_op.create_index(
            "ix_ai_workflow_trigger_inbox_lease_owner", ["lease_owner"]
        )
        batch_op.create_index(
            "ix_ai_workflow_trigger_inbox_lease_expires_at", ["lease_expires_at"]
        )

    with op.batch_alter_table("ai_workflow_waits") as batch_op:
        batch_op.add_column(
            sa.Column(
                "resume_token_hash",
                sa.String(64),
                nullable=False,
                server_default="",
            )
        )
        batch_op.add_column(
            sa.Column("resume_expires_at", sa.DateTime(), nullable=True)
        )
        batch_op.create_index(
            "ix_ai_workflow_waits_resume_expires_at", ["resume_expires_at"]
        )


def downgrade() -> None:
    with op.batch_alter_table("ai_workflow_waits") as batch_op:
        batch_op.drop_index("ix_ai_workflow_waits_resume_expires_at")
        batch_op.drop_column("resume_expires_at")
        batch_op.drop_column("resume_token_hash")

    with op.batch_alter_table("ai_workflow_trigger_inbox") as batch_op:
        batch_op.drop_index("ix_ai_workflow_trigger_inbox_lease_expires_at")
        batch_op.drop_index("ix_ai_workflow_trigger_inbox_lease_owner")
        batch_op.drop_column("lease_expires_at")
        batch_op.drop_column("lease_token")
        batch_op.drop_column("lease_owner")
