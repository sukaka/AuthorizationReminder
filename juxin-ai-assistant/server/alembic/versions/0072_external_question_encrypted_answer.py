"""Store external customer-service answers encrypted for idempotent replay.

Revision ID: 0072_external_answer_cipher
Revises: 0070_chat_message_source_section_title_text
"""

from alembic import op
import sqlalchemy as sa


revision = "0072_external_answer_cipher"
down_revision = "0070_chat_message_source_section_title_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_external_question_events",
        sa.Column("answer_ciphertext", sa.LargeBinary(), nullable=True),
    )
    op.add_column(
        "ai_external_question_events",
        sa.Column("answer_nonce", sa.LargeBinary(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ai_external_question_events", "answer_nonce")
    op.drop_column("ai_external_question_events", "answer_ciphertext")
