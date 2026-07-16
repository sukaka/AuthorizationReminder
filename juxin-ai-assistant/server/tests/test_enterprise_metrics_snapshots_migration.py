from pathlib import Path

from alembic import command
from sqlalchemy import create_engine, inspect

from app import models  # noqa: F401
from app.database import Base
from app.enterprise_metrics_models import (
    EnterpriseDataQualityIssue,
    EnterpriseMetricDefinition,
    EnterpriseMetricSnapshot,
    EnterpriseProjectHealthSnapshot,
)
from tests.test_migrations import migration_config


def test_metrics_metadata_registers_versioned_immutable_tables() -> None:
    expected_tables = {
        "ai_enterprise_metric_definitions",
        "ai_enterprise_metric_snapshots",
        "ai_enterprise_project_health_snapshots",
        "ai_enterprise_data_quality_issues",
    }

    assert expected_tables.issubset(Base.metadata.tables)
    assert EnterpriseMetricDefinition.__tablename__ == "ai_enterprise_metric_definitions"
    assert EnterpriseMetricSnapshot.__tablename__ == "ai_enterprise_metric_snapshots"
    assert EnterpriseProjectHealthSnapshot.__tablename__ == "ai_enterprise_project_health_snapshots"
    assert EnterpriseDataQualityIssue.__tablename__ == "ai_enterprise_data_quality_issues"
    assert {
        "scope_fingerprint",
        "definition_version",
        "data_cutoff_at",
        "source_hash",
    }.issubset(Base.metadata.tables["ai_enterprise_metric_snapshots"].columns.keys())


def test_metrics_migration_upgrades_and_downgrades_from_0058(tmp_path: Path) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'metrics.db'}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "0059_enterprise_metrics_health")
    upgraded = inspect(engine)
    expected_tables = {
        "ai_enterprise_metric_definitions",
        "ai_enterprise_metric_snapshots",
        "ai_enterprise_project_health_snapshots",
        "ai_enterprise_data_quality_issues",
    }
    assert expected_tables.issubset(set(upgraded.get_table_names()))
    snapshot_indexes = {
        index["name"] for index in upgraded.get_indexes("ai_enterprise_metric_snapshots")
    }
    assert "ix_ai_enterprise_metric_snapshots_scope_metric_cutoff" in snapshot_indexes

    command.downgrade(config, "0058_enterprise_business_lineage")
    reverted = inspect(engine)
    assert expected_tables.isdisjoint(set(reverted.get_table_names()))
