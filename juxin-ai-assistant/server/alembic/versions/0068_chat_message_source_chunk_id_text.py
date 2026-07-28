"""allow full URL values in chat message source chunk ids

Revision ID: 0068_chat_message_source_chunk_id_text
Revises: 0067_agent_tool_calls_reconciliation_fields
"""

from alembic import op
import sqlalchemy as sa


revision = "0068_chat_message_source_chunk_id_text"
down_revision = "0067_agent_tool_calls_reconciliation_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "ai_chat_message_sources",
        "chunk_id",
        existing_type=sa.String(length=64),
        type_=sa.Text(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "ai_chat_message_sources",
        "chunk_id",
        existing_type=sa.Text(),
        type_=sa.String(length=64),
        existing_nullable=False,
    )
