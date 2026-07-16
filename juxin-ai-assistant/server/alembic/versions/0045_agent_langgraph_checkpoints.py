"""add independently committed LangGraph checkpoints

Revision ID: 0045_agent_langgraph_checkpoints
Revises: 0044_harness_spec_registry
"""

from alembic import op
import sqlalchemy as sa


revision = "0045_agent_langgraph_checkpoints"
down_revision = "0044_harness_spec_registry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")
    op.create_table(
        "ai_agent_langgraph_checkpoints",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("run_id", sa.String(36), sa.ForeignKey("ai_agent_runs.uuid", ondelete="CASCADE"), nullable=False),
        sa.Column("thread_id", sa.String(64), nullable=False),
        sa.Column("checkpoint_ns", sa.String(255), nullable=False, server_default=""),
        sa.Column("checkpoint_id", sa.String(255), nullable=False),
        sa.Column("parent_checkpoint_id", sa.String(255), nullable=True),
        sa.Column("checkpoint_json", sa.JSON(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("pending_writes_json", sa.JSON(), nullable=True),
        sa.Column("new_versions_json", sa.JSON(), nullable=True),
        sa.Column("writer_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("fencing_token", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "run_id",
            "thread_id",
            "checkpoint_id",
            name="uq_ai_agent_langgraph_checkpoint_identity",
        ),
    )
    op.create_index("ix_ai_agent_langgraph_checkpoints_run_id", "ai_agent_langgraph_checkpoints", ["run_id"])
    op.create_index("ix_ai_agent_langgraph_checkpoints_thread_id", "ai_agent_langgraph_checkpoints", ["thread_id"])
    op.create_index("ix_ai_agent_langgraph_checkpoints_fencing_token", "ai_agent_langgraph_checkpoints", ["fencing_token"])


def downgrade() -> None:
    op.drop_index("ix_ai_agent_langgraph_checkpoints_fencing_token", table_name="ai_agent_langgraph_checkpoints")
    op.drop_index("ix_ai_agent_langgraph_checkpoints_thread_id", table_name="ai_agent_langgraph_checkpoints")
    op.drop_index("ix_ai_agent_langgraph_checkpoints_run_id", table_name="ai_agent_langgraph_checkpoints")
    op.drop_table("ai_agent_langgraph_checkpoints")
