"""hot question reports

Revision ID: 0025_hot_question_reports
Revises: 0024_shared_faqs
Create Date: 2026-07-11
"""

from alembic import op
import sqlalchemy as sa


revision = "0025_hot_question_reports"
down_revision = "0024_shared_faqs"
branch_labels = None
depends_on = None

id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "ai_hot_question_report_items",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("period_type", sa.String(16), nullable=False),
        sa.Column("period_start", sa.DateTime(), nullable=False),
        sa.Column("period_end", sa.DateTime(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("question_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("question_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("question_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("samples_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("samples_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("reply_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("reply_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("analysis_summary", sa.Text(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="pending"),
        sa.Column("reviewed_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
        sa.UniqueConstraint("period_type", "period_start", "period_end", "rank"),
    )
    op.create_index("ix_hot_questions_period_type", "ai_hot_question_report_items", ["period_type"])
    op.create_index("ix_hot_questions_period_start", "ai_hot_question_report_items", ["period_start"])
    op.create_index("ix_hot_questions_period_end", "ai_hot_question_report_items", ["period_end"])
    op.create_index("ix_hot_questions_status", "ai_hot_question_report_items", ["status"])


def downgrade() -> None:
    op.drop_table("ai_hot_question_report_items")
