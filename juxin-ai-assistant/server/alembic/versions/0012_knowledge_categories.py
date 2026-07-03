"""knowledge categories

Revision ID: 0012_knowledge_categories
Revises: 0011_knowledge_document_management
Create Date: 2026-07-01
"""

from alembic import op
import sqlalchemy as sa


revision = "0012_knowledge_categories"
down_revision = "0011_knowledge_document_management"
branch_labels = None
depends_on = None


id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
    ]


def upgrade() -> None:
    if _has_table("ai_knowledge_categories"):
        return

    op.create_table(
        "ai_knowledge_categories",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("parent_id", id_type, nullable=True),
        sa.Column("scope", sa.String(length=24), nullable=False, server_default="company"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="ACTIVE"),
        sa.Column("created_by", sa.String(length=64), nullable=False, server_default="system"),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["parent_id"], ["ai_knowledge_categories.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    with op.batch_alter_table("ai_knowledge_categories") as batch_op:
        batch_op.create_index(batch_op.f("ix_ai_knowledge_categories_name"), ["name"])
        batch_op.create_index(batch_op.f("ix_ai_knowledge_categories_parent_id"), ["parent_id"])
        batch_op.create_index(batch_op.f("ix_ai_knowledge_categories_scope"), ["scope"])
        batch_op.create_index(batch_op.f("ix_ai_knowledge_categories_sort_order"), ["sort_order"])
        batch_op.create_index(batch_op.f("ix_ai_knowledge_categories_status"), ["status"])
        batch_op.create_index(batch_op.f("ix_ai_knowledge_categories_created_by"), ["created_by"])
        batch_op.alter_column("scope", existing_type=sa.String(length=24), server_default=None)
        batch_op.alter_column("sort_order", existing_type=sa.Integer(), server_default=None)
        batch_op.alter_column("status", existing_type=sa.String(length=16), server_default=None)
        batch_op.alter_column("created_by", existing_type=sa.String(length=64), server_default=None)


def downgrade() -> None:
    if _has_table("ai_knowledge_categories"):
        op.drop_table("ai_knowledge_categories")
