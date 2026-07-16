"""add durable agent run state contract fields

Revision ID: 0037_agent_run_state_contract
Revises: 0036_wechat_external_access
"""

from alembic import op
import sqlalchemy as sa


revision = "0037_agent_run_state_contract"
down_revision = "0036_wechat_external_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("ai_agent_runs") as batch:
        batch.add_column(sa.Column("state_schema_version", sa.String(16), nullable=False, server_default="0"))
        batch.add_column(sa.Column("state_revision", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("lease_owner", sa.String(128), nullable=False, server_default=""))
        batch.add_column(sa.Column("lease_expires_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("fencing_token", sa.Integer(), nullable=False, server_default="0"))
    op.create_index("ix_ai_agent_runs_state_schema_version", "ai_agent_runs", ["state_schema_version"])
    op.create_index("ix_ai_agent_runs_lease_owner", "ai_agent_runs", ["lease_owner"])
    op.create_index("ix_ai_agent_runs_lease_expires_at", "ai_agent_runs", ["lease_expires_at"])


def downgrade() -> None:
    op.drop_index("ix_ai_agent_runs_lease_expires_at", table_name="ai_agent_runs")
    op.drop_index("ix_ai_agent_runs_lease_owner", table_name="ai_agent_runs")
    op.drop_index("ix_ai_agent_runs_state_schema_version", table_name="ai_agent_runs")
    with op.batch_alter_table("ai_agent_runs") as batch:
        batch.drop_column("fencing_token")
        batch.drop_column("lease_expires_at")
        batch.drop_column("lease_owner")
        batch.drop_column("state_revision")
        batch.drop_column("state_schema_version")
