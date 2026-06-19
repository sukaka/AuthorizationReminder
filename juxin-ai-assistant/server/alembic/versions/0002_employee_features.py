"""employee features

Revision ID: 0002_employee_features
Revises: 0001_foundation
Create Date: 2026-06-19 22:50:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0002_employee_features"
down_revision: Union[str, None] = "0001_foundation"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _id_type() -> sa.types.TypeEngine:
    return sa.BigInteger().with_variant(sa.Integer(), "sqlite")


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
    inspector = sa.inspect(op.get_bind())
    generation_columns = {
        item["name"]
        for item in inspector.get_columns("ai_generation_records")
    }
    generation_foreign_keys = {
        item.get("name")
        for item in inspector.get_foreign_keys("ai_generation_records")
    }
    generation_indexes = {
        item["name"]
        for item in inspector.get_indexes("ai_generation_records")
    }
    with op.batch_alter_table("ai_generation_records") as batch_op:
        if "parent_generation_id" not in generation_columns:
            batch_op.add_column(
                sa.Column("parent_generation_id", _id_type(), nullable=True)
            )
        if "finished_at" not in generation_columns:
            batch_op.add_column(
                sa.Column("finished_at", sa.DateTime(), nullable=True)
            )
        if "error_message_safe" not in generation_columns:
            batch_op.add_column(
                sa.Column("error_message_safe", sa.Text(), nullable=True)
            )
        if "knowledge_refs_json" not in generation_columns:
            batch_op.add_column(
                sa.Column("knowledge_refs_json", sa.JSON(), nullable=True)
            )
        if (
            "fk_ai_generation_records_parent_generation_id"
            not in generation_foreign_keys
        ):
            batch_op.create_foreign_key(
                "fk_ai_generation_records_parent_generation_id",
                "ai_generation_records",
                ["parent_generation_id"],
                ["id"],
                ondelete="SET NULL",
            )
        if (
            "ix_ai_generation_records_parent_generation_id"
            not in generation_indexes
        ):
            batch_op.create_index(
                "ix_ai_generation_records_parent_generation_id",
                ["parent_generation_id"],
                unique=False,
            )

    op.execute(
        sa.text(
            "UPDATE ai_generation_records "
            "SET error_message_safe = '' "
            "WHERE error_message_safe IS NULL"
        )
    )
    op.execute(
        sa.text(
            "UPDATE ai_generation_records "
            "SET knowledge_refs_json = :empty_json "
            "WHERE knowledge_refs_json IS NULL"
        ).bindparams(empty_json="[]")
    )
    with op.batch_alter_table("ai_generation_records") as batch_op:
        batch_op.alter_column(
            "error_message_safe",
            existing_type=sa.Text(),
            nullable=False,
        )
        batch_op.alter_column(
            "knowledge_refs_json",
            existing_type=sa.JSON(),
            nullable=False,
        )

    op.create_table(
        "ai_knowledge_items",
        sa.Column("id", _id_type(), autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=64), nullable=False),
        sa.Column("tags_json", sa.JSON(), nullable=False),
        sa.Column("keywords_json", sa.JSON(), nullable=False),
        sa.Column("content_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("content_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("key_version", sa.String(length=32), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("updated_by", sa.String(length=64), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    op.create_index(
        "ix_ai_knowledge_items_category",
        "ai_knowledge_items",
        ["category"],
        unique=False,
    )
    op.create_index(
        "ix_ai_knowledge_items_status",
        "ai_knowledge_items",
        ["status"],
        unique=False,
    )

    op.create_table(
        "ai_knowledge_task_links",
        sa.Column("id", _id_type(), autoincrement=True, nullable=False),
        sa.Column("knowledge_id", _id_type(), nullable=False),
        sa.Column("task_id", _id_type(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["knowledge_id"],
            ["ai_knowledge_items.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["task_id"], ["ai_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("knowledge_id", "task_id"),
    )
    op.create_index(
        "ix_ai_knowledge_task_links_knowledge_id",
        "ai_knowledge_task_links",
        ["knowledge_id"],
        unique=False,
    )
    op.create_index(
        "ix_ai_knowledge_task_links_task_id",
        "ai_knowledge_task_links",
        ["task_id"],
        unique=False,
    )

    op.create_table(
        "ai_feedback_records",
        sa.Column("id", _id_type(), autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("generation_id", _id_type(), nullable=False),
        sa.Column("sso_user_id", sa.String(length=64), nullable=False),
        sa.Column("feedback_type", sa.String(length=32), nullable=False),
        sa.Column("content_ciphertext", sa.LargeBinary(), nullable=True),
        sa.Column("content_nonce", sa.LargeBinary(), nullable=True),
        sa.Column("key_version", sa.String(length=32), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["generation_id"],
            ["ai_generation_records.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("generation_id", "sso_user_id", "feedback_type"),
        sa.UniqueConstraint("uuid"),
    )
    op.create_index(
        "ix_ai_feedback_records_generation_id",
        "ai_feedback_records",
        ["generation_id"],
        unique=False,
    )
    op.create_index(
        "ix_ai_feedback_records_sso_user_id",
        "ai_feedback_records",
        ["sso_user_id"],
        unique=False,
    )

    op.create_table(
        "ai_user_favorites",
        sa.Column("id", _id_type(), autoincrement=True, nullable=False),
        sa.Column("sso_user_id", sa.String(length=64), nullable=False),
        sa.Column("task_id", _id_type(), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(["task_id"], ["ai_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sso_user_id", "task_id"),
    )
    op.create_index(
        "ix_ai_user_favorites_sso_user_id",
        "ai_user_favorites",
        ["sso_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_ai_user_favorites_task_id",
        "ai_user_favorites",
        ["task_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_table("ai_user_favorites")
    op.drop_table("ai_feedback_records")
    op.drop_table("ai_knowledge_task_links")
    op.drop_table("ai_knowledge_items")

    with op.batch_alter_table("ai_generation_records") as batch_op:
        batch_op.drop_index("ix_ai_generation_records_parent_generation_id")
        batch_op.drop_constraint(
            "fk_ai_generation_records_parent_generation_id",
            type_="foreignkey",
        )
        batch_op.drop_column("knowledge_refs_json")
        batch_op.drop_column("error_message_safe")
        batch_op.drop_column("finished_at")
        batch_op.drop_column("parent_generation_id")
