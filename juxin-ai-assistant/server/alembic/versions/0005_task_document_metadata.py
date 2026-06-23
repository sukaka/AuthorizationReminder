"""task document metadata

Revision ID: 0005_task_document_metadata
Revises: 0004_desktop_updates
Create Date: 2026-06-23
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005_task_document_metadata"
down_revision: Union[str, None] = "0004_desktop_updates"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("ai_tasks") as batch_op:
        batch_op.add_column(
            sa.Column(
                "source_version",
                sa.String(length=32),
                server_default="",
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "source_ref",
                sa.String(length=512),
                server_default="",
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "document_type",
                sa.String(length=32),
                server_default="PLAIN_TEXT",
                nullable=False,
            )
        )
        batch_op.add_column(
            sa.Column(
                "formal_document",
                sa.Boolean(),
                server_default=sa.false(),
                nullable=False,
            )
        )

    with op.batch_alter_table("ai_tasks") as batch_op:
        batch_op.alter_column(
            "source_version",
            existing_type=sa.String(length=32),
            server_default=None,
        )
        batch_op.alter_column(
            "source_ref",
            existing_type=sa.String(length=512),
            server_default=None,
        )
        batch_op.alter_column(
            "document_type",
            existing_type=sa.String(length=32),
            server_default=None,
        )
        batch_op.alter_column(
            "formal_document",
            existing_type=sa.Boolean(),
            server_default=None,
        )


def downgrade() -> None:
    with op.batch_alter_table("ai_tasks") as batch_op:
        batch_op.drop_column("formal_document")
        batch_op.drop_column("document_type")
        batch_op.drop_column("source_ref")
        batch_op.drop_column("source_version")
