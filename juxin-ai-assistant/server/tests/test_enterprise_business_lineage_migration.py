from pathlib import Path

from alembic import command
from sqlalchemy import create_engine, inspect

from app import models  # noqa: F401
from app.database import Base
from app.enterprise_business_lineage_models import (
    ProjectCustomerLink,
    ProjectRemediation,
    ProjectRemediationEvidenceLink,
    ProjectServiceOccurrence,
)
from tests.test_migrations import migration_config


def test_business_lineage_metadata_registers_relations_and_authoritative_mapping() -> None:
    expected_tables = {
        "ai_project_customer_links",
        "ai_project_service_occurrences",
        "ai_project_issue_asset_links",
        "ai_project_remediations",
        "ai_remediation_evidence_links",
    }

    assert expected_tables.issubset(Base.metadata.tables)
    task_columns = set(Base.metadata.tables["ai_project_tasks"].columns.keys())
    assert {"service_scope_id", "execution_rule_id", "workflow_run_id"}.issubset(task_columns)
    deliverable_columns = set(Base.metadata.tables["ai_project_deliverables"].columns.keys())
    assert {"work_artifact_id", "work_artifact_version_id"}.issubset(deliverable_columns)

    assert ProjectCustomerLink.__tablename__ == "ai_project_customer_links"
    assert ProjectServiceOccurrence.__tablename__ == "ai_project_service_occurrences"
    assert ProjectRemediation.__tablename__ == "ai_project_remediations"
    assert ProjectRemediationEvidenceLink.__tablename__ == "ai_remediation_evidence_links"


def test_business_lineage_migration_upgrades_and_downgrades_from_0057(tmp_path: Path) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'migration.db'}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "0058_enterprise_business_lineage")
    upgraded = inspect(engine)
    expected_tables = {
        "ai_project_customer_links",
        "ai_project_service_occurrences",
        "ai_project_issue_asset_links",
        "ai_project_remediations",
        "ai_remediation_evidence_links",
    }
    assert expected_tables.issubset(set(upgraded.get_table_names()))
    assert {
        "service_scope_id",
        "execution_rule_id",
        "workflow_run_id",
    }.issubset({column["name"] for column in upgraded.get_columns("ai_project_tasks")})
    assert {"work_artifact_id", "work_artifact_version_id"}.issubset(
        {column["name"] for column in upgraded.get_columns("ai_project_deliverables")}
    )

    occurrence_indexes = {index["name"] for index in upgraded.get_indexes("ai_project_service_occurrences")}
    assert "ix_ai_project_service_occurrences_project_id_due_at" in occurrence_indexes

    command.downgrade(config, "0057_enterprise_identity_scope")
    reverted = inspect(engine)
    assert expected_tables.isdisjoint(set(reverted.get_table_names()))
    assert {"service_scope_id", "execution_rule_id", "workflow_run_id"}.isdisjoint(
        {column["name"] for column in reverted.get_columns("ai_project_tasks")}
    )
    assert {"work_artifact_id", "work_artifact_version_id"}.isdisjoint(
        {column["name"] for column in reverted.get_columns("ai_project_deliverables")}
    )
