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


def upgrade() -> None:
    op.alter_column(
        "ai_long_tasks",
        "request_ciphertext",
        existing_type=sa.LargeBinary(),
        type_=mysql.MEDIUMBLOB(),
        existing_nullable=False,
    )
    op.alter_column(
        "ai_long_tasks",
        "draft_ciphertext",
        existing_type=sa.LargeBinary(),
        type_=mysql.MEDIUMBLOB(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "ai_long_tasks",
        "draft_ciphertext",
        existing_type=mysql.MEDIUMBLOB(),
        type_=sa.LargeBinary(),
        existing_nullable=False,
    )
    op.alter_column(
        "ai_long_tasks",
        "request_ciphertext",
        existing_type=mysql.MEDIUMBLOB(),
        type_=sa.LargeBinary(),
        existing_nullable=False,
    )
