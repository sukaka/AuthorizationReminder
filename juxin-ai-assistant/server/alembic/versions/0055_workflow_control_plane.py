"""add durable workflow schedules, inbox, outbox, and waits

Revision ID: 0055_workflow_control_plane
Revises: 0054_merge_langgraph_and_professional_delivery
"""

from alembic import op
import sqlalchemy as sa


revision = "0055_workflow_control_plane"
down_revision = "0054_merge_langgraph_and_professional_delivery"
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
        "ai_workflow_schedules",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("owner_user_id", sa.String(64), nullable=False),
        sa.Column("workflow_id", sa.String(48), nullable=False),
        sa.Column("name", sa.String(128), nullable=False, server_default=""),
        sa.Column("cron_expression", sa.String(128), nullable=False, server_default=""),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("misfire_policy", sa.String(24), nullable=False, server_default="skip"),
        sa.Column("catch_up", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("concurrency_policy", sa.String(24), nullable=False, server_default="forbid"),
        sa.Column("next_fire_at", sa.DateTime(), nullable=True),
        sa.Column("last_fire_at", sa.DateTime(), nullable=True),
        sa.Column("lease_owner", sa.String(128), nullable=False, server_default=""),
        sa.Column("lease_token", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
        sa.Column("idempotency_prefix", sa.String(128), nullable=False, server_default=""),
        sa.Column("metadata_json", sa.JSON(), nullable=True),
        *_timestamps(),
        sa.UniqueConstraint("uuid", name="uq_ai_workflow_schedules_uuid"),
        sa.UniqueConstraint(
            "owner_user_id", "workflow_id", "name",
            name="uq_ai_workflow_schedules_owner_workflow_name",
        ),
    )
    for name, columns in {
        "owner": ["owner_user_id"],
        "workflow": ["workflow_id"],
        "enabled": ["enabled"],
        "next_fire": ["next_fire_at"],
        "lease": ["lease_expires_at"],
    }.items():
        op.create_index(f"ix_ai_workflow_schedules_{name}", "ai_workflow_schedules", columns)

    op.create_table(
        "ai_workflow_trigger_inbox",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("owner_user_id", sa.String(64), nullable=False),
        sa.Column("workflow_id", sa.String(48), nullable=False),
        sa.Column("event_type", sa.String(96), nullable=False),
        sa.Column("event_key", sa.String(128), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="pending"),
        sa.Column("run_id", sa.String(36), nullable=False, server_default=""),
        sa.Column("received_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("processed_at", sa.DateTime(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=False, server_default=""),
        *_timestamps(),
        sa.UniqueConstraint("uuid", name="uq_ai_workflow_trigger_inbox_uuid"),
        sa.UniqueConstraint(
            "owner_user_id", "event_type", "event_key",
            name="uq_ai_workflow_trigger_inbox_owner_type_key",
        ),
    )
    for name, column in (
        ("owner", "owner_user_id"),
        ("workflow", "workflow_id"),
        ("event_type", "event_type"),
        ("status", "status"),
        ("run", "run_id"),
    ):
        op.create_index(f"ix_ai_workflow_trigger_inbox_{name}", "ai_workflow_trigger_inbox", [column])

    op.create_table(
        "ai_workflow_notification_outbox",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("owner_user_id", sa.String(64), nullable=False),
        sa.Column("run_id", sa.String(36), nullable=False),
        sa.Column("node_id", sa.String(48), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("channel", sa.String(32), nullable=False, server_default="in_app"),
        sa.Column("recipient", sa.String(255), nullable=False, server_default=""),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lease_owner", sa.String(128), nullable=False, server_default=""),
        sa.Column("lease_token", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lease_expires_at", sa.DateTime(), nullable=True),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=True),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=False, server_default=""),
        *_timestamps(),
        sa.UniqueConstraint("uuid", name="uq_ai_workflow_notification_outbox_uuid"),
        sa.UniqueConstraint(
            "run_id", "node_id", "idempotency_key",
            name="uq_ai_workflow_notification_outbox_run_node_key",
        ),
    )
    for name, column in (
        ("owner", "owner_user_id"),
        ("run", "run_id"),
        ("node", "node_id"),
        ("status", "status"),
        ("lease", "lease_expires_at"),
        ("next_attempt", "next_attempt_at"),
    ):
        op.create_index(f"ix_ai_workflow_notification_outbox_{name}", "ai_workflow_notification_outbox", [column])

    op.create_table(
        "ai_workflow_waits",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False),
        sa.Column("owner_user_id", sa.String(64), nullable=False),
        sa.Column(
            "run_id",
            sa.String(36),
            sa.ForeignKey("ai_agent_runs.uuid", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("node_id", sa.String(48), nullable=False),
        sa.Column("wait_key", sa.String(128), nullable=False),
        sa.Column("signal_key", sa.String(128), nullable=False, server_default=""),
        sa.Column("status", sa.String(24), nullable=False, server_default="waiting"),
        sa.Column("resume_at", sa.DateTime(), nullable=True),
        sa.Column("payload_json", sa.JSON(), nullable=True),
        sa.Column("resumed_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("resumed_at", sa.DateTime(), nullable=True),
        *_timestamps(),
        sa.UniqueConstraint("uuid", name="uq_ai_workflow_waits_uuid"),
        sa.UniqueConstraint(
            "run_id", "node_id", "wait_key",
            name="uq_ai_workflow_waits_run_node_key",
        ),
    )
    for name, column in (
        ("owner", "owner_user_id"),
        ("run", "run_id"),
        ("node", "node_id"),
        ("status", "status"),
        ("resume", "resume_at"),
    ):
        op.create_index(f"ix_ai_workflow_waits_{name}", "ai_workflow_waits", [column])


def downgrade() -> None:
    for table, names in (
        ("ai_workflow_waits", ("owner", "run", "node", "status", "resume")),
        ("ai_workflow_notification_outbox", ("owner", "run", "node", "status", "lease", "next_attempt")),
        ("ai_workflow_trigger_inbox", ("owner", "workflow", "event_type", "status", "run")),
        ("ai_workflow_schedules", ("owner", "workflow", "enabled", "next_fire", "lease")),
    ):
        for name in names:
            op.drop_index(f"ix_{table}_{name}", table_name=table)
        op.drop_table(table)
