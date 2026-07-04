"""user memories

Revision ID: 0016_user_memories
Revises: 0015_agent_tool_calls
Create Date: 2026-07-04
"""

from alembic import op
import sqlalchemy as sa


revision = "0016_user_memories"
down_revision = "0015_agent_tool_calls"
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
    if _has_table("ai_user_memories"):
        return
    op.create_table(
        "ai_user_memories",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("sso_user_id", sa.String(length=64), nullable=False),
        sa.Column("memory_type", sa.String(length=32), nullable=False, server_default="preference"),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="active"),
        sa.Column("source", sa.String(length=64), nullable=False, server_default="assistant"),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    with op.batch_alter_table("ai_user_memories") as batch_op:
        batch_op.create_index(batch_op.f("ix_ai_user_memories_sso_user_id"), ["sso_user_id"])
        batch_op.create_index(batch_op.f("ix_ai_user_memories_memory_type"), ["memory_type"])
        batch_op.create_index(batch_op.f("ix_ai_user_memories_status"), ["status"])
        batch_op.alter_column("memory_type", existing_type=sa.String(length=32), server_default=None)
        batch_op.alter_column("status", existing_type=sa.String(length=24), server_default=None)
        batch_op.alter_column("source", existing_type=sa.String(length=64), server_default=None)


def downgrade() -> None:
    if _has_table("ai_user_memories"):
        op.drop_table("ai_user_memories")
