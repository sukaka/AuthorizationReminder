"""add separate external original-file download control

Revision ID: 0064_knowledge_external_download_control
Revises: 0063_enterprise_notification_read_state
"""

from alembic import op
import sqlalchemy as sa


revision = "0064_knowledge_external_download_control"
down_revision = "0063_enterprise_notification_read_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("ai_knowledge_files") as batch:
        batch.add_column(
            sa.Column("external_download_allowed", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    op.create_index(
        "ix_ai_knowledge_files_external_download_allowed",
        "ai_knowledge_files",
        ["external_download_allowed"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_ai_knowledge_files_external_download_allowed",
        table_name="ai_knowledge_files",
    )
    with op.batch_alter_table("ai_knowledge_files") as batch:
        batch.drop_column("external_download_allowed")
