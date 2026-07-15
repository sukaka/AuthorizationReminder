"""agent run contracts

Revision ID: 0026_agent_run_contracts
Revises: 0025_hot_question_reports
Create Date: 2026-07-12
"""

from alembic import op
import sqlalchemy as sa


revision = "0026_agent_run_contracts"
down_revision = "0025_hot_question_reports"
branch_labels = None
depends_on = None

id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def upgrade() -> None:
    op.create_table(
        "ai_agent_runs",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("owner_user_id", sa.String(length=64), nullable=False),
        sa.Column("conversation_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("message_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("run_type", sa.String(length=48), nullable=False, server_default="chat"),
        sa.Column("title", sa.String(length=255), nullable=False, server_default="AI 任务"),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="queued"),
        sa.Column("stage", sa.String(length=64), nullable=False, server_default="accepted"),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("max_steps", sa.Integer(), nullable=False, server_default="32"),
        sa.Column("max_model_calls", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("max_cost_micros", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("model_calls", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_micros", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("request_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("request_nonce", sa.LargeBinary(), nullable=False),
        sa.Column("key_version", sa.String(length=32), nullable=False, server_default="v1"),
        sa.Column("checkpoint_json", sa.JSON(), nullable=True),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("error_message_safe", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
    )
    for column in [
        "owner_user_id",
        "conversation_id",
        "message_id",
        "run_type",
        "status",
        "stage",
        "cancel_requested",
        "error_code",
    ]:
        op.create_index(f"ix_ai_agent_runs_{column}", "ai_agent_runs", [column])

    op.create_table(
        "ai_agent_run_steps",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("step_type", sa.String(length=64), nullable=False),
        sa.Column("role", sa.String(length=48), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="queued"),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("input_summary_json", sa.JSON(), nullable=True),
        sa.Column("output_summary_json", sa.JSON(), nullable=True),
        sa.Column("checkpoint_json", sa.JSON(), nullable=True),
        sa.Column("usage_json", sa.JSON(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_code", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("error_message_safe", sa.Text(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["ai_agent_runs.uuid"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
        sa.UniqueConstraint("run_id", "sequence"),
    )
    for column in ["run_id", "step_type", "status", "error_code"]:
        op.create_index(f"ix_ai_agent_run_steps_{column}", "ai_agent_run_steps", [column])

    op.create_table(
        "ai_run_events",
        sa.Column("id", id_type, autoincrement=True, nullable=False),
        sa.Column("uuid", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("event_key", sa.String(length=128), nullable=True),
        sa.Column("event_type", sa.String(length=24), nullable=False),
        sa.Column("stage", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("label", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("progress", sa.Integer(), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("source_json", sa.JSON(), nullable=True),
        sa.Column("artifact_json", sa.JSON(), nullable=True),
        sa.Column("quality_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["ai_agent_runs.uuid"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("uuid"),
        sa.UniqueConstraint("run_id", "sequence"),
        sa.UniqueConstraint("run_id", "event_key"),
    )
    for column in ["run_id", "event_key", "event_type"]:
        op.create_index(f"ix_ai_run_events_{column}", "ai_run_events", [column])


def downgrade() -> None:
    op.drop_table("ai_run_events")
    op.drop_table("ai_agent_run_steps")
    op.drop_table("ai_agent_runs")
