"""knowledge document types

Revision ID: 0013_knowledge_document_types
Revises: 0012_knowledge_categories
Create Date: 2026-07-02
"""

from alembic import op
import sqlalchemy as sa


revision = "0013_knowledge_document_types"
down_revision = "0012_knowledge_categories"
branch_labels = None
depends_on = None


id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


DEFAULT_DOCUMENT_TYPES = [
    "产品白皮书",
    "解决方案",
    "投标模板",
    "交付说明",
    "测试报告",
    "安全服务报告",
    "会议记录",
    "提示词手册",
    "其他",
]


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
    if _has_table("ai_knowledge_document_types"):
        return

    op.create_table(
        "ai_knowledge_document_types",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="ACTIVE"),
        sa.Column("created_by", sa.String(length=64), nullable=False, server_default="system"),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    with op.batch_alter_table("ai_knowledge_document_types") as batch_op:
        batch_op.create_index(batch_op.f("ix_ai_knowledge_document_types_name"), ["name"])
        batch_op.create_index(batch_op.f("ix_ai_knowledge_document_types_sort_order"), ["sort_order"])
        batch_op.create_index(batch_op.f("ix_ai_knowledge_document_types_status"), ["status"])
        batch_op.create_index(batch_op.f("ix_ai_knowledge_document_types_created_by"), ["created_by"])
        batch_op.alter_column("sort_order", existing_type=sa.Integer(), server_default=None)
        batch_op.alter_column("status", existing_type=sa.String(length=16), server_default=None)
        batch_op.alter_column("created_by", existing_type=sa.String(length=64), server_default=None)

    values = [
        {
            "uuid": f"system-document-type-{index}",
            "name": name,
            "sort_order": index * 10,
            "status": "ACTIVE",
            "created_by": "system",
        }
        for index, name in enumerate(DEFAULT_DOCUMENT_TYPES, start=1)
    ]
    op.bulk_insert(
        sa.table(
            "ai_knowledge_document_types",
            sa.column("uuid", sa.String(length=36)),
            sa.column("name", sa.String(length=64)),
            sa.column("sort_order", sa.Integer()),
            sa.column("status", sa.String(length=16)),
            sa.column("created_by", sa.String(length=64)),
        ),
        values,
    )


def downgrade() -> None:
    if _has_table("ai_knowledge_document_types"):
        op.drop_table("ai_knowledge_document_types")
