import base64
import shutil
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from app.crypto import ContentCipher
from scripts.seed_professional_catalog import seed_professional_catalog


SERVER_ROOT = Path(__file__).resolve().parents[1]
PROFESSIONAL_TABLES = {
    "ai_approval_flow_definitions",
    "ai_catalog_mutation_records",
    "ai_quality_rule_definitions",
    "ai_skill_definitions",
    "ai_template_definitions",
    "ai_approval_flow_versions",
    "ai_quality_rule_versions",
    "ai_template_versions",
    "ai_professional_model_step_tokens",
    "ai_skill_versions",
    "ai_skill_selection_records",
    "ai_deliverable_approval_events",
    "ai_deliverable_comments",
    "ai_deliverable_evidence",
    "ai_deliverable_exports",
    "ai_deliverable_facts",
    "ai_deliverable_idempotency_records",
    "ai_deliverable_review_runs",
    "ai_professional_run_bindings",
    "ai_deliverable_comment_replies",
    "ai_deliverable_delivery_records",
    "ai_deliverable_experience_candidates",
    "ai_legacy_deliverable_mappings",
    "ai_deliverable_review_issues",
    "ai_fact_evidence_links",
}


def _clean_3_0_migration_config(tmp_path: Path) -> tuple[Config, Path]:
    source = SERVER_ROOT / "alembic"
    target = tmp_path / "alembic"
    versions = target / "versions"
    versions.mkdir(parents=True)
    shutil.copy2(source / "env.py", target / "env.py")
    shutil.copy2(source / "script.py.mako", target / "script.py.mako")

    for migration in (source / "versions").glob("*.py"):
        prefix = migration.name[:4]
        if not prefix.isdigit():
            continue
        number = int(prefix)
        if number <= 26 or 46 <= number <= 51:
            shutil.copy2(migration, versions / migration.name)

    database_path = tmp_path / "professional-delivery.sqlite3"
    config = Config()
    config.set_main_option("script_location", str(target))
    config.set_main_option("sqlalchemy.url", f"sqlite+pysqlite:///{database_path}")
    return config, database_path


def _insert_legacy_artifact(database_path: Path) -> None:
    engine = create_engine(f"sqlite+pysqlite:///{database_path}")
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO ai_work_artifacts (
                    uuid, owner_user_id, conversation_id, message_id,
                    task_state_id, export_record_uuid, title, artifact_type,
                    source_scope, source_summary_json, content_summary,
                    file_name, file_path_or_blob_ref, version, status
                ) VALUES (
                    'legacy-artifact', 'legacy-owner', 'conversation-1',
                    'message-1', 'task-state-1', '', '历史成果', 'report',
                    'personal', '[]', '历史摘要', 'legacy.docx',
                    'legacy/legacy.docx', 1, 'active'
                )
                """
            )
        )
        artifact_id = connection.execute(
            text("SELECT id FROM ai_work_artifacts WHERE uuid = 'legacy-artifact'")
        ).scalar_one()
        connection.execute(
            text(
                """
                INSERT INTO ai_work_artifact_versions (
                    uuid, artifact_id, version, source, source_ref, file_name,
                    file_path_or_blob_ref, source_summary_json, content_summary,
                    status
                ) VALUES (
                    'legacy-version', :artifact_id, 1, 'legacy', 'legacy-ref',
                    'legacy.docx', 'legacy/legacy.docx', '[]', '历史摘要',
                    'active'
                )
                """
            ),
            {"artifact_id": artifact_id},
        )
    engine.dispose()


def test_professional_delivery_migration_upgrades_backfills_and_downgrades(
    tmp_path: Path,
) -> None:
    config, database_path = _clean_3_0_migration_config(tmp_path)
    script = ScriptDirectory.from_config(config)

    assert script.get_heads() == ["0051_professional_delivery"]
    assert [revision.revision for revision in script.walk_revisions()][:7] == [
        "0051_professional_delivery",
        "0050_project_task_delivery_activity",
        "0049_project_context_resources",
        "0048_project_initialization_foundation",
        "0047_project_chat_workspace",
        "0046_project_workspace_foundation",
        "0026_agent_run_contracts",
    ]

    command.upgrade(config, "0050_project_task_delivery_activity")
    _insert_legacy_artifact(database_path)
    command.upgrade(config, "0051_professional_delivery")

    engine = create_engine(f"sqlite+pysqlite:///{database_path}")
    inspector = inspect(engine)
    assert PROFESSIONAL_TABLES <= set(inspector.get_table_names())
    assert {
        "deliverable_type",
        "scope_type",
        "lifecycle_status",
        "current_version_id",
        "approved_version_id",
        "delivered_version_id",
        "row_version",
        "created_by",
    } <= {column["name"] for column in inspector.get_columns("ai_work_artifacts")}
    assert {
        "content_hash",
        "title_snapshot",
        "summary_snapshot",
        "project_scope_snapshot_json",
        "input_summary_json",
        "source_policy_snapshot_json",
        "creation_reason",
        "legacy_incomplete",
    } <= {
        column["name"]
        for column in inspector.get_columns("ai_work_artifact_versions")
    }

    with engine.connect() as connection:
        artifact = connection.execute(
            text(
                "SELECT deliverable_type, created_by, current_version_id "
                "FROM ai_work_artifacts WHERE uuid = 'legacy-artifact'"
            )
        ).one()
        version = connection.execute(
            text(
                "SELECT id, title_snapshot, summary_snapshot, creation_reason, "
                "legacy_incomplete, project_scope_snapshot_json, "
                "input_summary_json, source_policy_snapshot_json "
                "FROM ai_work_artifact_versions WHERE uuid = 'legacy-version'"
            )
        ).one()

    assert artifact.deliverable_type == "report"
    assert artifact.created_by == "legacy-owner"
    assert artifact.current_version_id == version.id
    assert version.title_snapshot == "历史成果"
    assert version.summary_snapshot == "历史摘要"
    assert version.creation_reason == "legacy"
    assert version.legacy_incomplete in {True, 1}
    assert version.project_scope_snapshot_json == "{}"
    assert version.input_summary_json == "{}"
    assert version.source_policy_snapshot_json == "{}"
    engine.dispose()

    command.downgrade(config, "0050_project_task_delivery_activity")
    engine = create_engine(f"sqlite+pysqlite:///{database_path}")
    inspector = inspect(engine)
    assert PROFESSIONAL_TABLES.isdisjoint(inspector.get_table_names())
    assert "deliverable_type" not in {
        column["name"] for column in inspector.get_columns("ai_work_artifacts")
    }
    assert "title_snapshot" not in {
        column["name"]
        for column in inspector.get_columns("ai_work_artifact_versions")
    }
    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT COUNT(*) FROM ai_work_artifacts WHERE uuid = 'legacy-artifact'")
        ).scalar_one() == 1
    engine.dispose()


def test_professional_catalog_seed_is_idempotent(generation_db) -> None:
    cipher = ContentCipher(base64.urlsafe_b64encode(b"s" * 32).decode("ascii"))

    first = seed_professional_catalog(
        generation_db,
        cipher=cipher,
        key_version="v1",
    )
    second = seed_professional_catalog(
        generation_db,
        cipher=cipher,
        key_version="v1",
    )

    assert first == {
        "created_count": 65,
        "skill_count": 7,
        "template_count": 7,
        "approval_flow_count": 2,
        "quality_rule_count": 49,
    }
    assert second == {
        "created_count": 0,
        "skill_count": 7,
        "template_count": 7,
        "approval_flow_count": 2,
        "quality_rule_count": 49,
    }
