"""governance tables

Revision ID: 0003_governance
Revises: 0002_employee_features
Create Date: 2026-06-20 13:30:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0003_governance"
down_revision: Union[str, None] = "0002_employee_features"
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
    op.add_column(
        "ai_tasks",
        sa.Column(
            "ever_active",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    op.execute(
        sa.text(
            "UPDATE ai_tasks SET ever_active = 1 WHERE status <> 'DRAFT'"
        )
    )

    op.create_table(
        "ai_task_suggestions",
        sa.Column("id", _id_type(), autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("sso_user_id", sa.String(length=64), nullable=False),
        sa.Column("department_code", sa.String(length=128), nullable=False),
        sa.Column("suggestion_type", sa.String(length=32), nullable=False),
        sa.Column("task_id", _id_type(), nullable=True),
        sa.Column("content_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("content_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("key_version", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("reviewed_by", sa.String(length=64), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("review_comment_ciphertext", sa.LargeBinary(), nullable=True),
        sa.Column("review_comment_nonce", sa.LargeBinary(), nullable=True),
        *_timestamps(),
        sa.ForeignKeyConstraint(["task_id"], ["ai_tasks.id"], ondelete="SET NULL"),
        sa.CheckConstraint(
            "content_ciphertext IS NOT NULL AND content_nonce IS NOT NULL",
            name="ck_ai_task_suggestions_content_pair",
        ),
        sa.CheckConstraint(
            "(review_comment_ciphertext IS NULL AND "
            "review_comment_nonce IS NULL) OR "
            "(review_comment_ciphertext IS NOT NULL AND "
            "review_comment_nonce IS NOT NULL)",
            name="ck_ai_task_suggestions_review_comment_pair",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    op.create_index(
        "ix_ai_task_suggestions_sso_user_id",
        "ai_task_suggestions",
        ["sso_user_id"],
    )
    op.create_index(
        "ix_ai_task_suggestions_department_code",
        "ai_task_suggestions",
        ["department_code"],
    )
    op.create_index(
        "ix_ai_task_suggestions_task_id",
        "ai_task_suggestions",
        ["task_id"],
    )
    op.create_index(
        "ix_ai_task_suggestions_status",
        "ai_task_suggestions",
        ["status"],
    )

    op.create_table(
        "ai_system_settings",
        sa.Column("id", _id_type(), autoincrement=True, nullable=False),
        sa.Column("setting_key", sa.String(length=96), nullable=False),
        sa.Column("value_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("updated_by", sa.String(length=64), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("setting_key"),
    )
    op.create_index(
        "ix_ai_system_settings_status",
        "ai_system_settings",
        ["status"],
    )

    op.create_table(
        "ai_audit_logs",
        sa.Column("id", _id_type(), autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("sso_user_id", sa.String(length=64), nullable=False),
        sa.Column("username_snapshot", sa.String(length=128), nullable=False),
        sa.Column("action", sa.String(length=96), nullable=False),
        sa.Column("entity_type", sa.String(length=64), nullable=False),
        sa.Column("entity_uuid", sa.String(length=64), nullable=False),
        sa.Column("result", sa.String(length=16), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("ip_hash", sa.String(length=64), nullable=False),
        sa.Column("user_agent_hash", sa.String(length=64), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    op.create_index(
        "ix_ai_audit_logs_sso_user_id",
        "ai_audit_logs",
        ["sso_user_id"],
    )
    op.create_index(
        "ix_ai_audit_logs_action",
        "ai_audit_logs",
        ["action"],
    )
    op.create_index(
        "idx_ai_audit_created",
        "ai_audit_logs",
        ["created_at"],
    )
    op.create_index(
        "idx_ai_audit_entity",
        "ai_audit_logs",
        ["entity_type", "entity_uuid", "created_at"],
    )


def downgrade() -> None:
    op.drop_table("ai_audit_logs")
    op.drop_table("ai_system_settings")
    op.drop_table("ai_task_suggestions")
    op.drop_column("ai_tasks", "ever_active")
