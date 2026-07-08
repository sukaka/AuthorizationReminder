"""user model profiles

Revision ID: 0020_user_model_profiles
Revises: 0019_skill_productization
Create Date: 2026-07-07
"""

from alembic import op
import sqlalchemy as sa


revision = "0020_user_model_profiles"
down_revision = "0019_skill_productization"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_user_model_profiles",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(length=36), nullable=False, unique=True),
        sa.Column("sso_user_id", sa.String(length=64), nullable=False, index=True),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column("base_url", sa.String(length=512), nullable=False),
        sa.Column("model_id", sa.String(length=128), nullable=False),
        sa.Column("temperature", sa.Float(), nullable=False, server_default="0.3"),
        sa.Column("max_output_tokens", sa.Integer(), nullable=False, server_default="8192"),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False, server_default="300"),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false(), index=True),
        sa.Column("api_key_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("api_key_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("key_version", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="ACTIVE", index=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("sso_user_id", "display_name"),
    )


def downgrade() -> None:
    op.drop_table("ai_user_model_profiles")
