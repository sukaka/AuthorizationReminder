"""add enterprise identity scope and source-entity references

Revision ID: 0057_enterprise_identity_scope
Revises: 0056_workflow_fencing_and_wait_tokens

The identity layer is an additive boundary for 5.0.  Existing project and
contract facts remain authoritative; their new organization and customer
references are nullable so this migration is safe before backfill.
"""

from alembic import op
import sqlalchemy as sa


revision = "0057_enterprise_identity_scope"
down_revision = "0056_workflow_fencing_and_wait_tokens"
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
        "ai_organizations",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("external_id", sa.String(128), nullable=False, unique=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("directory_version", sa.String(64), nullable=False, server_default=""),
        sa.Column("row_version", sa.Integer(), nullable=False, server_default="1"),
        *_timestamps(),
    )
    op.create_index("ix_ai_organizations_external_id", "ai_organizations", ["external_id"])
    op.create_index("ix_ai_organizations_status", "ai_organizations", ["status"])

    op.create_table(
        "ai_organization_units",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column(
            "organization_id",
            id_type,
            sa.ForeignKey("ai_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "parent_unit_id",
            id_type,
            sa.ForeignKey("ai_organization_units.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("external_id", sa.String(128), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("unit_type", sa.String(48), nullable=False, server_default="department"),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("directory_version", sa.String(64), nullable=False, server_default=""),
        sa.Column("row_version", sa.Integer(), nullable=False, server_default="1"),
        *_timestamps(),
        sa.UniqueConstraint(
            "organization_id",
            "external_id",
            name="uq_ai_organization_units_org_external",
        ),
    )
    op.create_index("ix_ai_organization_units_organization_id", "ai_organization_units", ["organization_id"])
    op.create_index("ix_ai_organization_units_parent_unit_id", "ai_organization_units", ["parent_unit_id"])
    op.create_index("ix_ai_organization_units_status", "ai_organization_units", ["status"])

    op.create_table(
        "ai_enterprise_customers",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column(
            "organization_id",
            id_type,
            sa.ForeignKey("ai_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("customer_code", sa.String(96), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("sensitivity", sa.String(24), nullable=False, server_default="standard"),
        sa.Column("source_system", sa.String(64), nullable=False, server_default=""),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("row_version", sa.Integer(), nullable=False, server_default="1"),
        *_timestamps(),
        sa.UniqueConstraint(
            "organization_id",
            "customer_code",
            name="uq_ai_enterprise_customers_org_code",
        ),
    )
    op.create_index("ix_ai_enterprise_customers_organization_id", "ai_enterprise_customers", ["organization_id"])
    op.create_index("ix_ai_enterprise_customers_status", "ai_enterprise_customers", ["status"])

    op.create_table(
        "ai_customer_identity_bindings",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column(
            "organization_id",
            id_type,
            sa.ForeignKey("ai_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "customer_id",
            id_type,
            sa.ForeignKey("ai_enterprise_customers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(64), nullable=False),
        sa.Column("external_subject", sa.String(192), nullable=False),
        sa.Column("verification_status", sa.String(24), nullable=False, server_default="pending"),
        sa.Column("valid_from", sa.DateTime(), nullable=True),
        sa.Column("valid_until", sa.DateTime(), nullable=True),
        sa.Column("row_version", sa.Integer(), nullable=False, server_default="1"),
        *_timestamps(),
        sa.UniqueConstraint(
            "organization_id",
            "provider",
            "external_subject",
            name="uq_ai_customer_identity_bindings_subject",
        ),
    )
    op.create_index("ix_ai_customer_identity_bindings_organization_id", "ai_customer_identity_bindings", ["organization_id"])
    op.create_index("ix_ai_customer_identity_bindings_customer_id", "ai_customer_identity_bindings", ["customer_id"])
    op.create_index("ix_ai_customer_identity_bindings_verification_status", "ai_customer_identity_bindings", ["verification_status"])

    op.create_table(
        "ai_enterprise_entity_refs",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column(
            "organization_id",
            id_type,
            sa.ForeignKey("ai_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("entity_type", sa.String(64), nullable=False),
        sa.Column("canonical_uuid", sa.String(36), nullable=False),
        sa.Column("source_table", sa.String(128), nullable=False),
        sa.Column("source_uuid", sa.String(36), nullable=False),
        sa.Column("source_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("relation_status", sa.String(24), nullable=False, server_default="confirmed"),
        sa.Column("row_version", sa.Integer(), nullable=False, server_default="1"),
        *_timestamps(),
        sa.UniqueConstraint(
            "organization_id",
            "entity_type",
            "canonical_uuid",
            name="uq_ai_enterprise_entity_refs_canonical",
        ),
        sa.UniqueConstraint(
            "organization_id",
            "source_table",
            "source_uuid",
            "source_version",
            name="uq_ai_enterprise_entity_refs_source_version",
        ),
    )
    op.create_index("ix_ai_enterprise_entity_refs_organization_id", "ai_enterprise_entity_refs", ["organization_id"])
    op.create_index("ix_ai_enterprise_entity_refs_entity_type", "ai_enterprise_entity_refs", ["entity_type"])
    op.create_index("ix_ai_enterprise_entity_refs_source_table", "ai_enterprise_entity_refs", ["source_table"])
    op.create_index("ix_ai_enterprise_entity_refs_relation_status", "ai_enterprise_entity_refs", ["relation_status"])

    op.create_table(
        "ai_enterprise_entity_aliases",
        sa.Column("id", id_type, primary_key=True, autoincrement=True),
        sa.Column("uuid", sa.String(36), nullable=False, unique=True),
        sa.Column(
            "organization_id",
            id_type,
            sa.ForeignKey("ai_organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "entity_ref_id",
            id_type,
            sa.ForeignKey("ai_enterprise_entity_refs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_system", sa.String(64), nullable=False),
        sa.Column("alias", sa.String(192), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="pending"),
        sa.Column("valid_from", sa.DateTime(), nullable=True),
        sa.Column("valid_until", sa.DateTime(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False),
        *_timestamps(),
        sa.UniqueConstraint(
            "organization_id",
            "source_system",
            "alias",
            name="uq_ai_enterprise_entity_aliases_source_alias",
        ),
    )
    op.create_index("ix_ai_enterprise_entity_aliases_organization_id", "ai_enterprise_entity_aliases", ["organization_id"])
    op.create_index("ix_ai_enterprise_entity_aliases_entity_ref_id", "ai_enterprise_entity_aliases", ["entity_ref_id"])
    op.create_index("ix_ai_enterprise_entity_aliases_status", "ai_enterprise_entity_aliases", ["status"])

    with op.batch_alter_table("ai_projects") as batch_op:
        batch_op.add_column(
            sa.Column(
                "organization_id",
                id_type,
                nullable=True,
            )
        )
        batch_op.add_column(
            sa.Column(
                "owner_department_id",
                id_type,
                nullable=True,
            )
        )
        batch_op.add_column(
            sa.Column(
                "primary_customer_id",
                id_type,
                nullable=True,
            )
        )
        batch_op.create_foreign_key(
            "fk_ai_projects_organization_id",
            "ai_organizations",
            ["organization_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_ai_projects_owner_department_id",
            "ai_organization_units",
            ["owner_department_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_ai_projects_primary_customer_id",
            "ai_enterprise_customers",
            ["primary_customer_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_ai_projects_organization_id", ["organization_id"])
        batch_op.create_index("ix_ai_projects_owner_department_id", ["owner_department_id"])
        batch_op.create_index("ix_ai_projects_primary_customer_id", ["primary_customer_id"])

    with op.batch_alter_table("ai_project_contracts") as batch_op:
        batch_op.add_column(
            sa.Column(
                "organization_id",
                id_type,
                nullable=True,
            )
        )
        batch_op.add_column(
            sa.Column(
                "customer_id",
                id_type,
                nullable=True,
            )
        )
        batch_op.create_foreign_key(
            "fk_ai_project_contracts_organization_id",
            "ai_organizations",
            ["organization_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_ai_project_contracts_customer_id",
            "ai_enterprise_customers",
            ["customer_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_ai_project_contracts_organization_id", ["organization_id"])
        batch_op.create_index("ix_ai_project_contracts_customer_id", ["customer_id"])


def downgrade() -> None:
    with op.batch_alter_table("ai_project_contracts") as batch_op:
        batch_op.drop_constraint("fk_ai_project_contracts_customer_id", type_="foreignkey")
        batch_op.drop_constraint("fk_ai_project_contracts_organization_id", type_="foreignkey")
        batch_op.drop_index("ix_ai_project_contracts_customer_id")
        batch_op.drop_index("ix_ai_project_contracts_organization_id")
        batch_op.drop_column("customer_id")
        batch_op.drop_column("organization_id")

    with op.batch_alter_table("ai_projects") as batch_op:
        batch_op.drop_constraint("fk_ai_projects_primary_customer_id", type_="foreignkey")
        batch_op.drop_constraint("fk_ai_projects_owner_department_id", type_="foreignkey")
        batch_op.drop_constraint("fk_ai_projects_organization_id", type_="foreignkey")
        batch_op.drop_index("ix_ai_projects_primary_customer_id")
        batch_op.drop_index("ix_ai_projects_owner_department_id")
        batch_op.drop_index("ix_ai_projects_organization_id")
        batch_op.drop_column("primary_customer_id")
        batch_op.drop_column("owner_department_id")
        batch_op.drop_column("organization_id")

    for index_name, table_name in (
        ("ix_ai_enterprise_entity_aliases_status", "ai_enterprise_entity_aliases"),
        ("ix_ai_enterprise_entity_aliases_entity_ref_id", "ai_enterprise_entity_aliases"),
        ("ix_ai_enterprise_entity_aliases_organization_id", "ai_enterprise_entity_aliases"),
        ("ix_ai_enterprise_entity_refs_relation_status", "ai_enterprise_entity_refs"),
        ("ix_ai_enterprise_entity_refs_source_table", "ai_enterprise_entity_refs"),
        ("ix_ai_enterprise_entity_refs_entity_type", "ai_enterprise_entity_refs"),
        ("ix_ai_enterprise_entity_refs_organization_id", "ai_enterprise_entity_refs"),
        ("ix_ai_customer_identity_bindings_verification_status", "ai_customer_identity_bindings"),
        ("ix_ai_customer_identity_bindings_customer_id", "ai_customer_identity_bindings"),
        ("ix_ai_customer_identity_bindings_organization_id", "ai_customer_identity_bindings"),
        ("ix_ai_enterprise_customers_status", "ai_enterprise_customers"),
        ("ix_ai_enterprise_customers_organization_id", "ai_enterprise_customers"),
        ("ix_ai_organization_units_status", "ai_organization_units"),
        ("ix_ai_organization_units_parent_unit_id", "ai_organization_units"),
        ("ix_ai_organization_units_organization_id", "ai_organization_units"),
        ("ix_ai_organizations_status", "ai_organizations"),
        ("ix_ai_organizations_external_id", "ai_organizations"),
    ):
        op.drop_index(index_name, table_name=table_name)

    for table_name in (
        "ai_enterprise_entity_aliases",
        "ai_enterprise_entity_refs",
        "ai_customer_identity_bindings",
        "ai_enterprise_customers",
        "ai_organization_units",
        "ai_organizations",
    ):
        op.drop_table(table_name)
