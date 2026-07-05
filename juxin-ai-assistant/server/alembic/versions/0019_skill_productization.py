"""skill productization

Revision ID: 0019_skill_productization
Revises: 0018_agent_task_states
Create Date: 2026-07-05
"""

from alembic import op
import sqlalchemy as sa


revision = "0019_skill_productization"
down_revision = "0018_agent_task_states"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_skill_run_logs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(length=36), nullable=False, unique=True),
        sa.Column("skill_id", sa.String(length=96), nullable=False, index=True),
        sa.Column("skill_version", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("task_id", sa.String(length=96), nullable=False, server_default="", index=True),
        sa.Column("user_id", sa.String(length=64), nullable=False, index=True),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="running", index=True),
        sa.Column("tools_used_json", sa.JSON(), nullable=False),
        sa.Column("input_summary_json", sa.JSON(), nullable=False),
        sa.Column("output_summary_json", sa.JSON(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "ai_skill_reviews",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(length=36), nullable=False, unique=True),
        sa.Column("skill_id", sa.String(length=96), nullable=False, index=True),
        sa.Column("version", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("submitter_id", sa.String(length=64), nullable=False, server_default="", index=True),
        sa.Column("reviewer_id", sa.String(length=64), nullable=False, server_default="", index=True),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="pending", index=True),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("ai_skill_reviews")
    op.drop_table("ai_skill_run_logs")
