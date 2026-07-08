"""chat session lifecycle

Revision ID: 0010_chat_session_lifecycle
Revises: 0009_chat_word_exports
Create Date: 2026-06-27
"""

from alembic import op
import sqlalchemy as sa


revision = "0010_chat_session_lifecycle"
down_revision = "0009_chat_word_exports"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {
        column["name"] for column in inspector.get_columns(table_name)
    }


def upgrade() -> None:
    with op.batch_alter_table("ai_chat_sessions") as batch_op:
        if not _has_column("ai_chat_sessions", "archived_at"):
            batch_op.add_column(sa.Column("archived_at", sa.DateTime(), nullable=True))
        if not _has_column("ai_chat_sessions", "deleted_at"):
            batch_op.add_column(sa.Column("deleted_at", sa.DateTime(), nullable=True))
        if not _has_column("ai_chat_sessions", "hard_deleted_at"):
            batch_op.add_column(sa.Column("hard_deleted_at", sa.DateTime(), nullable=True))
        batch_op.alter_column(
            "status",
            existing_type=sa.String(length=24),
            server_default="active",
            existing_nullable=False,
        )

    connection = op.get_bind()
    connection.execute(
        sa.text(
            "UPDATE ai_chat_sessions SET status = CASE "
            "WHEN status = 'ACTIVE' THEN 'active' "
            "WHEN status = 'DELETED' THEN 'deleted' "
            "WHEN status = 'ARCHIVED' THEN 'archived' "
            "ELSE status END"
        )
    )


def downgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text(
            "UPDATE ai_chat_sessions SET status = CASE "
            "WHEN status = 'active' THEN 'ACTIVE' "
            "WHEN status = 'deleted' THEN 'DELETED' "
            "WHEN status = 'archived' THEN 'ARCHIVED' "
            "ELSE status END"
        )
    )
    with op.batch_alter_table("ai_chat_sessions") as batch_op:
        batch_op.alter_column(
            "status",
            existing_type=sa.String(length=24),
            server_default="ACTIVE",
            existing_nullable=False,
        )
        if _has_column("ai_chat_sessions", "hard_deleted_at"):
            batch_op.drop_column("hard_deleted_at")
        if _has_column("ai_chat_sessions", "deleted_at"):
            batch_op.drop_column("deleted_at")
        if _has_column("ai_chat_sessions", "archived_at"):
            batch_op.drop_column("archived_at")
