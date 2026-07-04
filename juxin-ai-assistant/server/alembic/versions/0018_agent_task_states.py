"""agent task states

Revision ID: 0018_agent_task_states
Revises: 0017_learning_loop
Create Date: 2026-07-05
"""

from alembic import op
import sqlalchemy as sa


revision = "0018_agent_task_states"
down_revision = "0017_learning_loop"
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
    if _has_table("ai_agent_task_states"):
        return
    op.create_table(
        "ai_agent_task_states",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("conversation_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("stage", sa.String(length=64), nullable=False, server_default="analyzing"),
        sa.Column("goal", sa.Text(), nullable=False),
        sa.Column("selected_sources_json", sa.JSON(), nullable=True),
        sa.Column("tool_calls_json", sa.JSON(), nullable=True),
        sa.Column("verification_status", sa.String(length=32), nullable=False, server_default="pending"),
        sa.Column("verification_json", sa.JSON(), nullable=True),
        sa.Column("next_action", sa.String(length=256), nullable=False, server_default=""),
        sa.Column("stage_history_json", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="active"),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    with op.batch_alter_table("ai_agent_task_states") as batch_op:
        batch_op.create_index(batch_op.f("ix_ai_agent_task_states_user_id"), ["user_id"])
        batch_op.create_index(batch_op.f("ix_ai_agent_task_states_conversation_id"), ["conversation_id"])
        batch_op.create_index(batch_op.f("ix_ai_agent_task_states_stage"), ["stage"])
        batch_op.create_index(batch_op.f("ix_ai_agent_task_states_verification_status"), ["verification_status"])
        batch_op.create_index(batch_op.f("ix_ai_agent_task_states_status"), ["status"])
        batch_op.alter_column("conversation_id", existing_type=sa.String(length=64), server_default=None)
        batch_op.alter_column("stage", existing_type=sa.String(length=64), server_default=None)
        batch_op.alter_column("verification_status", existing_type=sa.String(length=32), server_default=None)
        batch_op.alter_column("next_action", existing_type=sa.String(length=256), server_default=None)
        batch_op.alter_column("status", existing_type=sa.String(length=24), server_default=None)


def downgrade() -> None:
    if _has_table("ai_agent_task_states"):
        op.drop_table("ai_agent_task_states")
