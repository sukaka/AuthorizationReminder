"""add workspace scope to AI chat sessions

Revision ID: 0047_project_chat_workspace
Revises: 0046_project_workspace_foundation
"""

from alembic import op
import sqlalchemy as sa


revision = "0047_project_chat_workspace"
down_revision = "0046_project_workspace_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_chat_sessions",
        sa.Column("workspace_type", sa.String(24), nullable=False, server_default="personal"),
    )
    op.add_column(
        "ai_chat_sessions",
        sa.Column("project_uuid", sa.String(36), nullable=True),
    )
    op.create_index(
        "ix_ai_chat_sessions_workspace_type",
        "ai_chat_sessions",
        ["workspace_type"],
    )
    op.create_index(
        "ix_ai_chat_sessions_project_uuid",
        "ai_chat_sessions",
        ["project_uuid"],
    )


def downgrade() -> None:
    op.drop_index("ix_ai_chat_sessions_project_uuid", table_name="ai_chat_sessions")
    op.drop_index("ix_ai_chat_sessions_workspace_type", table_name="ai_chat_sessions")
    op.drop_column("ai_chat_sessions", "project_uuid")
    op.drop_column("ai_chat_sessions", "workspace_type")
