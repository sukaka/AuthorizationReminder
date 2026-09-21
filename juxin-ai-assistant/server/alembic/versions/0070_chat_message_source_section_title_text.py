"""allow full URL values in chat message source section titles

Revision ID: 0070_chat_message_source_section_title_text
Revises: 0069_long_task_payload_mediumblob
"""

from alembic import op
import sqlalchemy as sa


revision = "0070_chat_message_source_section_title_text"
down_revision = "0069_long_task_payload_mediumblob"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("ai_chat_message_sources") as batch_op:
        batch_op.alter_column(
            "section_title",
            existing_type=sa.String(length=255),
            type_=sa.Text(),
            existing_nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("ai_chat_message_sources") as batch_op:
        batch_op.alter_column(
            "section_title",
            existing_type=sa.Text(),
            type_=sa.String(length=255),
            existing_nullable=False,
        )
