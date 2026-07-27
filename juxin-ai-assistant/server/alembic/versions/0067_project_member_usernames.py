"""store project member username snapshots

Revision ID: 0067_project_member_usernames
Revises: 0066_skill_uploads
"""

from alembic import op
import sqlalchemy as sa


revision = "0067_project_member_usernames"
down_revision = "0066_skill_uploads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_project_members",
        sa.Column("username", sa.String(length=128), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("ai_project_members", "username")
