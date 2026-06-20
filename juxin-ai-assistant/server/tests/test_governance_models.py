from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app import models  # noqa: F401
from app.database import Base


SERVER_ROOT = Path(__file__).resolve().parents[1]
GOVERNANCE_TABLES = {
    "ai_task_suggestions",
    "ai_system_settings",
    "ai_audit_logs",
}


def test_governance_tables_have_required_constraints_and_indexes() -> None:
    # Given: all ORM metadata is registered.
    engine = create_engine("sqlite+pysqlite:///:memory:")

    # When: the schema is created.
    Base.metadata.create_all(engine)
    inspector = inspect(engine)

    # Then: governance tables and their lookup contracts exist.
    assert GOVERNANCE_TABLES <= set(inspector.get_table_names())
    setting_uniques = {
        tuple(item["column_names"])
        for item in inspector.get_unique_constraints("ai_system_settings")
    }
    suggestion_indexes = {
        item["name"] for item in inspector.get_indexes("ai_task_suggestions")
    }
    suggestion_checks = {
        item["name"]
        for item in inspector.get_check_constraints("ai_task_suggestions")
    }
    audit_indexes = {
        item["name"] for item in inspector.get_indexes("ai_audit_logs")
    }
    assert ("setting_key",) in setting_uniques
    assert {
        "ix_ai_task_suggestions_sso_user_id",
        "ix_ai_task_suggestions_department_code",
        "ix_ai_task_suggestions_status",
    } <= suggestion_indexes
    assert {
        "ck_ai_task_suggestions_content_pair",
        "ck_ai_task_suggestions_review_comment_pair",
    } <= suggestion_checks
    assert {
        "idx_ai_audit_created",
        "idx_ai_audit_entity",
        "ix_ai_audit_logs_sso_user_id",
        "ix_ai_audit_logs_action",
    } <= audit_indexes
    engine.dispose()


def test_governance_migration_upgrades_from_and_downgrades_to_0002(
    tmp_path: Path,
) -> None:
    # Given: a database at the employee-feature revision.
    database_url = f"sqlite+pysqlite:///{tmp_path / 'governance.db'}"
    config = Config(str(SERVER_ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", database_url)
    engine = create_engine(database_url)
    command.upgrade(config, "0002_employee_features")
    assert GOVERNANCE_TABLES.isdisjoint(set(inspect(engine).get_table_names()))
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO ai_assistants "
                "(uuid, code, name, description, icon, sort_order, status, "
                "created_by, updated_by) VALUES "
                "('assistant-migration', 'migration', '迁移助手', '', '', 0, "
                "'ACTIVE', 'test', 'test')"
            )
        )
        assistant_id = connection.scalar(
            text("SELECT id FROM ai_assistants WHERE code = 'migration'")
        )
        connection.execute(
            text(
                "INSERT INTO ai_tasks "
                "(uuid, assistant_id, code, name, description, output_format, "
                "safety_notice, sort_order, status, created_by, updated_by) "
                "VALUES (:uuid, :assistant_id, :code, :name, '', 'Markdown', "
                "'', 0, :status, 'test', 'test')"
            ),
            [
                {
                    "uuid": "active-before-governance",
                    "assistant_id": assistant_id,
                    "code": "active-before-governance",
                    "name": "历史激活任务",
                    "status": "ACTIVE",
                },
                {
                    "uuid": "draft-before-governance",
                    "assistant_id": assistant_id,
                    "code": "draft-before-governance",
                    "name": "历史草稿任务",
                    "status": "DRAFT",
                },
            ],
        )

    # When: governance is upgraded and then downgraded.
    command.upgrade(config, "0003_governance")
    upgraded_tables = set(inspect(engine).get_table_names())
    upgraded_task_columns = {
        item["name"] for item in inspect(engine).get_columns("ai_tasks")
    }
    upgraded_checks = {
        item["name"]
        for item in inspect(engine).get_check_constraints(
            "ai_task_suggestions"
        )
    }
    with engine.connect() as connection:
        activation_history = dict(
            connection.execute(
                text("SELECT code, ever_active FROM ai_tasks")
            ).all()
        )
    command.downgrade(config, "0002_employee_features")
    downgraded_tables = set(inspect(engine).get_table_names())
    downgraded_task_columns = {
        item["name"] for item in inspect(engine).get_columns("ai_tasks")
    }

    # Then: only the governance tables are reversed.
    assert GOVERNANCE_TABLES <= upgraded_tables
    assert "ever_active" in upgraded_task_columns
    assert activation_history == {
        "active-before-governance": 1,
        "draft-before-governance": 0,
    }
    assert {
        "ck_ai_task_suggestions_content_pair",
        "ck_ai_task_suggestions_review_comment_pair",
    } <= upgraded_checks
    assert GOVERNANCE_TABLES.isdisjoint(downgraded_tables)
    assert "ever_active" not in downgraded_task_columns
    assert "ai_user_favorites" in downgraded_tables
    engine.dispose()
