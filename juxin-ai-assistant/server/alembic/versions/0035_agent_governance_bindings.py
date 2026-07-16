"""add agent governance and channel bindings

Revision ID: 0035_agent_governance_bindings
Revises: 0034_workflow_versions
"""

from alembic import op
import sqlalchemy as sa


revision = "0035_agent_governance_bindings"
down_revision = "0034_workflow_versions"
branch_labels = None
depends_on = None

id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    with op.batch_alter_table("ai_agent_connections") as batch:
        batch.add_column(sa.Column("policy_json", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("budget_json", sa.JSON(), nullable=True))
    op.create_table(
        "ai_channel_identity_bindings",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("channel", sa.String(32), nullable=False),
        sa.Column("external_user_id", sa.String(128), nullable=False),
        sa.Column("owner_user_id", sa.String(64), nullable=False),
        sa.Column("last_thread_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("uuid"),
        sa.UniqueConstraint("channel", "external_user_id"),
    )
    for column in ["channel", "external_user_id", "owner_user_id"]:
        op.create_index(f"ix_ai_channel_identity_bindings_{column}", "ai_channel_identity_bindings", [column])
    op.create_table(
        "ai_channel_message_bindings",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("identity_binding_id", id_type, nullable=False),
        sa.Column("channel", sa.String(32), nullable=False),
        sa.Column("external_message_id", sa.String(128), nullable=False),
        sa.Column("direction", sa.String(16), nullable=False),
        sa.Column("thread_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("run_id", sa.String(64), nullable=False, server_default=""),
        sa.Column("related_message_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["identity_binding_id"], ["ai_channel_identity_bindings.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("uuid"),
        sa.UniqueConstraint("channel", "external_message_id", "direction"),
    )
    for column in ["identity_binding_id", "channel", "external_message_id", "direction", "run_id"]:
        op.create_index(f"ix_ai_channel_message_bindings_{column}", "ai_channel_message_bindings", [column])


def downgrade() -> None:
    op.drop_table("ai_channel_message_bindings")
    op.drop_table("ai_channel_identity_bindings")
    with op.batch_alter_table("ai_agent_connections") as batch:
        batch.drop_column("budget_json")
        batch.drop_column("policy_json")
