"""long task queue

Revision ID: 0022_long_tasks
Revises: 0021_work_artifacts
Create Date: 2026-07-10
"""

from alembic import op
import sqlalchemy as sa


revision = "0022_long_tasks"
down_revision = "0021_work_artifacts"
branch_labels = None
depends_on = None


id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "ai_long_tasks",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("owner_user_id", sa.String(length=64), nullable=False),
        sa.Column("conversation_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("message_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("task_type", sa.String(length=48), nullable=False, server_default="chat_generation"),
        sa.Column("title", sa.String(length=255), nullable=False, server_default="后台任务"),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="queued"),
        sa.Column("stage", sa.String(length=64), nullable=False, server_default="queued"),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("request_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("request_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("draft_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("draft_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("key_version", sa.String(length=32), nullable=False, server_default="v1"),
        sa.Column("checkpoint_json", sa.JSON(), nullable=True),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("error_message_safe", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id"),
        sa.UniqueConstraint("uuid"),
    )
    for column in [
        "owner_user_id",
        "conversation_id",
        "message_id",
        "task_type",
        "status",
        "stage",
        "cancel_requested",
        "error_code",
    ]:
        op.create_index(f"ix_ai_long_tasks_{column}", "ai_long_tasks", [column])


def downgrade() -> None:
    op.drop_table("ai_long_tasks")
