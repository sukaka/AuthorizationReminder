from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    run_compat_migrations()


def run_compat_migrations() -> None:
    inspector = inspect(engine)
    if not inspector.has_table("components"):
        return
    existing = {column["name"] for column in inspector.get_columns("components")}
    additions = {
        "ecosystem": "VARCHAR(40) NOT NULL DEFAULT 'unknown'",
        "scope": "VARCHAR(40) NOT NULL DEFAULT 'runtime'",
        "source_path": "VARCHAR(512) NOT NULL DEFAULT ''",
        "normalized_name": "VARCHAR(200) NOT NULL DEFAULT ''",
        "package_manager": "VARCHAR(40) NOT NULL DEFAULT ''",
        "purl": "VARCHAR(512) NOT NULL DEFAULT ''",
        "cpe": "VARCHAR(512) NOT NULL DEFAULT ''",
        "group_id": "VARCHAR(160) NOT NULL DEFAULT ''",
        "artifact_id": "VARCHAR(160) NOT NULL DEFAULT ''",
        "version_normalized": "VARCHAR(80) NOT NULL DEFAULT ''",
        "dependency_type": "VARCHAR(40) NOT NULL DEFAULT 'direct'",
        "source_file": "VARCHAR(512) NOT NULL DEFAULT ''",
        "evidence_level": "VARCHAR(40) NOT NULL DEFAULT 'manifest'",
        "evidence_file": "VARCHAR(512) NOT NULL DEFAULT ''",
        "evidence_line": "INTEGER NOT NULL DEFAULT 0",
        "evidence_text": "TEXT NOT NULL DEFAULT ''",
        "detected_by": "VARCHAR(80) NOT NULL DEFAULT 'manifest'",
        "confidence_score": "FLOAT NOT NULL DEFAULT 0",
        "version_conflict": "BOOLEAN NOT NULL DEFAULT FALSE",
        "conflict_reason": "TEXT NOT NULL DEFAULT ''",
        "scan_mode": "VARCHAR(48) NOT NULL DEFAULT 'manifest_scan'",
        "detection_method": "VARCHAR(80) NOT NULL DEFAULT 'manifest'",
        "evidence_type": "VARCHAR(80) NOT NULL DEFAULT 'manifest'",
        "confidence_level": "VARCHAR(32) NOT NULL DEFAULT 'Medium'",
        "need_manual_confirm": "BOOLEAN NOT NULL DEFAULT FALSE",
        "version_detected": "BOOLEAN NOT NULL DEFAULT TRUE",
        "need_manual_version_confirm": "BOOLEAN NOT NULL DEFAULT FALSE",
        "declared_version": "VARCHAR(160) NOT NULL DEFAULT ''",
        "resolved_version": "VARCHAR(160) NOT NULL DEFAULT ''",
        "version_lock_status": "VARCHAR(64) NOT NULL DEFAULT '已锁定版本'",
        "version_risk_type": "VARCHAR(64) NOT NULL DEFAULT ''",
        "risk_explanation": "TEXT NOT NULL DEFAULT ''",
        "fix_recommendation": "TEXT NOT NULL DEFAULT ''",
        "sha1": "VARCHAR(64) NOT NULL DEFAULT ''",
        "sha256": "VARCHAR(96) NOT NULL DEFAULT ''",
        "component_file_size": "BIGINT NOT NULL DEFAULT 0",
        "component_file_path": "VARCHAR(1024) NOT NULL DEFAULT ''",
        "component_file_name": "VARCHAR(255) NOT NULL DEFAULT ''",
    }
    scan_task_additions = {
        "parent_task_id": "INTEGER",
        "task_type": "VARCHAR(80) NOT NULL DEFAULT 'project_scan_task'",
        "engine_name": "VARCHAR(80) NOT NULL DEFAULT ''",
        "progress": "INTEGER NOT NULL DEFAULT 0",
        "timeout_seconds": "INTEGER NOT NULL DEFAULT 0",
        "error_message": "TEXT NOT NULL DEFAULT ''",
        "raw_result_path": "VARCHAR(1024) NOT NULL DEFAULT ''",
        "normalized_result_path": "VARCHAR(1024) NOT NULL DEFAULT ''",
        "updated_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
    }
    vulnerability_additions = {
        "epss_score": "FLOAT NOT NULL DEFAULT 0",
        "cisa_kev": "BOOLEAN NOT NULL DEFAULT FALSE",
        "confidence_score": "FLOAT NOT NULL DEFAULT 0.7",
        "match_status": "VARCHAR(32) NOT NULL DEFAULT 'affected'",
        "matched_by": "VARCHAR(80) NOT NULL DEFAULT ''",
        "match_reason": "TEXT NOT NULL DEFAULT ''",
        "version_range": "VARCHAR(240) NOT NULL DEFAULT ''",
        "needs_human_review": "BOOLEAN NOT NULL DEFAULT FALSE",
        "false_positive_possibility": "VARCHAR(32) NOT NULL DEFAULT 'medium'",
        "risk_priority": "VARCHAR(16) NOT NULL DEFAULT 'Review'",
        "risk_score": "FLOAT NOT NULL DEFAULT 0",
        "priority_reason": "TEXT NOT NULL DEFAULT ''",
        "suggested_deadline": "VARCHAR(80) NOT NULL DEFAULT '人工确认后排期'",
        "remediation_type": "VARCHAR(40) NOT NULL DEFAULT '人工确认'",
        "business_impact": "TEXT NOT NULL DEFAULT ''",
        "reachability_status": "VARCHAR(32) NOT NULL DEFAULT 'unknown'",
        "reachability_evidence": "TEXT NOT NULL DEFAULT ''",
        "entry_points": "TEXT NOT NULL DEFAULT ''",
        "related_files": "TEXT NOT NULL DEFAULT ''",
        "call_path_summary": "TEXT NOT NULL DEFAULT ''",
    }
    ai_triage_additions = {
        "ai_schema_version": "VARCHAR(32) NOT NULL DEFAULT 'ai-triage-v2'",
        "input_hash": "VARCHAR(64) NOT NULL DEFAULT ''",
        "ai_priority": "VARCHAR(20) NOT NULL DEFAULT 'Review'",
        "confidence": "FLOAT NOT NULL DEFAULT 0",
        "is_likely_false_positive": "BOOLEAN NOT NULL DEFAULT FALSE",
        "reason": "TEXT NOT NULL DEFAULT ''",
        "evidence_summary": "TEXT NOT NULL DEFAULT ''",
        "business_impact": "TEXT NOT NULL DEFAULT ''",
        "fix_advice": "TEXT NOT NULL DEFAULT ''",
        "temporary_mitigation": "TEXT NOT NULL DEFAULT ''",
        "need_manual_review": "BOOLEAN NOT NULL DEFAULT FALSE",
        "manual_review_reason": "TEXT NOT NULL DEFAULT ''",
    }
    with engine.begin() as conn:
        for foreign_key in inspector.get_foreign_keys("components"):
            if foreign_key.get("referred_table") == "analysis_projects" and foreign_key.get("constrained_columns") == ["project_id"]:
                name = foreign_key.get("name")
                if name and engine.dialect.name == "postgresql":
                    conn.execute(text(f'ALTER TABLE components DROP CONSTRAINT IF EXISTS "{name}"'))
        for column, definition in additions.items():
            if column not in existing:
                conn.execute(text(f"ALTER TABLE components ADD COLUMN {column} {definition}"))
        if inspector.has_table("scan_tasks"):
            scan_task_existing = {column["name"] for column in inspector.get_columns("scan_tasks")}
            for column, definition in scan_task_additions.items():
                if column not in scan_task_existing:
                    conn.execute(text(f"ALTER TABLE scan_tasks ADD COLUMN {column} {definition}"))
        if inspector.has_table("vulnerabilities"):
            vulnerability_existing = {column["name"] for column in inspector.get_columns("vulnerabilities")}
            for column, definition in vulnerability_additions.items():
                if column not in vulnerability_existing:
                    conn.execute(text(f"ALTER TABLE vulnerabilities ADD COLUMN {column} {definition}"))
        if inspector.has_table("ai_triage_results"):
            ai_existing = {column["name"] for column in inspector.get_columns("ai_triage_results")}
            for column, definition in ai_triage_additions.items():
                if column not in ai_existing:
                    conn.execute(text(f"ALTER TABLE ai_triage_results ADD COLUMN {column} {definition}"))


def check_database() -> bool:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return True
