"""add external customer support handoff tickets

Revision ID: 0040_external_support_tickets
Revises: 0039_external_customer_question_reports
"""

from alembic import op
import sqlalchemy as sa


revision = "0040_external_support_tickets"
down_revision = "0039_external_customer_question_reports"
branch_labels = None
depends_on = None

id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "ai_external_support_tickets",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("external_question_event_id", id_type, nullable=False),
        sa.Column("source_channel", sa.String(32), nullable=False),
        sa.Column("conversation_key", sa.String(128), nullable=False, server_default=""),
        sa.Column("reason_code", sa.String(32), nullable=False, server_default="NO_EVIDENCE"),
        sa.Column("status", sa.String(24), nullable=False, server_default="PENDING"),
        sa.Column("priority", sa.String(16), nullable=False, server_default="NORMAL"),
        sa.Column("assigned_to", sa.String(64), nullable=False, server_default=""),
        sa.Column("claimed_at", sa.DateTime(), nullable=True),
        sa.Column("replied_at", sa.DateTime(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        sa.Column("recipient_ciphertext", sa.LargeBinary(), nullable=True),
        sa.Column("recipient_nonce", sa.LargeBinary(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.ForeignKeyConstraint(["external_question_event_id"], ["ai_external_question_events.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
        sa.UniqueConstraint("external_question_event_id"),
    )
    for column in ["external_question_event_id", "source_channel", "conversation_key", "reason_code", "status", "priority", "assigned_to"]:
        op.create_index(f"ix_ai_external_support_tickets_{column}", "ai_external_support_tickets", [column])
    op.create_table(
        "ai_external_support_ticket_messages",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("ticket_id", id_type, nullable=False),
        sa.Column("sender_type", sa.String(16), nullable=False, server_default="ENGINEER"),
        sa.Column("sender_id", sa.String(64), nullable=False, server_default=""),
        sa.Column("message_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("message_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("delivery_status", sa.String(24), nullable=False, server_default="STORED"),
        sa.Column("delivered_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.ForeignKeyConstraint(["ticket_id"], ["ai_external_support_tickets.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    for column in ["ticket_id", "sender_type", "sender_id", "delivery_status"]:
        op.create_index(f"ix_ai_external_support_ticket_messages_{column}", "ai_external_support_ticket_messages", [column])


def downgrade() -> None:
    op.drop_table("ai_external_support_ticket_messages")
    op.drop_table("ai_external_support_tickets")
