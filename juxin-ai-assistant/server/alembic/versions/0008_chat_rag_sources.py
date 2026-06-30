"""chat rag sources

Revision ID: 0008_chat_rag_sources
Revises: 0007_task_templates_and_attachments
Create Date: 2026-06-26
"""

from alembic import op
import sqlalchemy as sa


revision = "0008_chat_rag_sources"
down_revision = "0007_task_templates_and_attachments"
branch_labels = None
depends_on = None


id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _chat_rag_tables_exist() -> bool:
    return all(
        _has_table(table_name)
        for table_name in [
            "ai_knowledge_files",
            "ai_knowledge_chunks",
            "ai_chat_sessions",
            "ai_chat_messages",
            "ai_chat_message_sources",
        ]
    )


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
    if _chat_rag_tables_exist():
        return

    op.create_table(
        "ai_knowledge_files",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("sso_user_id", sa.String(length=64), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("file_type", sa.String(length=128), nullable=False),
        sa.Column("file_size", sa.Integer(), nullable=False),
        sa.Column("content_sha256", sa.String(length=64), nullable=False),
        sa.Column(
            "visibility",
            sa.String(length=24),
            nullable=False,
            server_default="PRIVATE",
        ),
        sa.Column(
            "status",
            sa.String(length=24),
            nullable=False,
            server_default="READY",
        ),
        sa.Column(
            "error_code",
            sa.String(length=64),
            nullable=False,
            server_default="",
        ),
        sa.Column("key_version", sa.String(length=32), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    with op.batch_alter_table("ai_knowledge_files") as batch_op:
        batch_op.create_index(batch_op.f("ix_ai_knowledge_files_sso_user_id"), ["sso_user_id"])
        batch_op.create_index(batch_op.f("ix_ai_knowledge_files_content_sha256"), ["content_sha256"])
        batch_op.create_index(batch_op.f("ix_ai_knowledge_files_visibility"), ["visibility"])
        batch_op.create_index(batch_op.f("ix_ai_knowledge_files_status"), ["status"])
        batch_op.alter_column("visibility", existing_type=sa.String(length=24), server_default=None)
        batch_op.alter_column("status", existing_type=sa.String(length=24), server_default=None)
        batch_op.alter_column("error_code", existing_type=sa.String(length=64), server_default=None)

    op.create_table(
        "ai_knowledge_chunks",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("chunk_id", sa.String(length=64), nullable=False),
        sa.Column("file_id", id_type, nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("chunk_text_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("chunk_text_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("section_title", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("token_estimate", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="READY"),
        *_timestamps(),
        sa.ForeignKeyConstraint(["file_id"], ["ai_knowledge_files.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("chunk_id"),
        sa.UniqueConstraint("file_id", "chunk_index"),
    )
    with op.batch_alter_table("ai_knowledge_chunks") as batch_op:
        batch_op.create_index(batch_op.f("ix_ai_knowledge_chunks_file_id"), ["file_id"])
        batch_op.create_index(batch_op.f("ix_ai_knowledge_chunks_status"), ["status"])
        batch_op.alter_column("section_title", existing_type=sa.String(length=255), server_default=None)
        batch_op.alter_column("token_estimate", existing_type=sa.Integer(), server_default=None)
        batch_op.alter_column("status", existing_type=sa.String(length=24), server_default=None)

    op.create_table(
        "ai_chat_sessions",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("sso_user_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False, server_default="新会话"),
        sa.Column("mode", sa.String(length=24), nullable=False, server_default="NORMAL"),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="ACTIVE"),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    with op.batch_alter_table("ai_chat_sessions") as batch_op:
        batch_op.create_index(batch_op.f("ix_ai_chat_sessions_sso_user_id"), ["sso_user_id"])
        batch_op.create_index(batch_op.f("ix_ai_chat_sessions_mode"), ["mode"])
        batch_op.create_index(batch_op.f("ix_ai_chat_sessions_status"), ["status"])
        batch_op.alter_column("title", existing_type=sa.String(length=255), server_default=None)
        batch_op.alter_column("mode", existing_type=sa.String(length=24), server_default=None)
        batch_op.alter_column("status", existing_type=sa.String(length=24), server_default=None)

    op.create_table(
        "ai_chat_messages",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("session_id", id_type, nullable=False),
        sa.Column("sso_user_id", sa.String(length=64), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("content_ciphertext", sa.LargeBinary(), nullable=True),
        sa.Column("content_nonce", sa.LargeBinary(), nullable=True),
        sa.Column("key_version", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="PENDING"),
        sa.Column("model_display_name", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("model_id", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("usage_json", sa.JSON(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("completion_token_hash", sa.LargeBinary(), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("error_message_safe", sa.Text(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["session_id"], ["ai_chat_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    with op.batch_alter_table("ai_chat_messages") as batch_op:
        batch_op.create_index(batch_op.f("ix_ai_chat_messages_session_id"), ["session_id"])
        batch_op.create_index(batch_op.f("ix_ai_chat_messages_sso_user_id"), ["sso_user_id"])
        batch_op.create_index(batch_op.f("ix_ai_chat_messages_role"), ["role"])
        batch_op.create_index(batch_op.f("ix_ai_chat_messages_status"), ["status"])
        batch_op.alter_column("key_version", existing_type=sa.String(length=32), server_default=None)
        batch_op.alter_column("status", existing_type=sa.String(length=24), server_default=None)
        batch_op.alter_column("model_display_name", existing_type=sa.String(length=128), server_default=None)
        batch_op.alter_column("model_id", existing_type=sa.String(length=128), server_default=None)
        batch_op.alter_column("error_code", existing_type=sa.String(length=64), server_default=None)

    op.create_table(
        "ai_chat_message_sources",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("message_id", id_type, nullable=False),
        sa.Column("source_type", sa.String(length=32), nullable=False),
        sa.Column("source_uuid", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("title", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("file_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("chunk_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("section_title", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("chunk_index", sa.Integer(), nullable=True),
        sa.Column("score", sa.Integer(), nullable=False, server_default="0"),
        *_timestamps(),
        sa.ForeignKeyConstraint(["message_id"], ["ai_chat_messages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("ai_chat_message_sources") as batch_op:
        batch_op.create_index(batch_op.f("ix_ai_chat_message_sources_message_id"), ["message_id"])
        batch_op.create_index(batch_op.f("ix_ai_chat_message_sources_source_type"), ["source_type"])
        batch_op.alter_column("source_uuid", existing_type=sa.String(length=64), server_default=None)
        batch_op.alter_column("title", existing_type=sa.String(length=255), server_default=None)
        batch_op.alter_column("file_name", existing_type=sa.String(length=255), server_default=None)
        batch_op.alter_column("chunk_id", existing_type=sa.String(length=64), server_default=None)
        batch_op.alter_column("section_title", existing_type=sa.String(length=255), server_default=None)
        batch_op.alter_column("score", existing_type=sa.Integer(), server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("ai_chat_message_sources") as batch_op:
        batch_op.drop_index(batch_op.f("ix_ai_chat_message_sources_source_type"))
        batch_op.drop_index(batch_op.f("ix_ai_chat_message_sources_message_id"))
    op.drop_table("ai_chat_message_sources")

    with op.batch_alter_table("ai_chat_messages") as batch_op:
        batch_op.drop_index(batch_op.f("ix_ai_chat_messages_status"))
        batch_op.drop_index(batch_op.f("ix_ai_chat_messages_role"))
        batch_op.drop_index(batch_op.f("ix_ai_chat_messages_sso_user_id"))
        batch_op.drop_index(batch_op.f("ix_ai_chat_messages_session_id"))
    op.drop_table("ai_chat_messages")

    with op.batch_alter_table("ai_chat_sessions") as batch_op:
        batch_op.drop_index(batch_op.f("ix_ai_chat_sessions_status"))
        batch_op.drop_index(batch_op.f("ix_ai_chat_sessions_mode"))
        batch_op.drop_index(batch_op.f("ix_ai_chat_sessions_sso_user_id"))
    op.drop_table("ai_chat_sessions")

    with op.batch_alter_table("ai_knowledge_chunks") as batch_op:
        batch_op.drop_index(batch_op.f("ix_ai_knowledge_chunks_status"))
        batch_op.drop_index(batch_op.f("ix_ai_knowledge_chunks_file_id"))
    op.drop_table("ai_knowledge_chunks")

    with op.batch_alter_table("ai_knowledge_files") as batch_op:
        batch_op.drop_index(batch_op.f("ix_ai_knowledge_files_status"))
        batch_op.drop_index(batch_op.f("ix_ai_knowledge_files_visibility"))
        batch_op.drop_index(batch_op.f("ix_ai_knowledge_files_content_sha256"))
        batch_op.drop_index(batch_op.f("ix_ai_knowledge_files_sso_user_id"))
    op.drop_table("ai_knowledge_files")
