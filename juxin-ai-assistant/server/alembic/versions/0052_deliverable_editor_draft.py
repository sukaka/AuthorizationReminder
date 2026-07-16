"""add structured deliverable editor drafts and leases

Revision ID: 0052_deliverable_editor_draft
Revises: 0051_professional_delivery
"""

from alembic import op
import sqlalchemy as sa


revision = "0052_deliverable_editor_draft"
down_revision = "0051_professional_delivery"
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
        "ai_deliverable_drafts",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column(
            "deliverable_id",
            id_type,
            sa.ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "base_version_id",
            id_type,
            sa.ForeignKey("ai_work_artifact_versions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("content_format", sa.String(32), nullable=False, server_default="structured_json"),
        sa.Column("content_schema_version", sa.String(32), nullable=False, server_default="2"),
        sa.Column("content_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("content_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("key_version", sa.String(32), nullable=False, server_default=""),
        sa.Column("content_hash", sa.String(64), nullable=False, server_default=""),
        sa.Column("content_summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        *_timestamps(),
        sa.UniqueConstraint("uuid", name="uq_ai_deliverable_drafts_uuid"),
        sa.UniqueConstraint("deliverable_id", name="uq_ai_deliverable_drafts_deliverable"),
    )
    op.create_index("ix_ai_deliverable_drafts_deliverable_id", "ai_deliverable_drafts", ["deliverable_id"])
    op.create_index("ix_ai_deliverable_drafts_base_version_id", "ai_deliverable_drafts", ["base_version_id"])
    op.create_index("ix_ai_deliverable_drafts_updated_by", "ai_deliverable_drafts", ["updated_by"])
    op.create_index("ix_ai_deliverable_drafts_status", "ai_deliverable_drafts", ["status"])

    op.create_table(
        "ai_deliverable_edit_leases",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column(
            "deliverable_id",
            id_type,
            sa.ForeignKey("ai_work_artifacts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("owner_user_id", sa.String(64), nullable=False),
        sa.Column("fencing_token", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        *_timestamps(),
        sa.UniqueConstraint("uuid", name="uq_ai_deliverable_edit_leases_uuid"),
        sa.UniqueConstraint("deliverable_id", name="uq_ai_deliverable_edit_leases_deliverable"),
    )
    op.create_index("ix_ai_deliverable_edit_leases_deliverable_id", "ai_deliverable_edit_leases", ["deliverable_id"])
    op.create_index("ix_ai_deliverable_edit_leases_owner_user_id", "ai_deliverable_edit_leases", ["owner_user_id"])
    op.create_index("ix_ai_deliverable_edit_leases_fencing_token", "ai_deliverable_edit_leases", ["fencing_token"])
    op.create_index("ix_ai_deliverable_edit_leases_expires_at", "ai_deliverable_edit_leases", ["expires_at"])
    op.create_index("ix_ai_deliverable_edit_leases_status", "ai_deliverable_edit_leases", ["status"])


def downgrade() -> None:
    op.drop_index("ix_ai_deliverable_edit_leases_status", table_name="ai_deliverable_edit_leases")
    op.drop_index("ix_ai_deliverable_edit_leases_expires_at", table_name="ai_deliverable_edit_leases")
    op.drop_index("ix_ai_deliverable_edit_leases_fencing_token", table_name="ai_deliverable_edit_leases")
    op.drop_index("ix_ai_deliverable_edit_leases_owner_user_id", table_name="ai_deliverable_edit_leases")
    op.drop_index("ix_ai_deliverable_edit_leases_deliverable_id", table_name="ai_deliverable_edit_leases")
    op.drop_table("ai_deliverable_edit_leases")
    op.drop_index("ix_ai_deliverable_drafts_status", table_name="ai_deliverable_drafts")
    op.drop_index("ix_ai_deliverable_drafts_updated_by", table_name="ai_deliverable_drafts")
    op.drop_index("ix_ai_deliverable_drafts_base_version_id", table_name="ai_deliverable_drafts")
    op.drop_index("ix_ai_deliverable_drafts_deliverable_id", table_name="ai_deliverable_drafts")
    op.drop_table("ai_deliverable_drafts")
