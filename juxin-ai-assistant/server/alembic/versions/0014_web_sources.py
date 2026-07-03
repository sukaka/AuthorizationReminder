"""web sources and captures

Revision ID: 0014_web_sources
Revises: 0013_knowledge_document_types
Create Date: 2026-07-03
"""

from alembic import op
import sqlalchemy as sa


revision = "0014_web_sources"
down_revision = "0013_knowledge_document_types"
branch_labels = None
depends_on = None


id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    if not _has_table(table_name):
        return False
    inspector = sa.inspect(op.get_bind())
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


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
    if not _has_table("ai_web_captures"):
        op.create_table(
            "ai_web_captures",
            sa.Column("id", id_type, autoincrement=True, nullable=False),
            sa.Column("uuid", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=64), nullable=False),
            sa.Column("conversation_id", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("url", sa.String(length=2048), nullable=False),
            sa.Column("final_url", sa.String(length=2048), nullable=False, server_default=""),
            sa.Column("site_name", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("title", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("summary", sa.Text(), nullable=False),
            sa.Column("extracted_text", sa.Text(), nullable=False),
            sa.Column("published_at_text", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("fetched_at", sa.DateTime(), nullable=True),
            sa.Column("word_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("suggested_category", sa.String(length=64), nullable=False, server_default="个人素材"),
            sa.Column("suggested_document_type", sa.String(length=64), nullable=False, server_default="其他"),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="previewed"),
            sa.Column("save_target", sa.String(length=32), nullable=False, server_default=""),
            sa.Column("review_status", sa.String(length=24), nullable=False, server_default="none"),
            sa.Column("content_hash", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("knowledge_file_id", id_type, nullable=True),
            sa.Column("error_message", sa.Text(), nullable=False),
            *_timestamps(),
            sa.ForeignKeyConstraint(["knowledge_file_id"], ["ai_knowledge_files.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("uuid"),
        )
        with op.batch_alter_table("ai_web_captures") as batch_op:
            batch_op.create_index(batch_op.f("ix_ai_web_captures_user_id"), ["user_id"])
            batch_op.create_index(batch_op.f("ix_ai_web_captures_conversation_id"), ["conversation_id"])
            batch_op.create_index(batch_op.f("ix_ai_web_captures_status"), ["status"])
            batch_op.create_index(batch_op.f("ix_ai_web_captures_save_target"), ["save_target"])
            batch_op.create_index(batch_op.f("ix_ai_web_captures_review_status"), ["review_status"])
            batch_op.create_index(batch_op.f("ix_ai_web_captures_content_hash"), ["content_hash"])
            batch_op.create_index(batch_op.f("ix_ai_web_captures_knowledge_file_id"), ["knowledge_file_id"])
            batch_op.alter_column("conversation_id", existing_type=sa.String(length=64), server_default=None)
            batch_op.alter_column("final_url", existing_type=sa.String(length=2048), server_default=None)
            batch_op.alter_column("site_name", existing_type=sa.String(length=128), server_default=None)
            batch_op.alter_column("title", existing_type=sa.String(length=255), server_default=None)
            batch_op.alter_column("published_at_text", existing_type=sa.String(length=64), server_default=None)
            batch_op.alter_column("word_count", existing_type=sa.Integer(), server_default=None)
            batch_op.alter_column("suggested_category", existing_type=sa.String(length=64), server_default=None)
            batch_op.alter_column("suggested_document_type", existing_type=sa.String(length=64), server_default=None)
            batch_op.alter_column("status", existing_type=sa.String(length=24), server_default=None)
            batch_op.alter_column("save_target", existing_type=sa.String(length=32), server_default=None)
            batch_op.alter_column("review_status", existing_type=sa.String(length=24), server_default=None)
            batch_op.alter_column("content_hash", existing_type=sa.String(length=64), server_default=None)

    if _has_table("ai_knowledge_files"):
        with op.batch_alter_table("ai_knowledge_files") as batch_op:
            if not _has_column("ai_knowledge_files", "source_origin"):
                batch_op.add_column(sa.Column("source_origin", sa.String(length=32), nullable=False, server_default="upload"))
            if not _has_column("ai_knowledge_files", "web_capture_id"):
                batch_op.add_column(sa.Column("web_capture_id", sa.String(length=36), nullable=False, server_default=""))
            if not _has_column("ai_knowledge_files", "source_url"):
                batch_op.add_column(sa.Column("source_url", sa.String(length=2048), nullable=False, server_default=""))
        with op.batch_alter_table("ai_knowledge_files") as batch_op:
            if _has_column("ai_knowledge_files", "source_origin"):
                batch_op.create_index(batch_op.f("ix_ai_knowledge_files_source_origin"), ["source_origin"])
            if _has_column("ai_knowledge_files", "web_capture_id"):
                batch_op.create_index(batch_op.f("ix_ai_knowledge_files_web_capture_id"), ["web_capture_id"])
            batch_op.alter_column("source_origin", existing_type=sa.String(length=32), server_default=None)
            batch_op.alter_column("web_capture_id", existing_type=sa.String(length=36), server_default=None)
            batch_op.alter_column("source_url", existing_type=sa.String(length=2048), server_default=None)

    if not _has_table("ai_web_search_logs"):
        op.create_table(
            "ai_web_search_logs",
            sa.Column("id", id_type, autoincrement=True, nullable=False),
            sa.Column("user_id", sa.String(length=64), nullable=False),
            sa.Column("conversation_id", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("query", sa.Text(), nullable=False),
            sa.Column("provider", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="pending"),
            sa.Column("result_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("result_urls_json", sa.JSON(), nullable=False),
            sa.Column("used_urls_json", sa.JSON(), nullable=False),
            sa.Column("answer_message_id", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("error_message", sa.Text(), nullable=False),
            *_timestamps(),
            sa.PrimaryKeyConstraint("id"),
        )
        with op.batch_alter_table("ai_web_search_logs") as batch_op:
            batch_op.create_index(batch_op.f("ix_ai_web_search_logs_user_id"), ["user_id"])
            batch_op.create_index(batch_op.f("ix_ai_web_search_logs_conversation_id"), ["conversation_id"])
            batch_op.create_index(batch_op.f("ix_ai_web_search_logs_status"), ["status"])
            batch_op.create_index(batch_op.f("ix_ai_web_search_logs_answer_message_id"), ["answer_message_id"])
            batch_op.alter_column("conversation_id", existing_type=sa.String(length=64), server_default=None)
            batch_op.alter_column("provider", existing_type=sa.String(length=64), server_default=None)
            batch_op.alter_column("status", existing_type=sa.String(length=24), server_default=None)
            batch_op.alter_column("result_count", existing_type=sa.Integer(), server_default=None)
            batch_op.alter_column("answer_message_id", existing_type=sa.String(length=64), server_default=None)

    if not _has_table("ai_search_cache"):
        op.create_table(
            "ai_search_cache",
            sa.Column("id", id_type, autoincrement=True, nullable=False),
            sa.Column("cache_key", sa.String(length=128), nullable=False),
            sa.Column("provider", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("query", sa.Text(), nullable=False),
            sa.Column("payload_json", sa.JSON(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=True),
            *_timestamps(),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("cache_key"),
        )
        with op.batch_alter_table("ai_search_cache") as batch_op:
            batch_op.create_index(batch_op.f("ix_ai_search_cache_provider"), ["provider"])
            batch_op.create_index(batch_op.f("ix_ai_search_cache_expires_at"), ["expires_at"])
            batch_op.alter_column("provider", existing_type=sa.String(length=64), server_default=None)


def downgrade() -> None:
    if _has_table("ai_knowledge_files"):
        with op.batch_alter_table("ai_knowledge_files") as batch_op:
            if _has_column("ai_knowledge_files", "web_capture_id"):
                batch_op.drop_index(batch_op.f("ix_ai_knowledge_files_web_capture_id"))
            if _has_column("ai_knowledge_files", "source_origin"):
                batch_op.drop_index(batch_op.f("ix_ai_knowledge_files_source_origin"))
            if _has_column("ai_knowledge_files", "source_url"):
                batch_op.drop_column("source_url")
            if _has_column("ai_knowledge_files", "web_capture_id"):
                batch_op.drop_column("web_capture_id")
            if _has_column("ai_knowledge_files", "source_origin"):
                batch_op.drop_column("source_origin")
    for table_name in ("ai_search_cache", "ai_web_search_logs", "ai_web_captures"):
        if _has_table(table_name):
            op.drop_table(table_name)
