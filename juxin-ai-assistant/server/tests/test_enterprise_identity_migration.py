from pathlib import Path

import pytest
from alembic import command
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models  # noqa: F401
from app.database import Base
from app.enterprise_intelligence_models import EnterpriseCustomer, EnterpriseOrganization
from tests.test_migrations import migration_config


def test_identity_metadata_registers_stable_scope_tables_and_nullable_project_refs() -> None:
    expected_tables = {
        "ai_organizations",
        "ai_organization_units",
        "ai_enterprise_customers",
        "ai_customer_identity_bindings",
        "ai_enterprise_entity_refs",
        "ai_enterprise_entity_aliases",
    }

    assert expected_tables.issubset(Base.metadata.tables)
    assert {
        "organization_id",
        "owner_department_id",
        "primary_customer_id",
    }.issubset(set(Base.metadata.tables["ai_projects"].columns.keys()))
    assert {"organization_id", "customer_id"}.issubset(
        set(Base.metadata.tables["ai_project_contracts"].columns.keys())
    )


def test_identity_external_ids_are_unique_within_an_organization(tmp_path: Path) -> None:
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'identity.db'}")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        organization = EnterpriseOrganization(external_id="org-001", name="聚信")
        session.add(organization)
        session.flush()
        session.add(EnterpriseCustomer(
            organization_id=organization.id,
            customer_code="customer-001",
            name="示例客户",
        ))
        session.flush()
        session.add(EnterpriseCustomer(
            organization_id=organization.id,
            customer_code="customer-001",
            name="重复客户",
        ))
        with pytest.raises(IntegrityError):
            session.flush()


def test_identity_scope_migration_upgrades_and_downgrades_from_0056(tmp_path: Path) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'migration.db'}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "0057_enterprise_identity_scope")
    upgraded = inspect(engine)
    identity_tables = {
        "ai_organizations",
        "ai_organization_units",
        "ai_enterprise_customers",
        "ai_customer_identity_bindings",
        "ai_enterprise_entity_refs",
        "ai_enterprise_entity_aliases",
    }
    assert identity_tables.issubset(set(upgraded.get_table_names()))
    assert {
        "organization_id",
        "owner_department_id",
        "primary_customer_id",
    }.issubset({column["name"] for column in upgraded.get_columns("ai_projects")})
    assert {"organization_id", "customer_id"}.issubset(
        {column["name"] for column in upgraded.get_columns("ai_project_contracts")}
    )

    command.downgrade(config, "0056_workflow_fencing_and_wait_tokens")
    reverted = inspect(engine)
    assert identity_tables.isdisjoint(set(reverted.get_table_names()))
    assert {"organization_id", "owner_department_id", "primary_customer_id"}.isdisjoint(
        {column["name"] for column in reverted.get_columns("ai_projects")}
    )
