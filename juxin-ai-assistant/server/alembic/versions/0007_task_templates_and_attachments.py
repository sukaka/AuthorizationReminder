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


def _has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


def _has_column(table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return any(column["name"] == column_name for column in inspector.get_columns(table_name))


def upgrade() -> None:
    missing_task_columns = [
        column_name
        for column_name in [
            "document_template_code",
            "output_schema_json",
            "attachment_policy_json",
        ]
        if not _has_column("ai_tasks", column_name)
    ]
    if missing_task_columns:
        with op.batch_alter_table("ai_tasks") as batch_op:
            if "document_template_code" in missing_task_columns:
                batch_op.add_column(
                    sa.Column(
                        "document_template_code",
                        sa.String(length=64),
                        nullable=False,
                        server_default="",
                    )
                )
            if "output_schema_json" in missing_task_columns:
                batch_op.add_column(sa.Column("output_schema_json", sa.JSON(), nullable=True))
            if "attachment_policy_json" in missing_task_columns:
                batch_op.add_column(sa.Column("attachment_policy_json", sa.JSON(), nullable=True))

    if "document_template_code" in missing_task_columns:
        with op.batch_alter_table("ai_tasks") as batch_op:
            batch_op.alter_column(
                "document_template_code",
                existing_type=sa.String(length=64),
                server_default=None,
            )

    if not _has_table("ai_generation_attachments"):
        op.create_table(
            "ai_generation_attachments",
            sa.Column(
                "id",
                sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
                autoincrement=True,
                nullable=False,
            ),
            sa.Column("uuid", sa.String(length=36), nullable=False),
            sa.Column("sso_user_id", sa.String(length=64), nullable=False),
            sa.Column(
                "task_id",
                sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
                nullable=False,
            ),
            sa.Column(
                "generation_id",
                sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
                nullable=True,
            ),
            sa.Column("file_name", sa.String(length=255), nullable=False),
            sa.Column("file_type", sa.String(length=128), nullable=False),
            sa.Column("file_size", sa.Integer(), nullable=False),
            sa.Column("content_sha256", sa.String(length=64), nullable=False),
            sa.Column("extracted_text_ciphertext", sa.LargeBinary(), nullable=False),
            sa.Column("extracted_text_nonce", sa.LargeBinary(), nullable=False),
            sa.Column("key_version", sa.String(length=32), nullable=False),
            sa.Column(
                "status",
                sa.String(length=24),
                nullable=False,
                server_default="READY",
            ),
            sa.Column(
                "error_code",
                sa.String(length=64),
                nullable=False,
                server_default="",
            ),
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
            sa.ForeignKeyConstraint(["task_id"], ["ai_tasks.id"]),
            sa.ForeignKeyConstraint(
                ["generation_id"],
                ["ai_generation_records.id"],
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("uuid"),
        )
        with op.batch_alter_table("ai_generation_attachments") as batch_op:
            batch_op.create_index(
                batch_op.f("ix_ai_generation_attachments_generation_id"),
                ["generation_id"],
                unique=False,
            )
            batch_op.create_index(
                batch_op.f("ix_ai_generation_attachments_content_sha256"),
                ["content_sha256"],
                unique=False,
            )
            batch_op.create_index(
                batch_op.f("ix_ai_generation_attachments_sso_user_id"),
                ["sso_user_id"],
                unique=False,
            )
            batch_op.create_index(
                batch_op.f("ix_ai_generation_attachments_status"),
                ["status"],
                unique=False,
            )
            batch_op.create_index(
                batch_op.f("ix_ai_generation_attachments_task_id"),
                ["task_id"],
                unique=False,
            )

        with op.batch_alter_table("ai_generation_attachments") as batch_op:
            batch_op.alter_column(
                "status",
                existing_type=sa.String(length=24),
                server_default=None,
            )
            batch_op.alter_column(
                "error_code",
                existing_type=sa.String(length=64),
                server_default=None,
            )


def downgrade() -> None:
    with op.batch_alter_table("ai_generation_attachments") as batch_op:
        batch_op.drop_index(batch_op.f("ix_ai_generation_attachments_task_id"))
        batch_op.drop_index(batch_op.f("ix_ai_generation_attachments_status"))
        batch_op.drop_index(batch_op.f("ix_ai_generation_attachments_sso_user_id"))
        batch_op.drop_index(batch_op.f("ix_ai_generation_attachments_content_sha256"))
        batch_op.drop_index(batch_op.f("ix_ai_generation_attachments_generation_id"))
    op.drop_table("ai_generation_attachments")

    with op.batch_alter_table("ai_tasks") as batch_op:
        batch_op.drop_column("attachment_policy_json")
        batch_op.drop_column("output_schema_json")
        batch_op.drop_column("document_template_code")
