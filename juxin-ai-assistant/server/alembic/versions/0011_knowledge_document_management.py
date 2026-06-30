"""knowledge document management

Revision ID: 0011_knowledge_document_management
Revises: 0010_chat_session_lifecycle
Create Date: 2026-06-28
"""

from alembic import op
import sqlalchemy as sa


revision = "0011_knowledge_document_management"
down_revision = "0010_chat_session_lifecycle"
branch_labels = None
depends_on = None


id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column_name in {
        column["name"] for column in inspector.get_columns(table_name)
    }


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


def _add_column_if_missing(batch_op, table_name: str, column: sa.Column) -> None:
    if not _has_column(table_name, column.name):
        batch_op.add_column(column)


def upgrade() -> None:
    if not _has_table("ai_knowledge_bases"):
        op.create_table(
            "ai_knowledge_bases",
            sa.Column("id", id_type, autoincrement=True, nullable=False),
            sa.Column("uuid", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=128), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("scope", sa.String(length=24), nullable=False, server_default="company"),
            sa.Column("owner_user_id", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("department_id", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("project_id", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("created_by", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("deleted_at", sa.DateTime(), nullable=True),
            *_timestamps(),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("uuid"),
        )
        with op.batch_alter_table("ai_knowledge_bases") as batch_op:
            batch_op.create_index(batch_op.f("ix_ai_knowledge_bases_scope"), ["scope"])
            batch_op.create_index(batch_op.f("ix_ai_knowledge_bases_owner_user_id"), ["owner_user_id"])
            batch_op.create_index(batch_op.f("ix_ai_knowledge_bases_department_id"), ["department_id"])
            batch_op.create_index(batch_op.f("ix_ai_knowledge_bases_project_id"), ["project_id"])
            batch_op.create_index(batch_op.f("ix_ai_knowledge_bases_created_by"), ["created_by"])
            batch_op.alter_column("scope", existing_type=sa.String(length=24), server_default=None)
            batch_op.alter_column("owner_user_id", existing_type=sa.String(length=64), server_default=None)
            batch_op.alter_column("department_id", existing_type=sa.String(length=64), server_default=None)
            batch_op.alter_column("project_id", existing_type=sa.String(length=64), server_default=None)
            batch_op.alter_column("created_by", existing_type=sa.String(length=64), server_default=None)

    with op.batch_alter_table("ai_knowledge_files") as batch_op:
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("knowledge_base_id", id_type, nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("original_file_name", sa.String(length=255), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("stored_file_name", sa.String(length=255), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("file_path", sa.String(length=1024), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("category", sa.String(length=64), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("document_type", sa.String(length=64), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("tags_json", sa.JSON(), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("summary", sa.Text(), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("parse_status", sa.String(length=24), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("index_status", sa.String(length=24), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("source_type", sa.String(length=24), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("usage_type", sa.String(length=32), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("review_status", sa.String(length=24), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("rag_enabled", sa.Boolean(), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("reference_enabled", sa.Boolean(), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("rag_scope", sa.String(length=24), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("permission_scope", sa.String(length=24), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("owner_user_id", sa.String(length=64), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("conversation_id", sa.String(length=64), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("version", sa.Integer(), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("parent_file_id", id_type, nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("is_current_version", sa.Boolean(), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("replaced_by_file_id", id_type, nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("uploaded_by", sa.String(length=64), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("reviewed_by", sa.String(length=64), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("reviewed_at", sa.DateTime(), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("review_comment", sa.Text(), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("archived_at", sa.DateTime(), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("deleted_at", sa.DateTime(), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("hard_deleted_at", sa.DateTime(), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("last_used_at", sa.DateTime(), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_files", sa.Column("usage_count", sa.Integer(), nullable=True))

    connection = op.get_bind()
    connection.execute(sa.text(
        "UPDATE ai_knowledge_files SET "
        "original_file_name = COALESCE(original_file_name, file_name), "
        "stored_file_name = COALESCE(stored_file_name, ''), "
        "file_path = COALESCE(file_path, ''), "
        "category = COALESCE(category, '个人素材'), "
        "document_type = COALESCE(document_type, '其他'), "
        "summary = COALESCE(summary, ''), "
        "parse_status = COALESCE(parse_status, 'parsed'), "
        "index_status = COALESCE(index_status, 'indexed'), "
        "source_type = COALESCE(source_type, 'user_upload'), "
        "usage_type = COALESCE(usage_type, 'personal_reference'), "
        "review_status = COALESCE(review_status, 'draft'), "
        "rag_enabled = COALESCE(rag_enabled, 0), "
        "reference_enabled = COALESCE(reference_enabled, 1), "
        "rag_scope = COALESCE(rag_scope, 'personal'), "
        "permission_scope = COALESCE(permission_scope, 'private'), "
        "owner_user_id = COALESCE(owner_user_id, sso_user_id), "
        "conversation_id = COALESCE(conversation_id, ''), "
        "version = COALESCE(version, 1), "
        "is_current_version = COALESCE(is_current_version, 1), "
        "uploaded_by = COALESCE(uploaded_by, sso_user_id), "
        "reviewed_by = COALESCE(reviewed_by, ''), "
        "review_comment = COALESCE(review_comment, ''), "
        "usage_count = COALESCE(usage_count, 0)"
    ))

    with op.batch_alter_table("ai_knowledge_files") as batch_op:
        for column_name in [
            "knowledge_base_id",
            "category",
            "document_type",
            "parse_status",
            "index_status",
            "source_type",
            "usage_type",
            "review_status",
            "rag_enabled",
            "reference_enabled",
            "rag_scope",
            "permission_scope",
            "owner_user_id",
            "conversation_id",
            "is_current_version",
            "uploaded_by",
            "reviewed_by",
        ]:
            batch_op.create_index(batch_op.f(f"ix_ai_knowledge_files_{column_name}"), [column_name])

    with op.batch_alter_table("ai_knowledge_chunks") as batch_op:
        _add_column_if_missing(batch_op, "ai_knowledge_chunks", sa.Column("knowledge_base_id", id_type, nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_chunks", sa.Column("token_count", sa.Integer(), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_chunks", sa.Column("metadata_json", sa.JSON(), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_chunks", sa.Column("embedding_id", sa.String(length=128), nullable=True))
        _add_column_if_missing(batch_op, "ai_knowledge_chunks", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    connection.execute(sa.text(
        "UPDATE ai_knowledge_chunks SET "
        "token_count = COALESCE(token_count, token_estimate), "
        "embedding_id = COALESCE(embedding_id, '')"
    ))
    with op.batch_alter_table("ai_knowledge_chunks") as batch_op:
        batch_op.create_index(batch_op.f("ix_ai_knowledge_chunks_knowledge_base_id"), ["knowledge_base_id"])
        batch_op.create_index(batch_op.f("ix_ai_knowledge_chunks_embedding_id"), ["embedding_id"])

    if not _has_table("ai_knowledge_search_logs"):
        op.create_table(
            "ai_knowledge_search_logs",
            sa.Column("id", id_type, autoincrement=True, nullable=False),
            sa.Column("user_id", sa.String(length=64), nullable=False),
            sa.Column("question", sa.Text(), nullable=False),
            sa.Column("mode", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("search_type", sa.String(length=32), nullable=False),
            sa.Column("knowledge_base_ids_json", sa.JSON(), nullable=True),
            sa.Column("filters_json", sa.JSON(), nullable=True),
            sa.Column("retrieved_chunk_ids_json", sa.JSON(), nullable=True),
            sa.Column("answer_message_id", sa.String(length=64), nullable=False, server_default=""),
            *_timestamps(),
            sa.PrimaryKeyConstraint("id"),
        )
        with op.batch_alter_table("ai_knowledge_search_logs") as batch_op:
            batch_op.create_index(batch_op.f("ix_ai_knowledge_search_logs_user_id"), ["user_id"])
            batch_op.create_index(batch_op.f("ix_ai_knowledge_search_logs_mode"), ["mode"])
            batch_op.create_index(batch_op.f("ix_ai_knowledge_search_logs_search_type"), ["search_type"])
            batch_op.create_index(batch_op.f("ix_ai_knowledge_search_logs_answer_message_id"), ["answer_message_id"])

    if not _has_table("ai_knowledge_review_logs"):
        op.create_table(
            "ai_knowledge_review_logs",
            sa.Column("id", id_type, autoincrement=True, nullable=False),
            sa.Column("file_id", id_type, nullable=False),
            sa.Column("user_id", sa.String(length=64), nullable=False),
            sa.Column("reviewer_id", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("action", sa.String(length=32), nullable=False),
            sa.Column("old_status", sa.String(length=24), nullable=False, server_default=""),
            sa.Column("new_status", sa.String(length=24), nullable=False, server_default=""),
            sa.Column("comment", sa.Text(), nullable=False),
            *_timestamps(),
            sa.ForeignKeyConstraint(["file_id"], ["ai_knowledge_files.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        with op.batch_alter_table("ai_knowledge_review_logs") as batch_op:
            batch_op.create_index(batch_op.f("ix_ai_knowledge_review_logs_file_id"), ["file_id"])
            batch_op.create_index(batch_op.f("ix_ai_knowledge_review_logs_user_id"), ["user_id"])
            batch_op.create_index(batch_op.f("ix_ai_knowledge_review_logs_reviewer_id"), ["reviewer_id"])
            batch_op.create_index(batch_op.f("ix_ai_knowledge_review_logs_action"), ["action"])


def downgrade() -> None:
    if _has_table("ai_knowledge_review_logs"):
        with op.batch_alter_table("ai_knowledge_review_logs") as batch_op:
            batch_op.drop_index(batch_op.f("ix_ai_knowledge_review_logs_action"))
            batch_op.drop_index(batch_op.f("ix_ai_knowledge_review_logs_reviewer_id"))
            batch_op.drop_index(batch_op.f("ix_ai_knowledge_review_logs_user_id"))
            batch_op.drop_index(batch_op.f("ix_ai_knowledge_review_logs_file_id"))
        op.drop_table("ai_knowledge_review_logs")

    if _has_table("ai_knowledge_search_logs"):
        with op.batch_alter_table("ai_knowledge_search_logs") as batch_op:
            batch_op.drop_index(batch_op.f("ix_ai_knowledge_search_logs_answer_message_id"))
            batch_op.drop_index(batch_op.f("ix_ai_knowledge_search_logs_search_type"))
            batch_op.drop_index(batch_op.f("ix_ai_knowledge_search_logs_mode"))
            batch_op.drop_index(batch_op.f("ix_ai_knowledge_search_logs_user_id"))
        op.drop_table("ai_knowledge_search_logs")

    with op.batch_alter_table("ai_knowledge_chunks") as batch_op:
        if _has_column("ai_knowledge_chunks", "embedding_id"):
            batch_op.drop_index(batch_op.f("ix_ai_knowledge_chunks_embedding_id"))
        if _has_column("ai_knowledge_chunks", "knowledge_base_id"):
            batch_op.drop_index(batch_op.f("ix_ai_knowledge_chunks_knowledge_base_id"))
        for column_name in ["deleted_at", "embedding_id", "metadata_json", "token_count", "knowledge_base_id"]:
            if _has_column("ai_knowledge_chunks", column_name):
                batch_op.drop_column(column_name)

    with op.batch_alter_table("ai_knowledge_files") as batch_op:
        indexed = [
            "reviewed_by",
            "uploaded_by",
            "is_current_version",
            "conversation_id",
            "owner_user_id",
            "permission_scope",
            "rag_scope",
            "reference_enabled",
            "rag_enabled",
            "review_status",
            "usage_type",
            "source_type",
            "index_status",
            "parse_status",
            "document_type",
            "category",
            "knowledge_base_id",
        ]
        for column_name in indexed:
            if _has_column("ai_knowledge_files", column_name):
                batch_op.drop_index(batch_op.f(f"ix_ai_knowledge_files_{column_name}"))
        for column_name in [
            "usage_count",
            "last_used_at",
            "hard_deleted_at",
            "deleted_at",
            "archived_at",
            "review_comment",
            "reviewed_at",
            "reviewed_by",
            "uploaded_by",
            "replaced_by_file_id",
            "is_current_version",
            "parent_file_id",
            "version",
            "conversation_id",
            "owner_user_id",
            "permission_scope",
            "rag_scope",
            "reference_enabled",
            "rag_enabled",
            "review_status",
            "usage_type",
            "source_type",
            "index_status",
            "parse_status",
            "summary",
            "tags_json",
            "document_type",
            "category",
            "file_path",
            "stored_file_name",
            "original_file_name",
            "knowledge_base_id",
        ]:
            if _has_column("ai_knowledge_files", column_name):
                batch_op.drop_column(column_name)

    if _has_table("ai_knowledge_bases"):
        with op.batch_alter_table("ai_knowledge_bases") as batch_op:
            batch_op.drop_index(batch_op.f("ix_ai_knowledge_bases_created_by"))
            batch_op.drop_index(batch_op.f("ix_ai_knowledge_bases_project_id"))
            batch_op.drop_index(batch_op.f("ix_ai_knowledge_bases_department_id"))
            batch_op.drop_index(batch_op.f("ix_ai_knowledge_bases_owner_user_id"))
            batch_op.drop_index(batch_op.f("ix_ai_knowledge_bases_scope"))
        op.drop_table("ai_knowledge_bases")
