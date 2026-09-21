"""expand encrypted long-task payload storage

Revision ID: 0069_long_task_payload_mediumblob
Revises: 0067_project_member_usernames
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import mysql


revision = "0069_long_task_payload_mediumblob"
down_revision = "0067_project_member_usernames"
branch_labels = None
depends_on = None


_LONG_TASK_PAYLOAD_TYPE = sa.LargeBinary().with_variant(mysql.MEDIUMBLOB(), "mysql")


def upgrade() -> None:
    with op.batch_alter_table("ai_long_tasks") as batch_op:
        batch_op.alter_column(
            "request_ciphertext",
            existing_type=sa.LargeBinary(),
            type_=_LONG_TASK_PAYLOAD_TYPE,
            existing_nullable=False,
        )
        batch_op.alter_column(
            "draft_ciphertext",
            existing_type=sa.LargeBinary(),
            type_=_LONG_TASK_PAYLOAD_TYPE,
            existing_nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("ai_long_tasks") as batch_op:
        batch_op.alter_column(
            "draft_ciphertext",
            existing_type=_LONG_TASK_PAYLOAD_TYPE,
            type_=sa.LargeBinary(),
            existing_nullable=False,
        )
        batch_op.alter_column(
            "request_ciphertext",
            existing_type=_LONG_TASK_PAYLOAD_TYPE,
            type_=sa.LargeBinary(),
            existing_nullable=False,
        )
