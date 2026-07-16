"""add enterprise business lineage and authoritative deliverable references

Revision ID: 0058_enterprise_business_lineage
Revises: 0057_enterprise_identity_scope

The business lineage layer is additive.  Existing project, task, issue and
artifact rows remain valid because all new cross-domain references are
nullable until the backfill and unresolved-data review is complete.
"""

from alembic import op
import sqlalchemy as sa


revision = "0058_enterprise_business_lineage"
down_revision = "0057_enterprise_identity_scope"
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
        "ai_project_customer_links",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("organization_id", id_type, sa.ForeignKey("ai_organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", id_type, sa.ForeignKey("ai_projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("customer_id", id_type, sa.ForeignKey("ai_enterprise_customers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relation_type", sa.String(32), nullable=False, server_default="primary"),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("source", sa.String(64), nullable=False, server_default="manual"),
        sa.Column("confirmed_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.Column("row_version", sa.Integer(), nullable=False, server_default="1"),
        *_timestamps(),
        sa.UniqueConstraint(
            "organization_id", "project_id", "customer_id", "relation_type",
            name="uq_ai_project_customer_links_relation",
        ),
    )
    for index_name, columns in (
        ("ix_ai_project_customer_links_organization_id", ["organization_id"]),
        ("ix_ai_project_customer_links_project_id", ["project_id"]),
        ("ix_ai_project_customer_links_customer_id", ["customer_id"]),
        ("ix_ai_project_customer_links_relation_type", ["relation_type"]),
        ("ix_ai_project_customer_links_status", ["status"]),
    ):
        op.create_index(index_name, "ai_project_customer_links", columns)

    op.create_table(
        "ai_project_service_occurrences",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("organization_id", id_type, sa.ForeignKey("ai_organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", id_type, sa.ForeignKey("ai_projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("contract_id", id_type, sa.ForeignKey("ai_project_contracts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("service_scope_id", id_type, sa.ForeignKey("ai_project_service_scopes.id", ondelete="SET NULL"), nullable=True),
        sa.Column("task_id", id_type, sa.ForeignKey("ai_project_tasks.id", ondelete="SET NULL"), nullable=True),
        sa.Column("deliverable_id", id_type, sa.ForeignKey("ai_project_deliverables.id", ondelete="SET NULL"), nullable=True),
        sa.Column("workflow_run_id", sa.String(36), sa.ForeignKey("ai_agent_runs.uuid", ondelete="SET NULL"), nullable=True),
        sa.Column("work_artifact_id", id_type, sa.ForeignKey("ai_work_artifacts.id", ondelete="SET NULL"), nullable=True),
        sa.Column("occurrence_key", sa.String(192), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("due_at", sa.DateTime(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="scheduled"),
        sa.Column("completion_evidence_type", sa.String(48), nullable=False, server_default=""),
        sa.Column("completion_evidence_uuid", sa.String(64), nullable=False, server_default=""),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("completed_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("source_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("row_version", sa.Integer(), nullable=False, server_default="1"),
        *_timestamps(),
        sa.UniqueConstraint(
            "organization_id", "occurrence_key",
            name="uq_ai_project_service_occurrences_org_key",
        ),
    )
    for index_name, columns in (
        ("ix_ai_project_service_occurrences_organization_id", ["organization_id"]),
        ("ix_ai_project_service_occurrences_project_id", ["project_id"]),
        ("ix_ai_project_service_occurrences_contract_id", ["contract_id"]),
        ("ix_ai_project_service_occurrences_service_scope_id", ["service_scope_id"]),
        ("ix_ai_project_service_occurrences_task_id", ["task_id"]),
        ("ix_ai_project_service_occurrences_deliverable_id", ["deliverable_id"]),
        ("ix_ai_project_service_occurrences_workflow_run_id", ["workflow_run_id"]),
        ("ix_ai_project_service_occurrences_work_artifact_id", ["work_artifact_id"]),
        ("ix_ai_project_service_occurrences_period_start", ["period_start"]),
        ("ix_ai_project_service_occurrences_period_end", ["period_end"]),
        ("ix_ai_project_service_occurrences_due_at", ["due_at"]),
        ("ix_ai_project_service_occurrences_status", ["status"]),
        ("ix_ai_project_service_occurrences_project_id_due_at", ["project_id", "due_at"]),
    ):
        op.create_index(index_name, "ai_project_service_occurrences", columns)

    op.create_table(
        "ai_project_issue_asset_links",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("organization_id", id_type, sa.ForeignKey("ai_organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", id_type, sa.ForeignKey("ai_projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("issue_id", id_type, sa.ForeignKey("ai_project_issues.id", ondelete="CASCADE"), nullable=False),
        sa.Column("asset_id", id_type, sa.ForeignKey("ai_project_assets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("relation_type", sa.String(32), nullable=False, server_default="affected"),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("source", sa.String(64), nullable=False, server_default="manual"),
        *_timestamps(),
        sa.UniqueConstraint(
            "organization_id", "issue_id", "asset_id", "relation_type",
            name="uq_ai_project_issue_asset_links_relation",
        ),
    )
    for index_name, columns in (
        ("ix_ai_project_issue_asset_links_organization_id", ["organization_id"]),
        ("ix_ai_project_issue_asset_links_project_id", ["project_id"]),
        ("ix_ai_project_issue_asset_links_issue_id", ["issue_id"]),
        ("ix_ai_project_issue_asset_links_asset_id", ["asset_id"]),
        ("ix_ai_project_issue_asset_links_relation_type", ["relation_type"]),
        ("ix_ai_project_issue_asset_links_status", ["status"]),
    ):
        op.create_index(index_name, "ai_project_issue_asset_links", columns)

    op.create_table(
        "ai_project_remediations",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("organization_id", id_type, sa.ForeignKey("ai_organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", id_type, sa.ForeignKey("ai_projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("issue_id", id_type, sa.ForeignKey("ai_project_issues.id", ondelete="CASCADE"), nullable=False),
        sa.Column("asset_id", id_type, sa.ForeignKey("ai_project_assets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("owner_user_id", sa.String(64), nullable=False, server_default=""),
        sa.Column("priority", sa.String(16), nullable=False, server_default="normal"),
        sa.Column("status", sa.String(24), nullable=False, server_default="open"),
        sa.Column("due_at", sa.DateTime(), nullable=True),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.Column("verified_by", sa.String(64), nullable=False, server_default=""),
        sa.Column("verified_at", sa.DateTime(), nullable=True),
        sa.Column("verification_status", sa.String(24), nullable=False, server_default="pending"),
        sa.Column("row_version", sa.Integer(), nullable=False, server_default="1"),
        *_timestamps(),
    )
    for index_name, columns in (
        ("ix_ai_project_remediations_organization_id", ["organization_id"]),
        ("ix_ai_project_remediations_project_id", ["project_id"]),
        ("ix_ai_project_remediations_issue_id", ["issue_id"]),
        ("ix_ai_project_remediations_asset_id", ["asset_id"]),
        ("ix_ai_project_remediations_owner_user_id", ["owner_user_id"]),
        ("ix_ai_project_remediations_priority", ["priority"]),
        ("ix_ai_project_remediations_status", ["status"]),
        ("ix_ai_project_remediations_due_at", ["due_at"]),
        ("ix_ai_project_remediations_verification_status", ["verification_status"]),
    ):
        op.create_index(index_name, "ai_project_remediations", columns)

    op.create_table(
        "ai_remediation_evidence_links",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("organization_id", id_type, sa.ForeignKey("ai_organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("remediation_id", id_type, sa.ForeignKey("ai_project_remediations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("evidence_type", sa.String(48), nullable=False),
        sa.Column("evidence_uuid", sa.String(64), nullable=False),
        sa.Column("source_table", sa.String(128), nullable=False, server_default=""),
        sa.Column("source_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("relation_type", sa.String(32), nullable=False, server_default="supports"),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("notes", sa.Text(), nullable=False),
        *_timestamps(),
        sa.UniqueConstraint(
            "organization_id", "remediation_id", "evidence_type", "evidence_uuid", "source_version",
            name="uq_ai_remediation_evidence_links_evidence",
        ),
    )
    for index_name, columns in (
        ("ix_ai_remediation_evidence_links_organization_id", ["organization_id"]),
        ("ix_ai_remediation_evidence_links_remediation_id", ["remediation_id"]),
        ("ix_ai_remediation_evidence_links_relation_type", ["relation_type"]),
        ("ix_ai_remediation_evidence_links_status", ["status"]),
    ):
        op.create_index(index_name, "ai_remediation_evidence_links", columns)

    with op.batch_alter_table("ai_project_tasks") as batch_op:
        batch_op.add_column(sa.Column("service_scope_id", id_type, nullable=True))
        batch_op.add_column(sa.Column("execution_rule_id", id_type, nullable=True))
        batch_op.add_column(sa.Column("workflow_run_id", sa.String(36), nullable=True))
        batch_op.create_foreign_key(
            "fk_ai_project_tasks_service_scope_id",
            "ai_project_service_scopes",
            ["service_scope_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_ai_project_tasks_execution_rule_id",
            "ai_project_execution_rules",
            ["execution_rule_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_ai_project_tasks_workflow_run_id",
            "ai_agent_runs",
            ["workflow_run_id"],
            ["uuid"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_ai_project_tasks_service_scope_id", ["service_scope_id"])
        batch_op.create_index("ix_ai_project_tasks_execution_rule_id", ["execution_rule_id"])
        batch_op.create_index("ix_ai_project_tasks_workflow_run_id", ["workflow_run_id"])

    with op.batch_alter_table("ai_project_deliverables") as batch_op:
        batch_op.add_column(sa.Column("work_artifact_id", id_type, nullable=True))
        batch_op.add_column(sa.Column("work_artifact_version_id", id_type, nullable=True))
        batch_op.create_foreign_key(
            "fk_ai_project_deliverables_work_artifact_id",
            "ai_work_artifacts",
            ["work_artifact_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_ai_project_deliverables_work_artifact_version_id",
            "ai_work_artifact_versions",
            ["work_artifact_version_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_ai_project_deliverables_work_artifact_id", ["work_artifact_id"], unique=True)
        batch_op.create_index("ix_ai_project_deliverables_work_artifact_version_id", ["work_artifact_version_id"], unique=True)


def downgrade() -> None:
    with op.batch_alter_table("ai_project_deliverables") as batch_op:
        batch_op.drop_constraint("fk_ai_project_deliverables_work_artifact_version_id", type_="foreignkey")
        batch_op.drop_constraint("fk_ai_project_deliverables_work_artifact_id", type_="foreignkey")
        batch_op.drop_index("ix_ai_project_deliverables_work_artifact_version_id")
        batch_op.drop_index("ix_ai_project_deliverables_work_artifact_id")
        batch_op.drop_column("work_artifact_version_id")
        batch_op.drop_column("work_artifact_id")

    with op.batch_alter_table("ai_project_tasks") as batch_op:
        batch_op.drop_constraint("fk_ai_project_tasks_workflow_run_id", type_="foreignkey")
        batch_op.drop_constraint("fk_ai_project_tasks_execution_rule_id", type_="foreignkey")
        batch_op.drop_constraint("fk_ai_project_tasks_service_scope_id", type_="foreignkey")
        batch_op.drop_index("ix_ai_project_tasks_workflow_run_id")
        batch_op.drop_index("ix_ai_project_tasks_execution_rule_id")
        batch_op.drop_index("ix_ai_project_tasks_service_scope_id")
        batch_op.drop_column("workflow_run_id")
        batch_op.drop_column("execution_rule_id")
        batch_op.drop_column("service_scope_id")

    for index_name, table_name in (
        ("ix_ai_remediation_evidence_links_status", "ai_remediation_evidence_links"),
        ("ix_ai_remediation_evidence_links_relation_type", "ai_remediation_evidence_links"),
        ("ix_ai_remediation_evidence_links_remediation_id", "ai_remediation_evidence_links"),
        ("ix_ai_remediation_evidence_links_organization_id", "ai_remediation_evidence_links"),
        ("ix_ai_project_remediations_verification_status", "ai_project_remediations"),
        ("ix_ai_project_remediations_due_at", "ai_project_remediations"),
        ("ix_ai_project_remediations_status", "ai_project_remediations"),
        ("ix_ai_project_remediations_priority", "ai_project_remediations"),
        ("ix_ai_project_remediations_owner_user_id", "ai_project_remediations"),
        ("ix_ai_project_remediations_asset_id", "ai_project_remediations"),
        ("ix_ai_project_remediations_issue_id", "ai_project_remediations"),
        ("ix_ai_project_remediations_project_id", "ai_project_remediations"),
        ("ix_ai_project_remediations_organization_id", "ai_project_remediations"),
        ("ix_ai_project_issue_asset_links_status", "ai_project_issue_asset_links"),
        ("ix_ai_project_issue_asset_links_relation_type", "ai_project_issue_asset_links"),
        ("ix_ai_project_issue_asset_links_asset_id", "ai_project_issue_asset_links"),
        ("ix_ai_project_issue_asset_links_issue_id", "ai_project_issue_asset_links"),
        ("ix_ai_project_issue_asset_links_project_id", "ai_project_issue_asset_links"),
        ("ix_ai_project_issue_asset_links_organization_id", "ai_project_issue_asset_links"),
        ("ix_ai_project_service_occurrences_project_id_due_at", "ai_project_service_occurrences"),
        ("ix_ai_project_service_occurrences_status", "ai_project_service_occurrences"),
        ("ix_ai_project_service_occurrences_due_at", "ai_project_service_occurrences"),
        ("ix_ai_project_service_occurrences_period_end", "ai_project_service_occurrences"),
        ("ix_ai_project_service_occurrences_period_start", "ai_project_service_occurrences"),
        ("ix_ai_project_service_occurrences_work_artifact_id", "ai_project_service_occurrences"),
        ("ix_ai_project_service_occurrences_workflow_run_id", "ai_project_service_occurrences"),
        ("ix_ai_project_service_occurrences_deliverable_id", "ai_project_service_occurrences"),
        ("ix_ai_project_service_occurrences_task_id", "ai_project_service_occurrences"),
        ("ix_ai_project_service_occurrences_service_scope_id", "ai_project_service_occurrences"),
        ("ix_ai_project_service_occurrences_contract_id", "ai_project_service_occurrences"),
        ("ix_ai_project_service_occurrences_project_id", "ai_project_service_occurrences"),
        ("ix_ai_project_service_occurrences_organization_id", "ai_project_service_occurrences"),
        ("ix_ai_project_customer_links_status", "ai_project_customer_links"),
        ("ix_ai_project_customer_links_relation_type", "ai_project_customer_links"),
        ("ix_ai_project_customer_links_customer_id", "ai_project_customer_links"),
        ("ix_ai_project_customer_links_project_id", "ai_project_customer_links"),
        ("ix_ai_project_customer_links_organization_id", "ai_project_customer_links"),
    ):
        op.drop_index(index_name, table_name=table_name)

    for table_name in (
        "ai_remediation_evidence_links",
        "ai_project_remediations",
        "ai_project_issue_asset_links",
        "ai_project_service_occurrences",
        "ai_project_customer_links",
    ):
        op.drop_table(table_name)
