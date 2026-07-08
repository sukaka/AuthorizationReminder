"""prompt catalog rollouts

Revision ID: 0006_prompt_catalog_rollouts
Revises: 0005_task_document_metadata
Create Date: 2026-06-23
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0006_prompt_catalog_rollouts"
down_revision: Union[str, None] = "0005_task_document_metadata"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_prompt_catalog_rollouts",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            primary_key=True,
            autoincrement=True,
        ),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column(
            "force_config",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
        sa.Column("target_json", sa.JSON(), nullable=False),
        sa.Column("frozen_tasks_json", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "token",
            name="uq_ai_prompt_catalog_rollouts_token",
        ),
    )
    op.create_index(
        "ix_ai_prompt_catalog_rollouts_status",
        "ai_prompt_catalog_rollouts",
        ["status"],
    )
    with op.batch_alter_table("ai_task_prompt_bindings") as batch_op:
        batch_op.add_column(
            sa.Column(
                "rollout_token",
                sa.String(length=64),
                nullable=True,
            )
        )
        batch_op.create_index(
            "ix_ai_task_prompt_bindings_rollout_token",
            ["rollout_token"],
        )


def downgrade() -> None:
    with op.batch_alter_table("ai_task_prompt_bindings") as batch_op:
        batch_op.drop_index(
            "ix_ai_task_prompt_bindings_rollout_token"
        )
        batch_op.drop_column("rollout_token")
    op.drop_index(
        "ix_ai_prompt_catalog_rollouts_status",
        table_name="ai_prompt_catalog_rollouts",
    )
    op.drop_table("ai_prompt_catalog_rollouts")
