"""learning candidates

Revision ID: 0029_learning_candidates
Revises: 0028_agent_artifacts
"""

from alembic import op
import sqlalchemy as sa

revision = "0029_learning_candidates"
down_revision = "0028_agent_artifacts"
branch_labels = None
depends_on = None

id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "ai_learning_candidates",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("owner_user_id", sa.String(64), nullable=False),
        sa.Column("source_run_id", sa.String(64), nullable=False, server_default=""),
        sa.Column("candidate_type", sa.String(48), nullable=False, server_default="correction"),
        sa.Column("title", sa.String(255), nullable=False, server_default="学习候选"),
        sa.Column("status", sa.String(24), nullable=False, server_default="draft"),
        sa.Column("payload_json", sa.JSON(), nullable=True),
        sa.Column("created_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("updated_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    for column in ["owner_user_id", "source_run_id", "candidate_type", "status"]:
        op.create_index(f"ix_ai_learning_candidates_{column}", "ai_learning_candidates", [column])


def downgrade() -> None:
    op.drop_table("ai_learning_candidates")
