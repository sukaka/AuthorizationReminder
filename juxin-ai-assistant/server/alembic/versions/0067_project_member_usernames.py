"""store project member username snapshots

Revision ID: 0067_project_member_usernames
Revises: 0068_chat_message_source_chunk_id_text
"""

from alembic import op
import sqlalchemy as sa


revision = "0067_project_member_usernames"
# This deployment has already applied two production hotfix migrations after
# 0066.  Keep the project-member schema update on that same linear chain.
down_revision = "0068_chat_message_source_chunk_id_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_project_members",
        sa.Column("username", sa.String(length=128), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("ai_project_members", "username")
