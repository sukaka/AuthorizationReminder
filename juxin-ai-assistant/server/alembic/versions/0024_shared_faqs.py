"""shared faqs

Revision ID: 0024_shared_faqs
Revises: 0023_assistant_mode_governance
"""

from alembic import op
import sqlalchemy as sa

revision = "0024_shared_faqs"
down_revision = "0023_assistant_mode_governance"
branch_labels = None
depends_on = None

id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "ai_shared_faqs",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("question", sa.String(500), nullable=False),
        sa.Column("question_normalized", sa.String(500), nullable=False),
        sa.Column("aliases_json", sa.JSON(), nullable=True),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("match_threshold", sa.Float(), nullable=False, server_default="0.88"),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("hit_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_hit_at", sa.DateTime(), nullable=True),
        sa.Column("created_by", sa.String(64), nullable=False, server_default="system"),
        sa.Column("updated_by", sa.String(64), nullable=False, server_default="system"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    op.create_index("ix_ai_shared_faqs_question_normalized", "ai_shared_faqs", ["question_normalized"], unique=True)
    op.create_index("ix_ai_shared_faqs_status", "ai_shared_faqs", ["status"])


def downgrade() -> None:
    op.drop_table("ai_shared_faqs")
