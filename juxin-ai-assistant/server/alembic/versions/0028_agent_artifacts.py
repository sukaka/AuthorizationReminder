"""agent artifacts tables

Revision ID: 0028_agent_artifacts
Revises: 0027_shared_faq_lifecycle
Create Date: 2026-07-12
"""

from alembic import op
import sqlalchemy as sa

revision = "0028_agent_artifacts"
down_revision = "0027_shared_faq_lifecycle"
branch_labels = None
depends_on = None

id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "ai_artifacts",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("owner_user_id", sa.String(64), nullable=False),
        sa.Column("run_id", sa.String(64), nullable=False, server_default=""),
        sa.Column("artifact_type", sa.String(48), nullable=False, server_default="markdown"),
        sa.Column("title", sa.String(255), nullable=False, server_default="成果"),
        sa.Column("status", sa.String(24), nullable=False, server_default="ready"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("content_markdown", sa.Text(), nullable=False, server_default=""),
        sa.Column("download_ref", sa.String(1024), nullable=False, server_default=""),
        sa.Column("quality_json", sa.JSON(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    for column in ["owner_user_id", "run_id", "artifact_type", "status"]:
        op.create_index(f"ix_ai_artifacts_{column}", "ai_artifacts", [column])

    op.create_table(
        "ai_artifact_versions",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("artifact_id", sa.String(64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("content_markdown", sa.Text(), nullable=False, server_default=""),
        sa.Column("change_summary", sa.String(500), nullable=False, server_default=""),
        sa.Column("created_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
        sa.UniqueConstraint("artifact_id", "version"),
    )
    op.create_index("ix_ai_artifact_versions_artifact_id", "ai_artifact_versions", ["artifact_id"])


def downgrade() -> None:
    op.drop_table("ai_artifact_versions")
    op.drop_table("ai_artifacts")
