from pathlib import Path

from alembic import command
from sqlalchemy import create_engine, inspect

from app import models  # noqa: F401
from app.database import Base
from app.enterprise_insight_models import (
    EnterpriseInsight,
    EnterpriseInsightEvidence,
    EnterpriseInsightRule,
    EnterpriseInsightRuleVersion,
    EnterpriseRecommendation,
    EnterpriseRecommendationAction,
)
from tests.test_migrations import migration_config


INSIGHT_TABLES = {
    "ai_enterprise_insight_rules",
    "ai_enterprise_insight_rule_versions",
    "ai_enterprise_insights",
    "ai_enterprise_insight_evidence",
    "ai_enterprise_recommendations",
    "ai_enterprise_recommendation_actions",
}


def test_insight_metadata_registers_versioned_tables() -> None:
    assert INSIGHT_TABLES.issubset(Base.metadata.tables)
    assert EnterpriseInsightRule.__tablename__ == "ai_enterprise_insight_rules"
    assert EnterpriseInsightRuleVersion.__tablename__ == "ai_enterprise_insight_rule_versions"
    assert EnterpriseInsight.__tablename__ == "ai_enterprise_insights"
    assert EnterpriseInsightEvidence.__tablename__ == "ai_enterprise_insight_evidence"
    assert EnterpriseRecommendation.__tablename__ == "ai_enterprise_recommendations"
    assert EnterpriseRecommendationAction.__tablename__ == "ai_enterprise_recommendation_actions"


def test_insight_migration_upgrades_and_downgrades_from_0060(tmp_path: Path) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'insights.db'}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "0061_enterprise_insights_recommendations")
    upgraded = inspect(engine)
    assert INSIGHT_TABLES.issubset(set(upgraded.get_table_names()))
    indexes = {index["name"] for index in upgraded.get_indexes("ai_enterprise_insights")}
    assert "ix_ai_enterprise_insights_evidence_fingerprint" in indexes
    action_indexes = {index["name"] for index in upgraded.get_indexes("ai_enterprise_recommendation_actions")}
    assert "ix_ai_enterprise_recommendation_actions_reconciliation_status" in action_indexes

    command.downgrade(config, "0060_enterprise_graph_memory")
    reverted = inspect(engine)
    assert INSIGHT_TABLES.isdisjoint(set(reverted.get_table_names()))
