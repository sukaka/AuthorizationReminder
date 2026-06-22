"""desktop update releases and artifacts

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_desktop_update_releases",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), unique=True, nullable=False),
        sa.Column("agent_version", sa.String(32), index=True, nullable=False),
        sa.Column("channel", sa.String(16), index=True, nullable=False),
        sa.Column("status", sa.String(16), server_default="DRAFT", index=True, nullable=False),
        sa.Column("release_notes", sa.Text(), server_default="", nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("published_at", sa.DateTime(), nullable=True),
        sa.Column("withdrawn_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("channel", "agent_version", name="uq_desktop_update_release_channel_version"),
        sa.CheckConstraint("channel IN ('lan-test', 'production')", name="ck_desktop_update_release_channel"),
        sa.CheckConstraint("status IN ('DRAFT', 'PUBLISHED', 'WITHDRAWN')", name="ck_desktop_update_release_status"),
    )
    op.create_table(
        "ai_desktop_update_artifacts",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("release_id", sa.BigInteger(), index=True, nullable=False),
        sa.Column("target", sa.String(32), nullable=False),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("storage_key", sa.String(64), unique=True, nullable=False),
        sa.Column("content_type", sa.String(64), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(64), unique=True, nullable=False),
        sa.Column("tauri_signature", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("release_id", "target", name="uq_desktop_update_artifact_release_target"),
        sa.CheckConstraint("target IN ('darwin-aarch64', 'windows-x86_64')", name="ck_desktop_update_artifact_target"),
    )


def downgrade() -> None:
    op.drop_table("ai_desktop_update_artifacts")
    op.drop_table("ai_desktop_update_releases")
