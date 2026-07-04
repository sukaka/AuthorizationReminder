"""learning loop libraries

Revision ID: 0017_learning_loop
Revises: 0016_user_memories
Create Date: 2026-07-04
"""

from alembic import op
import sqlalchemy as sa


revision = "0017_learning_loop"
down_revision = "0016_user_memories"
branch_labels = None
depends_on = None


id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


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


def _uuid_column() -> sa.Column:
    return sa.Column("uuid", sa.String(length=36), nullable=False)


def upgrade() -> None:
    if _has_table("ai_user_memories"):
        with op.batch_alter_table("ai_user_memories") as batch_op:
            if not _has_column("ai_user_memories", "title"):
                batch_op.add_column(sa.Column("title", sa.String(length=128), nullable=False, server_default=""))
            if not _has_column("ai_user_memories", "priority"):
                batch_op.add_column(sa.Column("priority", sa.String(length=16), nullable=False, server_default="medium"))
            if not _has_column("ai_user_memories", "tags_json"):
                batch_op.add_column(sa.Column("tags_json", sa.JSON(), nullable=True))
        with op.batch_alter_table("ai_user_memories") as batch_op:
            if _has_column("ai_user_memories", "priority"):
                batch_op.create_index(batch_op.f("ix_ai_user_memories_priority"), ["priority"])
                batch_op.alter_column("title", existing_type=sa.String(length=128), server_default=None)
                batch_op.alter_column("priority", existing_type=sa.String(length=16), server_default=None)

    if not _has_table("ai_experience_library"):
        op.create_table(
            "ai_experience_library",
            sa.Column("id", id_type, autoincrement=True, nullable=False),
            _uuid_column(),
            sa.Column("user_id", sa.String(length=64), nullable=False),
            sa.Column("task_type", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("title", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("question", sa.Text(), nullable=False),
            sa.Column("answer", sa.Text(), nullable=False),
            sa.Column("summary", sa.Text(), nullable=False),
            sa.Column("tags_json", sa.JSON(), nullable=True),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="active"),
            *_timestamps(),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("uuid"),
        )
        with op.batch_alter_table("ai_experience_library") as batch_op:
            batch_op.create_index(batch_op.f("ix_ai_experience_library_user_id"), ["user_id"])
            batch_op.create_index(batch_op.f("ix_ai_experience_library_task_type"), ["task_type"])
            batch_op.create_index(batch_op.f("ix_ai_experience_library_status"), ["status"])
            batch_op.alter_column("task_type", existing_type=sa.String(length=64), server_default=None)
            batch_op.alter_column("title", existing_type=sa.String(length=128), server_default=None)
            batch_op.alter_column("status", existing_type=sa.String(length=24), server_default=None)

    if not _has_table("ai_template_library"):
        op.create_table(
            "ai_template_library",
            sa.Column("id", id_type, autoincrement=True, nullable=False),
            _uuid_column(),
            sa.Column("user_id", sa.String(length=64), nullable=False),
            sa.Column("template_name", sa.String(length=128), nullable=False),
            sa.Column("task_type", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("template_content", sa.Text(), nullable=False),
            sa.Column("variables_json", sa.JSON(), nullable=True),
            sa.Column("scope", sa.String(length=24), nullable=False, server_default="personal"),
            sa.Column("review_status", sa.String(length=24), nullable=False, server_default="draft"),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="active"),
            *_timestamps(),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("uuid"),
        )
        with op.batch_alter_table("ai_template_library") as batch_op:
            batch_op.create_index(batch_op.f("ix_ai_template_library_user_id"), ["user_id"])
            batch_op.create_index(batch_op.f("ix_ai_template_library_task_type"), ["task_type"])
            batch_op.create_index(batch_op.f("ix_ai_template_library_scope"), ["scope"])
            batch_op.create_index(batch_op.f("ix_ai_template_library_review_status"), ["review_status"])
            batch_op.create_index(batch_op.f("ix_ai_template_library_status"), ["status"])
            batch_op.alter_column("task_type", existing_type=sa.String(length=64), server_default=None)
            batch_op.alter_column("scope", existing_type=sa.String(length=24), server_default=None)
            batch_op.alter_column("review_status", existing_type=sa.String(length=24), server_default=None)
            batch_op.alter_column("status", existing_type=sa.String(length=24), server_default=None)

    if not _has_table("ai_failure_case_library"):
        op.create_table(
            "ai_failure_case_library",
            sa.Column("id", id_type, autoincrement=True, nullable=False),
            _uuid_column(),
            sa.Column("user_id", sa.String(length=64), nullable=False),
            sa.Column("task_type", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("wrong_answer", sa.Text(), nullable=False),
            sa.Column("correction", sa.Text(), nullable=False),
            sa.Column("prevention_rule", sa.Text(), nullable=False),
            sa.Column("tags_json", sa.JSON(), nullable=True),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="active"),
            *_timestamps(),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("uuid"),
        )
        with op.batch_alter_table("ai_failure_case_library") as batch_op:
            batch_op.create_index(batch_op.f("ix_ai_failure_case_library_user_id"), ["user_id"])
            batch_op.create_index(batch_op.f("ix_ai_failure_case_library_task_type"), ["task_type"])
            batch_op.create_index(batch_op.f("ix_ai_failure_case_library_status"), ["status"])
            batch_op.alter_column("task_type", existing_type=sa.String(length=64), server_default=None)
            batch_op.alter_column("status", existing_type=sa.String(length=24), server_default=None)

    if not _has_table("ai_feedback_logs"):
        op.create_table(
            "ai_feedback_logs",
            sa.Column("id", id_type, autoincrement=True, nullable=False),
            _uuid_column(),
            sa.Column("user_id", sa.String(length=64), nullable=False),
            sa.Column("conversation_id", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("message_id", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("feedback_type", sa.String(length=32), nullable=False),
            sa.Column("comment", sa.Text(), nullable=False),
            sa.Column("saved_as", sa.String(length=32), nullable=False, server_default=""),
            *_timestamps(),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("uuid"),
        )
        with op.batch_alter_table("ai_feedback_logs") as batch_op:
            batch_op.create_index(batch_op.f("ix_ai_feedback_logs_user_id"), ["user_id"])
            batch_op.create_index(batch_op.f("ix_ai_feedback_logs_conversation_id"), ["conversation_id"])
            batch_op.create_index(batch_op.f("ix_ai_feedback_logs_message_id"), ["message_id"])
            batch_op.alter_column("conversation_id", existing_type=sa.String(length=64), server_default=None)
            batch_op.alter_column("message_id", existing_type=sa.String(length=64), server_default=None)
            batch_op.alter_column("saved_as", existing_type=sa.String(length=32), server_default=None)


def downgrade() -> None:
    for table_name in [
        "ai_feedback_logs",
        "ai_failure_case_library",
        "ai_template_library",
        "ai_experience_library",
    ]:
        if _has_table(table_name):
            op.drop_table(table_name)
    if _has_table("ai_user_memories"):
        with op.batch_alter_table("ai_user_memories") as batch_op:
            for column_name in ["tags_json", "priority", "title"]:
                if _has_column("ai_user_memories", column_name):
                    batch_op.drop_column(column_name)
