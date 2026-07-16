from pathlib import Path

from alembic import command
from sqlalchemy import create_engine, inspect

from app import models  # noqa: F401
from app.database import Base
from app.enterprise_graph_memory_models import (
    EnterpriseGraphRelation,
    EnterpriseGraphRelationEvidence,
    EnterpriseOrgMemoryCandidate,
    EnterpriseOrgMemoryItem,
    EnterpriseOrgMemoryReview,
    EnterpriseOrgMemoryVersion,
)
from tests.test_migrations import migration_config


GRAPH_MEMORY_TABLES = {
    "ai_enterprise_graph_relations",
    "ai_enterprise_graph_relation_evidence",
    "ai_enterprise_org_memory_items",
    "ai_enterprise_org_memory_versions",
    "ai_enterprise_org_memory_reviews",
    "ai_enterprise_org_memory_candidates",
}


def test_graph_memory_metadata_registers_versioned_tables() -> None:
    assert GRAPH_MEMORY_TABLES.issubset(Base.metadata.tables)
    assert EnterpriseGraphRelation.__tablename__ == "ai_enterprise_graph_relations"
    assert EnterpriseGraphRelationEvidence.__tablename__ == "ai_enterprise_graph_relation_evidence"
    assert EnterpriseOrgMemoryItem.__tablename__ == "ai_enterprise_org_memory_items"
    assert EnterpriseOrgMemoryVersion.__tablename__ == "ai_enterprise_org_memory_versions"
    assert EnterpriseOrgMemoryReview.__tablename__ == "ai_enterprise_org_memory_reviews"
    assert EnterpriseOrgMemoryCandidate.__tablename__ == "ai_enterprise_org_memory_candidates"


def test_graph_memory_migration_upgrades_and_downgrades_from_0059(tmp_path: Path) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'graph-memory.db'}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "0060_enterprise_graph_memory")
    upgraded = inspect(engine)
    assert GRAPH_MEMORY_TABLES.issubset(set(upgraded.get_table_names()))
    indexes = {index["name"] for index in upgraded.get_indexes("ai_enterprise_graph_relations")}
    assert "ix_ai_enterprise_graph_relations_scope_fingerprint" in indexes
    memory_indexes = {index["name"] for index in upgraded.get_indexes("ai_enterprise_org_memory_candidates")}
    assert "ix_ai_enterprise_org_memory_candidates_fingerprint" in memory_indexes

    command.downgrade(config, "0059_enterprise_metrics_health")
    reverted = inspect(engine)
    assert GRAPH_MEMORY_TABLES.isdisjoint(set(reverted.get_table_names()))
