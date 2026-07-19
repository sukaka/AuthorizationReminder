"""persist uploaded Skill packages and their visibility state

Revision ID: 0066_skill_uploads
Revises: 0065_chat_generated_files
"""

from alembic import op
import sqlalchemy as sa


revision = "0066_skill_uploads"
down_revision = "0065_chat_generated_files"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_uploaded_skills",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("skill_id", sa.String(length=96), nullable=False),
        sa.Column("source_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("storage_key", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("category", sa.String(length=96), nullable=False, server_default=""),
        sa.Column("version", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("scope", sa.String(length=24), nullable=False, server_default="personal"),
        sa.Column("owner", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("uploaded_by", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="pending_review"),
        sa.Column("manifest_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
        sa.UniqueConstraint("skill_id"),
        sa.UniqueConstraint("storage_key"),
    )
    op.create_index("ix_ai_uploaded_skills_skill_id", "ai_uploaded_skills", ["skill_id"])
    op.create_index("ix_ai_uploaded_skills_scope", "ai_uploaded_skills", ["scope"])
    op.create_index("ix_ai_uploaded_skills_owner", "ai_uploaded_skills", ["owner"])
    op.create_index("ix_ai_uploaded_skills_uploaded_by", "ai_uploaded_skills", ["uploaded_by"])
    op.create_index("ix_ai_uploaded_skills_status", "ai_uploaded_skills", ["status"])


def downgrade() -> None:
    for name in (
        "ix_ai_uploaded_skills_status",
        "ix_ai_uploaded_skills_uploaded_by",
        "ix_ai_uploaded_skills_owner",
        "ix_ai_uploaded_skills_scope",
        "ix_ai_uploaded_skills_skill_id",
    ):
        op.drop_index(name, table_name="ai_uploaded_skills")
    op.drop_table("ai_uploaded_skills")
