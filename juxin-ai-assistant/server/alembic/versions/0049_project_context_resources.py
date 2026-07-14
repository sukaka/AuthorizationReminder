"""add project knowledge, memory, and artifact associations

Revision ID: 0049_project_context_resources
Revises: 0048_project_initialization_foundation
"""

from alembic import op
import sqlalchemy as sa


revision = "0049_project_context_resources"
down_revision = "0048_project_initialization_foundation"
branch_labels = None
depends_on = None


id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    ]


def _create_association_table(
    name: str,
    target_table: str,
    target_column: str,
    unique_name: str,
) -> None:
    op.create_table(
        name,
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("project_id", id_type, sa.ForeignKey("ai_projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column(target_column, id_type, sa.ForeignKey(f"{target_table}.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("linked_by", sa.String(64), nullable=False),
        *_timestamps(),
        sa.UniqueConstraint("project_id", target_column, name=unique_name),
    )
    op.create_index(f"ix_{name}_project_id", name, ["project_id"])
    op.create_index(f"ix_{name}_{target_column}", name, [target_column])
    op.create_index(f"ix_{name}_status", name, ["status"])
    op.create_index(f"ix_{name}_linked_by", name, ["linked_by"])


def upgrade() -> None:
    op.create_table(
        "ai_project_memories",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("project_id", id_type, sa.ForeignKey("ai_projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("memory_type", sa.String(48), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tags_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("source", sa.String(32), nullable=False, server_default="human"),
        sa.Column("confirmation_status", sa.String(32), nullable=False, server_default="active"),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("confirmed_by", sa.String(64), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        *_timestamps(),
    )
    for column in ("project_id", "memory_type", "priority", "status", "source", "confirmation_status", "created_by"):
        op.create_index(f"ix_ai_project_memories_{column}", "ai_project_memories", [column])
    _create_association_table(
        "ai_project_files",
        "ai_knowledge_files",
        "knowledge_file_id",
        "uq_ai_project_files_project_file",
    )
    op.add_column("ai_project_files", sa.Column("category", sa.String(64), nullable=False, server_default="项目资料"))
    op.create_index("ix_ai_project_files_category", "ai_project_files", ["category"])
    _create_association_table(
        "ai_project_artifacts",
        "ai_work_artifacts",
        "artifact_id",
        "uq_ai_project_artifacts_project_artifact",
    )


def downgrade() -> None:
    op.drop_index("ix_ai_project_artifacts_linked_by", table_name="ai_project_artifacts")
    op.drop_index("ix_ai_project_artifacts_status", table_name="ai_project_artifacts")
    op.drop_index("ix_ai_project_artifacts_artifact_id", table_name="ai_project_artifacts")
    op.drop_index("ix_ai_project_artifacts_project_id", table_name="ai_project_artifacts")
    op.drop_table("ai_project_artifacts")
    op.drop_index("ix_ai_project_files_category", table_name="ai_project_files")
    op.drop_index("ix_ai_project_files_linked_by", table_name="ai_project_files")
    op.drop_index("ix_ai_project_files_status", table_name="ai_project_files")
    op.drop_index("ix_ai_project_files_knowledge_file_id", table_name="ai_project_files")
    op.drop_index("ix_ai_project_files_project_id", table_name="ai_project_files")
    op.drop_table("ai_project_files")
    for column in ("created_by", "confirmation_status", "source", "status", "priority", "memory_type", "project_id"):
        op.drop_index(f"ix_ai_project_memories_{column}", table_name="ai_project_memories")
    op.drop_table("ai_project_memories")
