"""add project task, deliverable, issue, and activity tables

Revision ID: 0050_project_task_delivery_activity
Revises: 0049_project_context_resources
"""

from alembic import op
import sqlalchemy as sa


revision = "0050_project_task_delivery_activity"
down_revision = "0049_project_context_resources"
branch_labels = None
depends_on = None


id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    ]


def _create_project_table(
    name: str,
    columns: list[sa.Column],
    indexes: list[str],
) -> None:
    op.create_table(
        name,
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        *columns,
        *_timestamps(),
    )
    for column in indexes:
        op.create_index(f"ix_{name}_{column}", name, [column])


def upgrade() -> None:
    _create_project_table(
        "ai_project_tasks",
        [
            sa.Column("project_id", id_type, sa.ForeignKey("ai_projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(24), nullable=False, server_default="todo"),
            sa.Column("priority", sa.String(16), nullable=False, server_default="normal"),
            sa.Column("assignee_user_id", sa.String(64), nullable=False, server_default=""),
            sa.Column("due_at", sa.DateTime(), nullable=True),
            sa.Column("created_by", sa.String(64), nullable=False),
        ],
        ["project_id", "status", "priority", "assignee_user_id", "created_by"],
    )
    _create_project_table(
        "ai_project_deliverables",
        [
            sa.Column("project_id", id_type, sa.ForeignKey("ai_projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("task_id", id_type, sa.ForeignKey("ai_project_tasks.id", ondelete="SET NULL"), nullable=True),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("deliverable_type", sa.String(48), nullable=False, server_default="document"),
            sa.Column("status", sa.String(24), nullable=False, server_default="draft"),
            sa.Column("content_summary", sa.Text(), nullable=False, server_default=""),
            sa.Column("file_name", sa.String(255), nullable=False, server_default=""),
            sa.Column("file_ref", sa.String(1024), nullable=False, server_default=""),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("submitted_by", sa.String(64), nullable=False, server_default=""),
            sa.Column("approved_by", sa.String(64), nullable=False, server_default=""),
            sa.Column("approved_at", sa.DateTime(), nullable=True),
            sa.Column("created_by", sa.String(64), nullable=False),
        ],
        ["project_id", "task_id", "deliverable_type", "status", "created_by"],
    )
    _create_project_table(
        "ai_project_issues",
        [
            sa.Column("project_id", id_type, sa.ForeignKey("ai_projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(24), nullable=False, server_default="open"),
            sa.Column("severity", sa.String(16), nullable=False, server_default="medium"),
            sa.Column("assignee_user_id", sa.String(64), nullable=False, server_default=""),
            sa.Column("resolution", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_by", sa.String(64), nullable=False),
            sa.Column("resolved_by", sa.String(64), nullable=False, server_default=""),
            sa.Column("resolved_at", sa.DateTime(), nullable=True),
        ],
        ["project_id", "status", "severity", "assignee_user_id", "created_by"],
    )
    _create_project_table(
        "ai_project_activities",
        [
            sa.Column("project_id", id_type, sa.ForeignKey("ai_projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("actor_user_id", sa.String(64), nullable=False),
            sa.Column("action", sa.String(96), nullable=False),
            sa.Column("entity_type", sa.String(48), nullable=False),
            sa.Column("entity_uuid", sa.String(36), nullable=False, server_default=""),
            sa.Column("summary", sa.String(500), nullable=False, server_default=""),
            sa.Column("metadata_json", sa.JSON(), nullable=True),
        ],
        ["project_id", "actor_user_id", "action", "entity_type", "entity_uuid"],
    )


def downgrade() -> None:
    for name in (
        "ai_project_activities",
        "ai_project_issues",
        "ai_project_deliverables",
        "ai_project_tasks",
    ):
        for column in {
            "ai_project_activities": ["entity_uuid", "entity_type", "action", "actor_user_id", "project_id"],
            "ai_project_issues": ["created_by", "assignee_user_id", "severity", "status", "project_id"],
            "ai_project_deliverables": ["created_by", "status", "deliverable_type", "task_id", "project_id"],
            "ai_project_tasks": ["created_by", "assignee_user_id", "priority", "status", "project_id"],
        }[name]:
            op.drop_index(f"ix_{name}_{column}", table_name=name)
        op.drop_table(name)
