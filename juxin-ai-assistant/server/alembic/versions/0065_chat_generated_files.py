"""persist generated file metadata on chat messages

Revision ID: 0065_chat_generated_files
Revises: 0026_agent_run_contracts
"""

from alembic import op
import sqlalchemy as sa


revision = "0065_chat_generated_files"
down_revision = "0026_agent_run_contracts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("ai_chat_messages") as batch:
        batch.add_column(sa.Column("generated_files_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("ai_chat_messages") as batch:
        batch.drop_column("generated_files_json")
