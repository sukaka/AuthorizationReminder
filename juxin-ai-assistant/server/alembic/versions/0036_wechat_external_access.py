"""add WeChat Official Account external access

Revision ID: 0036_wechat_external_access
Revises: 0035_agent_governance_bindings
"""

from alembic import op
import sqlalchemy as sa


revision = "0036_wechat_external_access"
down_revision = "0035_agent_governance_bindings"
branch_labels = None
depends_on = None

id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    with op.batch_alter_table("ai_knowledge_files") as batch:
        batch.add_column(sa.Column("external_public", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index("ix_ai_knowledge_files_external_public", "ai_knowledge_files", ["external_public"])
    op.create_table(
        "ai_wechat_external_visitors",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("openid_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="ACTIVE"),
        sa.Column("first_seen_at", sa.DateTime(), nullable=False, server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.Column("last_seen_at", sa.DateTime(), nullable=False, server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("uuid"), sa.UniqueConstraint("openid_hash"),
    )
    for column in ["openid_hash", "status", "last_seen_at"]:
        op.create_index(f"ix_ai_wechat_external_visitors_{column}", "ai_wechat_external_visitors", [column])
    op.create_table(
        "ai_wechat_external_question_audits",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("visitor_id", id_type, nullable=False), sa.Column("quota_event_id", sa.String(64), nullable=False),
        sa.Column("question_hash", sa.String(64), nullable=False), sa.Column("status", sa.String(16), nullable=False, server_default="RESERVED"),
        sa.Column("failure_code", sa.String(64), nullable=False, server_default=""), sa.Column("model_id", sa.String(128), nullable=False, server_default=""),
        sa.Column("latency_ms", sa.Integer(), nullable=True), sa.Column("source_file_ids_json", sa.JSON(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True), sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("(CURRENT_TIMESTAMP)")), sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.ForeignKeyConstraint(["visitor_id"], ["ai_wechat_external_visitors.id"], ondelete="CASCADE"), sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("uuid"), sa.UniqueConstraint("quota_event_id"),
    )
    for column in ["visitor_id", "status", "created_at"]:
        op.create_index(f"ix_ai_wechat_external_question_audits_{column}", "ai_wechat_external_question_audits", [column])
    op.create_table(
        "ai_wechat_external_download_audits",
        sa.Column("id", id_type, autoincrement=True, nullable=False), sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("visitor_id", id_type, nullable=False), sa.Column("file_id", id_type, nullable=False), sa.Column("download_token_hash", sa.String(64), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="ISSUED"), sa.Column("expires_at", sa.DateTime(), nullable=False), sa.Column("downloaded_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("(CURRENT_TIMESTAMP)")), sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("(CURRENT_TIMESTAMP)")),
        sa.ForeignKeyConstraint(["visitor_id"], ["ai_wechat_external_visitors.id"], ondelete="CASCADE"), sa.ForeignKeyConstraint(["file_id"], ["ai_knowledge_files.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("uuid"), sa.UniqueConstraint("download_token_hash"),
    )
    for column in ["visitor_id", "file_id", "status", "expires_at"]:
        op.create_index(f"ix_ai_wechat_external_download_audits_{column}", "ai_wechat_external_download_audits", [column])


def downgrade() -> None:
    op.drop_table("ai_wechat_external_download_audits")
    op.drop_table("ai_wechat_external_question_audits")
    op.drop_table("ai_wechat_external_visitors")
    op.drop_index("ix_ai_knowledge_files_external_public", table_name="ai_knowledge_files")
    with op.batch_alter_table("ai_knowledge_files") as batch:
        batch.drop_column("external_public")
