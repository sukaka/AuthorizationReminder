"""add project initialization foundation tables

Revision ID: 0048_project_initialization_foundation
Revises: 0047_project_chat_workspace
"""

from alembic import op
import sqlalchemy as sa


revision = "0048_project_initialization_foundation"
down_revision = "0047_project_chat_workspace"
branch_labels = None
depends_on = None


id_type = sa.BigInteger().with_variant(sa.Integer(), "sqlite")


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    ]


def _common(name: str, columns: list[sa.Column], indexes: list[str]) -> None:
    op.create_table(
        name,
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        *columns,
        *_timestamps(),
    )
    for column in indexes:
        op.create_index(f"ix_{name}_{column}", name, [column])


def upgrade() -> None:
    _common(
        "ai_project_contracts",
        [
            sa.Column("project_id", id_type, sa.ForeignKey("ai_projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(160), nullable=False),
            sa.Column("contract_no", sa.String(96), nullable=False, server_default=""),
            sa.Column("customer_name", sa.String(160), nullable=False, server_default=""),
            sa.Column("source_file_uuid", sa.String(36), nullable=True),
            sa.Column("extraction_status", sa.String(24), nullable=False, server_default="pending"),
            sa.Column("extracted_payload", sa.JSON(), nullable=False),
            sa.Column("status", sa.String(24), nullable=False, server_default="draft"),
            sa.Column("confirmed_by", sa.String(64), nullable=True),
            sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        ],
        ["project_id", "extraction_status", "status"],
    )
    _common(
        "ai_project_service_scopes",
        [
            sa.Column("project_id", id_type, sa.ForeignKey("ai_projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("contract_id", id_type, sa.ForeignKey("ai_project_contracts.id", ondelete="SET NULL"), nullable=True),
            sa.Column("name", sa.String(160), nullable=False),
            sa.Column("category", sa.String(96), nullable=False, server_default=""),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("frequency", sa.String(48), nullable=False, server_default=""),
            sa.Column("deliverable", sa.String(160), nullable=False, server_default=""),
            sa.Column("acceptance_criteria", sa.Text(), nullable=False, server_default=""),
            sa.Column("status", sa.String(24), nullable=False, server_default="draft"),
            sa.Column("confirmation_status", sa.String(24), nullable=False, server_default="pending"),
            sa.Column("current_version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("confirmed_by", sa.String(64), nullable=True),
            sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        ],
        ["project_id", "contract_id", "status", "confirmation_status"],
    )
    _common(
        "ai_project_service_scope_versions",
        [
            sa.Column("project_id", id_type, sa.ForeignKey("ai_projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("service_scope_id", id_type, sa.ForeignKey("ai_project_service_scopes.id", ondelete="CASCADE"), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("snapshot_json", sa.JSON(), nullable=False),
            sa.Column("change_summary", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_by", sa.String(64), nullable=False),
            sa.UniqueConstraint("service_scope_id", "version", name="uq_ai_project_scope_versions_scope_version"),
        ],
        ["project_id", "service_scope_id"],
    )
    _common(
        "ai_project_business_systems",
        [
            sa.Column("project_id", id_type, sa.ForeignKey("ai_projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(160), nullable=False),
            sa.Column("system_type", sa.String(96), nullable=False, server_default=""),
            sa.Column("department", sa.String(128), nullable=False, server_default=""),
            sa.Column("owner", sa.String(128), nullable=False, server_default=""),
            sa.Column("deployment", sa.String(96), nullable=False, server_default=""),
            sa.Column("criticality", sa.String(24), nullable=False, server_default="medium"),
            sa.Column("internet_exposed", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("in_scope", sa.Boolean(), nullable=False, server_default=sa.text("1")),
            sa.Column("status", sa.String(24), nullable=False, server_default="active"),
            sa.Column("confirmation_status", sa.String(24), nullable=False, server_default="pending"),
            sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        ],
        ["project_id", "status", "confirmation_status"],
    )
    _common(
        "ai_project_assets",
        [
            sa.Column("project_id", id_type, sa.ForeignKey("ai_projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("business_system_id", id_type, sa.ForeignKey("ai_project_business_systems.id", ondelete="SET NULL"), nullable=True),
            sa.Column("name", sa.String(160), nullable=False),
            sa.Column("asset_type", sa.String(96), nullable=False, server_default=""),
            sa.Column("identifier", sa.String(160), nullable=False, server_default=""),
            sa.Column("network_location", sa.String(160), nullable=False, server_default=""),
            sa.Column("purpose", sa.String(256), nullable=False, server_default=""),
            sa.Column("owner", sa.String(128), nullable=False, server_default=""),
            sa.Column("operating_system", sa.String(128), nullable=False, server_default=""),
            sa.Column("vendor_model", sa.String(160), nullable=False, server_default=""),
            sa.Column("criticality", sa.String(24), nullable=False, server_default="medium"),
            sa.Column("in_scope", sa.Boolean(), nullable=False, server_default=sa.text("1")),
            sa.Column("status", sa.String(24), nullable=False, server_default="active"),
            sa.Column("confirmation_status", sa.String(24), nullable=False, server_default="pending"),
            sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        ],
        ["project_id", "business_system_id", "status", "confirmation_status"],
    )
    _common(
        "ai_project_target_groups",
        [
            sa.Column("project_id", id_type, sa.ForeignKey("ai_projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(160), nullable=False),
            sa.Column("group_type", sa.String(48), nullable=False, server_default="custom"),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("selection_rule", sa.JSON(), nullable=False),
            sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        ],
        ["project_id", "status"],
    )
    _common(
        "ai_project_service_targets",
        [
            sa.Column("project_id", id_type, sa.ForeignKey("ai_projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("service_scope_id", id_type, sa.ForeignKey("ai_project_service_scopes.id", ondelete="SET NULL"), nullable=True),
            sa.Column("target_group_id", id_type, sa.ForeignKey("ai_project_target_groups.id", ondelete="SET NULL"), nullable=True),
            sa.Column("target_type", sa.String(48), nullable=False),
            sa.Column("target_value", sa.String(256), nullable=False, server_default=""),
            sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        ],
        ["project_id", "service_scope_id", "target_group_id", "status"],
    )
    _common(
        "ai_project_execution_rules",
        [
            sa.Column("project_id", id_type, sa.ForeignKey("ai_projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("service_scope_id", id_type, sa.ForeignKey("ai_project_service_scopes.id", ondelete="SET NULL"), nullable=True),
            sa.Column("target_group_id", id_type, sa.ForeignKey("ai_project_target_groups.id", ondelete="SET NULL"), nullable=True),
            sa.Column("frequency", sa.String(48), nullable=False, server_default=""),
            sa.Column("first_execution_date", sa.Date(), nullable=True),
            sa.Column("execution_day", sa.String(48), nullable=False, server_default=""),
            sa.Column("time_window", sa.String(96), nullable=False, server_default=""),
            sa.Column("responsible_user_id", sa.String(64), nullable=False, server_default=""),
            sa.Column("collaborator_user_ids", sa.JSON(), nullable=False),
            sa.Column("customer_contact", sa.String(160), nullable=False, server_default=""),
            sa.Column("material_due_rule", sa.String(256), nullable=False, server_default=""),
            sa.Column("template_name", sa.String(160), nullable=False, server_default=""),
            sa.Column("skill_name", sa.String(160), nullable=False, server_default=""),
            sa.Column("deliverable_type", sa.String(96), nullable=False, server_default=""),
            sa.Column("due_rule", sa.String(256), nullable=False, server_default=""),
            sa.Column("reviewer_user_id", sa.String(64), nullable=False, server_default=""),
            sa.Column("acceptance_criteria", sa.Text(), nullable=False, server_default=""),
            sa.Column("allow_ai_execution", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("needs_approval", sa.Boolean(), nullable=False, server_default=sa.text("1")),
            sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        ],
        ["project_id", "service_scope_id", "target_group_id", "status"],
    )


def downgrade() -> None:
    for table in (
        "ai_project_execution_rules",
        "ai_project_service_targets",
        "ai_project_target_groups",
        "ai_project_assets",
        "ai_project_business_systems",
        "ai_project_service_scope_versions",
        "ai_project_service_scopes",
        "ai_project_contracts",
    ):
        op.drop_table(table)
