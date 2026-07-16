"""add encrypted media assets for the professional deliverable editor

Revision ID: 0053_deliverable_media_assets
Revises: 0052_deliverable_editor_draft
"""

from alembic import op
import sqlalchemy as sa


revision = "0053_deliverable_media_assets"
down_revision = "0052_deliverable_editor_draft"
branch_labels = None
depends_on = None

id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    ]


def upgrade() -> None:
    op.create_table(
        "ai_deliverable_media_assets",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column(
            "deliverable_id",
            id_type,
            sa.ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("owner_user_id", sa.String(64), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("original_file_name", sa.String(255), nullable=False, server_default=""),
        sa.Column("media_type", sa.String(64), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("content_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("content_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("key_version", sa.String(32), nullable=False, server_default=""),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        *_timestamps(),
        sa.UniqueConstraint("uuid", name="uq_ai_deliverable_media_assets_uuid"),
        sa.UniqueConstraint(
            "deliverable_id",
            "owner_user_id",
            "idempotency_key",
            name="uq_ai_deliverable_media_assets_idempotency",
        ),
    )
    for name, column in (
        ("deliverable_id", "deliverable_id"),
        ("owner_user_id", "owner_user_id"),
        ("media_type", "media_type"),
        ("content_hash", "content_hash"),
        ("status", "status"),
    ):
        op.create_index(
            f"ix_ai_deliverable_media_assets_{name}",
            "ai_deliverable_media_assets",
            [column],
        )


def downgrade() -> None:
    for name in ("status", "content_hash", "media_type", "owner_user_id", "deliverable_id"):
        op.drop_index(f"ix_ai_deliverable_media_assets_{name}", table_name="ai_deliverable_media_assets")
    op.drop_table("ai_deliverable_media_assets")
