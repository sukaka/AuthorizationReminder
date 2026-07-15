"""work artifacts

Revision ID: 0021_work_artifacts
Revises: 0020_user_model_profiles
Create Date: 2026-07-09
"""

from alembic import op
import sqlalchemy as sa


revision = "0021_work_artifacts"
down_revision = "0020_user_model_profiles"
branch_labels = None
depends_on = None


id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _has_table(table_name: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table_name in inspector.get_table_names()


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
    if not _has_table("ai_work_artifacts"):
        op.create_table(
            "ai_work_artifacts",
            sa.Column("id", id_type, autoincrement=True, nullable=False),
            sa.Column("uuid", sa.String(length=36), nullable=False),
            sa.Column("owner_user_id", sa.String(length=64), nullable=False),
            sa.Column("conversation_id", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("message_id", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("task_state_id", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("export_record_uuid", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("artifact_type", sa.String(length=48), nullable=False),
            sa.Column("source_scope", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("source_summary_json", sa.JSON(), nullable=True),
            sa.Column("content_summary", sa.Text(), nullable=False),
            sa.Column("file_name", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("file_path_or_blob_ref", sa.String(length=1024), nullable=False, server_default=""),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="active"),
            *_timestamps(),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("uuid"),
        )
        with op.batch_alter_table("ai_work_artifacts") as batch_op:
            batch_op.create_index(batch_op.f("ix_ai_work_artifacts_owner_user_id"), ["owner_user_id"])
            batch_op.create_index(batch_op.f("ix_ai_work_artifacts_conversation_id"), ["conversation_id"])
            batch_op.create_index(batch_op.f("ix_ai_work_artifacts_message_id"), ["message_id"])
            batch_op.create_index(batch_op.f("ix_ai_work_artifacts_task_state_id"), ["task_state_id"])
            batch_op.create_index(batch_op.f("ix_ai_work_artifacts_export_record_uuid"), ["export_record_uuid"])
            batch_op.create_index(batch_op.f("ix_ai_work_artifacts_artifact_type"), ["artifact_type"])
            batch_op.create_index(batch_op.f("ix_ai_work_artifacts_status"), ["status"])
            batch_op.alter_column("conversation_id", existing_type=sa.String(length=64), server_default=None)
            batch_op.alter_column("message_id", existing_type=sa.String(length=64), server_default=None)
            batch_op.alter_column("task_state_id", existing_type=sa.String(length=64), server_default=None)
            batch_op.alter_column("export_record_uuid", existing_type=sa.String(length=64), server_default=None)
            batch_op.alter_column("source_scope", existing_type=sa.String(length=64), server_default=None)
            batch_op.alter_column("file_name", existing_type=sa.String(length=255), server_default=None)
            batch_op.alter_column("file_path_or_blob_ref", existing_type=sa.String(length=1024), server_default=None)
            batch_op.alter_column("version", existing_type=sa.Integer(), server_default=None)
            batch_op.alter_column("status", existing_type=sa.String(length=24), server_default=None)

    if not _has_table("ai_work_artifact_versions"):
        op.create_table(
            "ai_work_artifact_versions",
            sa.Column("id", id_type, autoincrement=True, nullable=False),
            sa.Column("uuid", sa.String(length=36), nullable=False),
            sa.Column("artifact_id", id_type, nullable=False),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("source", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("source_ref", sa.String(length=128), nullable=False, server_default=""),
            sa.Column("file_name", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("file_path_or_blob_ref", sa.String(length=1024), nullable=False, server_default=""),
            sa.Column("source_summary_json", sa.JSON(), nullable=True),
            sa.Column("content_summary", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="active"),
            *_timestamps(),
            sa.ForeignKeyConstraint(["artifact_id"], ["ai_work_artifacts.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("uuid"),
        )
        with op.batch_alter_table("ai_work_artifact_versions") as batch_op:
            batch_op.create_index(batch_op.f("ix_ai_work_artifact_versions_artifact_id"), ["artifact_id"])
            batch_op.alter_column("version", existing_type=sa.Integer(), server_default=None)
            batch_op.alter_column("source", existing_type=sa.String(length=64), server_default=None)
            batch_op.alter_column("source_ref", existing_type=sa.String(length=128), server_default=None)
            batch_op.alter_column("file_name", existing_type=sa.String(length=255), server_default=None)
            batch_op.alter_column("file_path_or_blob_ref", existing_type=sa.String(length=1024), server_default=None)
            batch_op.alter_column("status", existing_type=sa.String(length=24), server_default=None)


def downgrade() -> None:
    if _has_table("ai_work_artifact_versions"):
        op.drop_table("ai_work_artifact_versions")
    if _has_table("ai_work_artifacts"):
        op.drop_table("ai_work_artifacts")
