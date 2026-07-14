"""add project workspace foundation and membership ACL

Revision ID: 0046_project_workspace_foundation
Revises: 0045_agent_langgraph_checkpoints
"""

from alembic import op
import sqlalchemy as sa


revision = "0046_project_workspace_foundation"
down_revision = "0045_agent_langgraph_checkpoints"
branch_labels = None
depends_on = None


def upgrade() -> None:
    id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")
    op.create_table(
        "ai_projects",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("owner_user_id", sa.String(64), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_ai_projects_status", "ai_projects", ["status"])
    op.create_index("ix_ai_projects_owner_user_id", "ai_projects", ["owner_user_id"])
    op.create_index("ix_ai_projects_created_by", "ai_projects", ["created_by"])

    op.create_table(
        "ai_project_members",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column(
            "project_id",
            id_type,
            sa.ForeignKey("ai_projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("user_id", sa.String(64), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("invited_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "project_id",
            "user_id",
            name="uq_ai_project_members_project_user",
        ),
    )
    op.create_index("ix_ai_project_members_project_id", "ai_project_members", ["project_id"])
    op.create_index("ix_ai_project_members_user_id", "ai_project_members", ["user_id"])
    op.create_index("ix_ai_project_members_role", "ai_project_members", ["role"])
    op.create_index("ix_ai_project_members_status", "ai_project_members", ["status"])


def downgrade() -> None:
    op.drop_index("ix_ai_project_members_status", table_name="ai_project_members")
    op.drop_index("ix_ai_project_members_role", table_name="ai_project_members")
    op.drop_index("ix_ai_project_members_user_id", table_name="ai_project_members")
    op.drop_index("ix_ai_project_members_project_id", table_name="ai_project_members")
    op.drop_table("ai_project_members")
    op.drop_index("ix_ai_projects_created_by", table_name="ai_projects")
    op.drop_index("ix_ai_projects_owner_user_id", table_name="ai_projects")
    op.drop_index("ix_ai_projects_status", table_name="ai_projects")
    op.drop_table("ai_projects")
