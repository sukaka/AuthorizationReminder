"""add artifact review records

Revision ID: 0033_artifact_reviews
Revises: 0032_run_step_budgets
"""

from alembic import op
import sqlalchemy as sa


revision = "0033_artifact_reviews"
down_revision = "0032_run_step_budgets"
branch_labels = None
depends_on = None

id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "ai_artifact_reviews",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("artifact_id", sa.String(64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("reviewer_type", sa.String(16), nullable=False),
        sa.Column("reviewer_id", sa.String(64), nullable=False, server_default=""),
        sa.Column("decision", sa.String(24), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False, server_default=""),
        sa.Column("findings_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    for column in ["artifact_id", "reviewer_type", "reviewer_id", "decision"]:
        op.create_index(f"ix_ai_artifact_reviews_{column}", "ai_artifact_reviews", [column])


def downgrade() -> None:
    op.drop_table("ai_artifact_reviews")
