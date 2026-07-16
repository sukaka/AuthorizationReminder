from pathlib import Path

from alembic import command
from sqlalchemy import create_engine, inspect

from app import models  # noqa: F401
from app.database import Base
from app.enterprise_capability_models import (
    EnterpriseCapabilityEvaluation,
    EnterpriseCapabilityObservation,
    EnterpriseOptimizationProposal,
    EnterpriseOptimizationProposalEvent,
)
from tests.test_migrations import migration_config


CAPABILITY_TABLES = {
    "ai_enterprise_capability_evaluations",
    "ai_enterprise_optimization_proposals",
    "ai_enterprise_optimization_proposal_events",
    "ai_enterprise_capability_observations",
}


def test_capability_metadata_registers_versioned_tables() -> None:
    assert CAPABILITY_TABLES.issubset(Base.metadata.tables)
    assert EnterpriseCapabilityEvaluation.__tablename__ == "ai_enterprise_capability_evaluations"
    assert EnterpriseOptimizationProposal.__tablename__ == "ai_enterprise_optimization_proposals"
    assert EnterpriseOptimizationProposalEvent.__tablename__ == "ai_enterprise_optimization_proposal_events"
    assert EnterpriseCapabilityObservation.__tablename__ == "ai_enterprise_capability_observations"


def test_capability_migration_upgrades_and_downgrades_from_0061(tmp_path: Path) -> None:
    database_url = f"sqlite+pysqlite:///{tmp_path / 'capability.db'}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "0062_enterprise_capability_evaluation")
    upgraded = inspect(engine)
    assert CAPABILITY_TABLES.issubset(set(upgraded.get_table_names()))
    evaluation_indexes = {
        index["name"] for index in upgraded.get_indexes("ai_enterprise_capability_evaluations")
    }
    assert "ix_ai_enterprise_capability_evaluations_evaluation_fingerprint" in evaluation_indexes
    proposal_indexes = {
        index["name"] for index in upgraded.get_indexes("ai_enterprise_optimization_proposals")
    }
    assert "ix_ai_enterprise_optimization_proposals_scope_fingerprint" in proposal_indexes

    command.downgrade(config, "0061_enterprise_insights_recommendations")
    reverted = inspect(engine)
    assert CAPABILITY_TABLES.isdisjoint(set(reverted.get_table_names()))
