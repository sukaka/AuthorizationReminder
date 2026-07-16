"""add versioned workflow definitions

Revision ID: 0034_workflow_versions
Revises: 0033_artifact_reviews
"""

from alembic import op
import sqlalchemy as sa


revision = "0034_workflow_versions"
down_revision = "0033_artifact_reviews"
branch_labels = None
depends_on = None

id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "ai_workflow_definitions",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("workflow_id", sa.String(48), nullable=False),
        sa.Column("owner_user_id", sa.String(64), nullable=False),
        sa.Column("name", sa.String(128), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("current_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
        sa.UniqueConstraint("workflow_id"),
    )
    op.create_index("ix_ai_workflow_definitions_workflow_id", "ai_workflow_definitions", ["workflow_id"])
    op.create_index("ix_ai_workflow_definitions_owner_user_id", "ai_workflow_definitions", ["owner_user_id"])
    op.create_index("ix_ai_workflow_definitions_status", "ai_workflow_definitions", ["status"])
    op.create_table(
        "ai_workflow_versions",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("workflow_definition_id", id_type, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("definition_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("created_by", sa.String(64), nullable=False, server_default="system"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["workflow_definition_id"], ["ai_workflow_definitions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
        sa.UniqueConstraint("workflow_definition_id", "version"),
    )
    for column in ["workflow_definition_id", "status", "created_by"]:
        op.create_index(f"ix_ai_workflow_versions_{column}", "ai_workflow_versions", [column])


def downgrade() -> None:
    op.drop_table("ai_workflow_versions")
    op.drop_table("ai_workflow_definitions")
