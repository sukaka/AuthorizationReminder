"""assistant mode governance

Revision ID: 0023_assistant_mode_governance
Revises: 0022_long_tasks
Create Date: 2026-07-10
"""

from alembic import op
import sqlalchemy as sa


revision = "0023_assistant_mode_governance"
down_revision = "0022_long_tasks"
branch_labels = None
depends_on = None


id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    with op.batch_alter_table("ai_assistants") as batch_op:
        batch_op.add_column(sa.Column("allowed_tools_json", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("default_source_scope", sa.String(length=32), nullable=False, server_default="company"))
        batch_op.add_column(sa.Column("default_output_structure", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("word_template", sa.String(length=64), nullable=False, server_default="juxin_standard"))
        batch_op.add_column(sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
        batch_op.add_column(sa.Column("test_cases_json", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("review_status", sa.String(length=24), nullable=False, server_default="approved"))
        batch_op.create_index(batch_op.f("ix_ai_assistants_review_status"), ["review_status"])
    op.execute(
        sa.text(
            "UPDATE ai_assistants SET default_output_structure = '' "
            "WHERE default_output_structure IS NULL"
        )
    )
    with op.batch_alter_table("ai_assistants") as batch_op:
        batch_op.alter_column(
            "default_output_structure",
            existing_type=sa.Text(),
            nullable=False,
        )
    op.create_table(
        "ai_assistant_mode_versions",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("assistant_id", id_type, nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("snapshot_json", sa.JSON(), nullable=True),
        sa.Column("action", sa.String(length=32), nullable=False, server_default="update"),
        sa.Column("created_by", sa.String(length=64), nullable=False, server_default="system"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["assistant_id"], ["ai_assistants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("assistant_id", "version"),
        sa.UniqueConstraint("uuid"),
    )
    op.create_index("ix_ai_assistant_mode_versions_assistant_id", "ai_assistant_mode_versions", ["assistant_id"])
    op.create_index("ix_ai_assistant_mode_versions_action", "ai_assistant_mode_versions", ["action"])
    op.create_index("ix_ai_assistant_mode_versions_created_by", "ai_assistant_mode_versions", ["created_by"])


def downgrade() -> None:
    op.drop_table("ai_assistant_mode_versions")
    with op.batch_alter_table("ai_assistants") as batch_op:
        batch_op.drop_index(batch_op.f("ix_ai_assistants_review_status"))
        batch_op.drop_column("review_status")
        batch_op.drop_column("test_cases_json")
        batch_op.drop_column("version")
        batch_op.drop_column("word_template")
        batch_op.drop_column("default_output_structure")
        batch_op.drop_column("default_source_scope")
        batch_op.drop_column("allowed_tools_json")
