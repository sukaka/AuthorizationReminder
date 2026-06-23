"""desktop update releases and artifacts

Revision ID: 0004_desktop_updates
Revises: 0003_governance
Create Date: 2026-06-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004_desktop_updates"
down_revision: Union[str, None] = "0003_governance"
branch_labels: Union[Sequence[str], None] = None
depends_on: Union[Sequence[str], None] = None


def _id_type() -> sa.types.TypeEngine:
    return sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "ai_desktop_update_releases",
        sa.Column("id", _id_type(), autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), unique=True, nullable=False),
        sa.Column("agent_version", sa.String(32), nullable=False),
        sa.Column("channel", sa.String(16), nullable=False),
        sa.Column(
            "status",
            sa.String(16),
            server_default="DRAFT",
            nullable=False,
        ),
        sa.Column(
            "release_notes",
            sa.Text(),
            server_default="",
            nullable=False,
        ),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("published_at", sa.DateTime(), nullable=True),
        sa.Column("withdrawn_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "channel",
            "agent_version",
            name="uq_desktop_update_release_channel_version",
        ),
        sa.CheckConstraint(
            "channel IN ('lan-test', 'production')",
            name="ck_desktop_update_release_channel",
        ),
        sa.CheckConstraint(
            "status IN ('DRAFT', 'PUBLISHED', 'WITHDRAWN')",
            name="ck_desktop_update_release_status",
        ),
    )
    op.create_index(
        "ix_ai_desktop_update_releases_agent_version",
        "ai_desktop_update_releases",
        ["agent_version"],
    )
    op.create_index(
        "ix_ai_desktop_update_releases_channel",
        "ai_desktop_update_releases",
        ["channel"],
    )
    op.create_index(
        "ix_ai_desktop_update_releases_status",
        "ai_desktop_update_releases",
        ["status"],
    )

    op.create_table(
        "ai_desktop_update_artifacts",
        sa.Column("id", _id_type(), autoincrement=True, nullable=False),
        sa.Column("release_id", _id_type(), nullable=False),
        sa.Column("target", sa.String(32), nullable=False),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("storage_key", sa.String(64), unique=True, nullable=False),
        sa.Column("content_type", sa.String(64), nullable=False),
        sa.Column(
            "size_bytes",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            nullable=False,
        ),
        sa.Column("sha256", sa.String(64), unique=True, nullable=False),
        sa.Column("tauri_signature", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "release_id",
            "target",
            name="uq_desktop_update_artifact_release_target",
        ),
        sa.CheckConstraint(
            "target IN ('darwin-aarch64', 'windows-x86_64')",
            name="ck_desktop_update_artifact_target",
        ),
    )
    op.create_index(
        "ix_ai_desktop_update_artifacts_release_id",
        "ai_desktop_update_artifacts",
        ["release_id"],
    )


def downgrade() -> None:
    op.drop_table("ai_desktop_update_artifacts")
    op.drop_table("ai_desktop_update_releases")
