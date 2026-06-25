"""task templates and attachments

Revision ID: 0007_task_templates_and_attachments
Revises: 0006_prompt_catalog_rollouts
Create Date: 2026-06-25
"""

from alembic import op
import sqlalchemy as sa


revision = "0007_task_templates_and_attachments"
down_revision = "0006_prompt_catalog_rollouts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("ai_tasks") as batch_op:
        batch_op.add_column(
            sa.Column(
                "document_template_code",
                sa.String(length=64),
                nullable=False,
                server_default="",
            )
        )
        batch_op.add_column(sa.Column("output_schema_json", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("attachment_policy_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("ai_tasks") as batch_op:
        batch_op.drop_column("attachment_policy_json")
        batch_op.drop_column("output_schema_json")
        batch_op.drop_column("document_template_code")
