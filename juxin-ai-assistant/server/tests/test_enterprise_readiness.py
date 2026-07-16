"""Enterprise Intelligence 5.0 readiness checks."""

from sqlalchemy import text

from app.config import get_settings
from app.enterprise_intelligence.readiness import (
    CURRENT_ENTERPRISE_MIGRATION_HEAD,
    REQUIRED_ENTERPRISE_TABLES,
    build_enterprise_readiness,
)


def _check(report: dict, check_id: str) -> dict:
    return next(item for item in report["checks"] if item["id"] == check_id)


def test_enterprise_readiness_reports_schema_and_local_gates(generation_db) -> None:
    report = build_enterprise_readiness(generation_db, get_settings())

    schema = _check(report, "enterprise_schema")
    assert schema["status"] == "pass"
    assert not schema["missing_tables"]
    assert REQUIRED_ENTERPRISE_TABLES
    assert _check(report, "enterprise_migration")["status"] == "warn"
    assert _check(report, "enterprise_worker")["status"] == "warn"
    assert _check(report, "enterprise_notification_provider")["status"] == "warn"
    assert report["overall"] == "ready_with_warnings"


def test_enterprise_readiness_fails_when_a_core_table_is_missing(
    generation_db, monkeypatch
) -> None:
    from app.enterprise_intelligence import readiness

    actual_tables = set(readiness.inspect(generation_db.get_bind()).get_table_names())
    actual_tables.remove("ai_enterprise_insights")

    class FakeInspector:
        def get_table_names(self):
            return list(actual_tables)

    monkeypatch.setattr(readiness, "inspect", lambda _bind: FakeInspector())
    report = build_enterprise_readiness(generation_db, get_settings())

    schema = _check(report, "enterprise_schema")
    assert schema["status"] == "fail"
    assert schema["missing_tables"] == ["ai_enterprise_insights"]
    assert report["overall"] == "not_ready"


def test_enterprise_readiness_accepts_only_the_current_single_migration_head(
    generation_db,
) -> None:
    generation_db.execute(
        text("CREATE TABLE alembic_version (version_num VARCHAR(128) NOT NULL)")
    )
    generation_db.execute(
        text("INSERT INTO alembic_version(version_num) VALUES ('0062_enterprise_capability_evaluation')")
    )
    generation_db.commit()

    report = build_enterprise_readiness(generation_db, get_settings())
    migration = _check(report, "enterprise_migration")
    assert migration["status"] == "fail"
    assert migration["expected_head"] == CURRENT_ENTERPRISE_MIGRATION_HEAD
    assert migration["versions"] == ["0062_enterprise_capability_evaluation"]


def test_enterprise_readiness_accepts_a_later_single_head_with_enterprise_baseline(
    generation_db,
) -> None:
    generation_db.execute(
        text("CREATE TABLE alembic_version (version_num VARCHAR(128) NOT NULL)")
    )
    generation_db.execute(
        text("INSERT INTO alembic_version(version_num) VALUES ('0064_knowledge_external_download_control')")
    )
    generation_db.commit()

    report = build_enterprise_readiness(generation_db, get_settings())
    migration = _check(report, "enterprise_migration")
    assert migration["status"] == "pass"
    assert migration["versions"] == ["0064_knowledge_external_download_control"]
