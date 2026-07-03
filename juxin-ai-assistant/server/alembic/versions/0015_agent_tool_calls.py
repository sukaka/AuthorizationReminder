"""agent tool calls

Revision ID: 0015_agent_tool_calls
Revises: 0014_web_sources
Create Date: 2026-07-04
"""

from alembic import op
import sqlalchemy as sa


revision = "0015_agent_tool_calls"
down_revision = "0014_web_sources"
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
    if _has_table("ai_agent_tool_calls"):
        return
    op.create_table(
        "ai_agent_tool_calls",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("message_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("conversation_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("mode", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("tool_name", sa.String(length=96), nullable=False),
        sa.Column("tool_version", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="success"),
        sa.Column("permission", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("input_summary_json", sa.JSON(), nullable=False),
        sa.Column("output_summary_json", sa.JSON(), nullable=False),
        sa.Column("error_code", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("error_message_safe", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    with op.batch_alter_table("ai_agent_tool_calls") as batch_op:
        batch_op.create_index(batch_op.f("ix_ai_agent_tool_calls_run_id"), ["run_id"])
        batch_op.create_index(batch_op.f("ix_ai_agent_tool_calls_message_id"), ["message_id"])
        batch_op.create_index(batch_op.f("ix_ai_agent_tool_calls_user_id"), ["user_id"])
        batch_op.create_index(batch_op.f("ix_ai_agent_tool_calls_conversation_id"), ["conversation_id"])
        batch_op.create_index(batch_op.f("ix_ai_agent_tool_calls_mode"), ["mode"])
        batch_op.create_index(batch_op.f("ix_ai_agent_tool_calls_tool_name"), ["tool_name"])
        batch_op.create_index(batch_op.f("ix_ai_agent_tool_calls_status"), ["status"])
        batch_op.create_index(batch_op.f("ix_ai_agent_tool_calls_error_code"), ["error_code"])
        batch_op.alter_column("run_id", existing_type=sa.String(length=64), server_default=None)
        batch_op.alter_column("message_id", existing_type=sa.String(length=64), server_default=None)
        batch_op.alter_column("conversation_id", existing_type=sa.String(length=64), server_default=None)
        batch_op.alter_column("mode", existing_type=sa.String(length=64), server_default=None)
        batch_op.alter_column("tool_version", existing_type=sa.String(length=32), server_default=None)
        batch_op.alter_column("status", existing_type=sa.String(length=24), server_default=None)
        batch_op.alter_column("permission", existing_type=sa.String(length=128), server_default=None)
        batch_op.alter_column("latency_ms", existing_type=sa.Integer(), server_default=None)
        batch_op.alter_column("source_count", existing_type=sa.Integer(), server_default=None)
        batch_op.alter_column("error_code", existing_type=sa.String(length=64), server_default=None)


def downgrade() -> None:
    if _has_table("ai_agent_tool_calls"):
        op.drop_table("ai_agent_tool_calls")
