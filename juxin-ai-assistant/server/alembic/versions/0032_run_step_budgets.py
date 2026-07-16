"""add per-step run budgets

Revision ID: 0032_run_step_budgets
Revises: 0031_agent_egress_cost
"""

from alembic import op
import sqlalchemy as sa


revision = "0032_run_step_budgets"
down_revision = "0031_agent_egress_cost"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("ai_agent_runs") as batch:
        batch.add_column(sa.Column("max_step_tool_calls", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("max_step_tokens", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("max_step_latency_ms", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    with op.batch_alter_table("ai_agent_runs") as batch:
        batch.drop_column("max_step_latency_ms")
        batch.drop_column("max_step_tokens")
        batch.drop_column("max_step_tool_calls")
