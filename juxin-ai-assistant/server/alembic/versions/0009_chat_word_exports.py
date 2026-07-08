"""chat word exports

Revision ID: 0009_chat_word_exports
Revises: 0008_chat_rag_sources
Create Date: 2026-06-27
"""

from alembic import op
import sqlalchemy as sa


revision = "0009_chat_word_exports"
down_revision = "0008_chat_rag_sources"
branch_labels = None
depends_on = None


id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    if _has_table("export_records"):
        return

    op.create_table(
        "export_records",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("conversation_id", sa.String(length=64), nullable=False),
        sa.Column("message_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_path", sa.String(length=1024), nullable=False),
        sa.Column("export_type", sa.String(length=32), nullable=False),
        sa.Column(
            "template_name",
            sa.String(length=64),
            nullable=False,
            server_default="juxin_standard",
        ),
        sa.Column("created_by", sa.String(length=64), nullable=False),
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
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    with op.batch_alter_table("export_records") as batch_op:
        batch_op.create_index(batch_op.f("ix_export_records_conversation_id"), ["conversation_id"])
        batch_op.create_index(batch_op.f("ix_export_records_message_id"), ["message_id"])
        batch_op.create_index(batch_op.f("ix_export_records_export_type"), ["export_type"])
        batch_op.create_index(batch_op.f("ix_export_records_created_by"), ["created_by"])
        batch_op.alter_column("message_id", existing_type=sa.String(length=64), server_default=None)
        batch_op.alter_column("template_name", existing_type=sa.String(length=64), server_default=None)


def downgrade() -> None:
    op.drop_table("export_records")
