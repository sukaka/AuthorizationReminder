"""channel jobs

Revision ID: 0030_channel_jobs
Revises: 0029_learning_candidates
"""

from alembic import op
import sqlalchemy as sa

revision = "0030_channel_jobs"
down_revision = "0029_learning_candidates"
branch_labels = None
depends_on = None

id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "ai_channel_jobs",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("channel", sa.String(32), nullable=False, server_default="web"),
        sa.Column("job_key", sa.String(128), nullable=False, server_default=""),
        sa.Column("external_user_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("thread_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("status", sa.String(24), nullable=False, server_default="queued"),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("run_id", sa.String(64), nullable=False, server_default=""),
        sa.Column("payload_json", sa.JSON(), nullable=True),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=False, server_default=""),
        sa.Column("next_retry_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    for column in ["channel", "job_key", "external_user_id", "status", "run_id"]:
        op.create_index(f"ix_ai_channel_jobs_{column}", "ai_channel_jobs", [column])


def downgrade() -> None:
    op.drop_table("ai_channel_jobs")
