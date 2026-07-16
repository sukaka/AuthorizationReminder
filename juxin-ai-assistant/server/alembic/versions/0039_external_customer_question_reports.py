"""add external customer question events and hot-question reports

Revision ID: 0039_external_customer_question_reports
Revises: 0038_agent_tool_invocation_ledger
"""

from alembic import op
import sqlalchemy as sa


revision = "0039_external_customer_question_reports"
down_revision = "0038_agent_tool_invocation_ledger"
branch_labels = None
depends_on = None

id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "ai_external_question_events",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("source_channel", sa.String(32), nullable=False),
        sa.Column("external_identity_hash", sa.String(64), nullable=False),
        sa.Column("conversation_key", sa.String(128), nullable=False, server_default=""),
        sa.Column("external_message_id", sa.String(128), nullable=False),
        sa.Column("question_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("question_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="RECEIVED"),
        sa.Column("source_file_ids_json", sa.JSON(), nullable=True),
        sa.Column("handoff_ticket_id", sa.String(36), nullable=False, server_default=""),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
        sa.UniqueConstraint("source_channel", "external_message_id"),
    )
    for column in ["source_channel", "external_identity_hash", "conversation_key", "external_message_id", "status", "handoff_ticket_id"]:
        op.create_index(f"ix_ai_external_question_events_{column}", "ai_external_question_events", [column])

    op.create_table(
        "ai_external_hot_question_report_items",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("period_type", sa.String(16), nullable=False),
        sa.Column("period_start", sa.DateTime(), nullable=False),
        sa.Column("period_end", sa.DateTime(), nullable=False),
        sa.Column("source_channel", sa.String(32), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("question_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("direct_answer_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("handoff_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("question_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("question_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("samples_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("samples_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("source_file_ids_json", sa.JSON(), nullable=True),
        sa.Column("analysis_summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
        sa.UniqueConstraint("period_type", "period_start", "period_end", "source_channel", "rank"),
    )
    for column in ["period_type", "period_start", "period_end", "source_channel"]:
        op.create_index(f"ix_ai_external_hot_question_report_items_{column}", "ai_external_hot_question_report_items", [column])


def downgrade() -> None:
    op.drop_table("ai_external_hot_question_report_items")
    op.drop_table("ai_external_question_events")
