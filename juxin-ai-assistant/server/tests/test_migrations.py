from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

SERVER_ROOT = Path(__file__).resolve().parents[1]
FOUNDATION_TABLES = {
    "ai_assistants",
    "ai_tasks",
    "ai_task_fields",
    "ai_task_prompt_bindings",
    "ai_generation_records",
}


def migration_config(database_url: str) -> Config:
    config_path = SERVER_ROOT / "alembic.ini"
    migration_path = SERVER_ROOT / "alembic" / "versions" / "0001_foundation.py"
    assert config_path.is_file(), "alembic.ini must exist"
    assert migration_path.is_file(), "foundation migration must exist"
    config = Config(str(config_path))
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def test_foundation_migration_round_trip(tmp_path: Path) -> None:
    database_path = tmp_path / "migration.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "head")
    assert FOUNDATION_TABLES.issubset(set(inspect(engine).get_table_names()))

    command.downgrade(config, "base")
    assert FOUNDATION_TABLES.isdisjoint(set(inspect(engine).get_table_names()))

    command.upgrade(config, "head")
    assert FOUNDATION_TABLES.issubset(set(inspect(engine).get_table_names()))


def test_task_document_metadata_migration_round_trip(tmp_path: Path) -> None:
    database_path = tmp_path / "task-metadata.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "0004_desktop_updates")
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO ai_assistants "
                "(uuid, code, name, description, icon, sort_order, status, "
                "created_by, updated_by) "
                "VALUES (:uuid, :code, :name, '', 'sparkles', 0, 'ACTIVE', "
                "'system', 'system')"
            ),
            {
                "uuid": "00000000-0000-0000-0000-000000000001",
                "code": "migration-assistant",
                "name": "迁移助手",
            },
        )
        assistant_id = connection.execute(
            text(
                "SELECT id FROM ai_assistants "
                "WHERE code = 'migration-assistant'"
            )
        ).scalar_one()
        connection.execute(
            text(
                "INSERT INTO ai_tasks "
                "(uuid, assistant_id, code, name, description, output_format, "
                "safety_notice, sort_order, status, ever_active, created_by, "
                "updated_by) "
                "VALUES (:uuid, :assistant_id, :code, :name, '', 'Markdown', "
                "'生成内容需人工复核', 0, 'ACTIVE', 1, 'system', 'system')"
            ),
            {
                "uuid": "00000000-0000-0000-0000-000000000002",
                "assistant_id": assistant_id,
                "code": "migration-task",
                "name": "迁移任务",
            },
        )

    command.upgrade(config, "0005_task_document_metadata")
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT source_version, source_ref, document_type, "
                "formal_document FROM ai_tasks WHERE code = 'migration-task'"
            )
        ).one()
    assert tuple(row) == ("", "", "PLAIN_TEXT", False)

    columns = {
        column["name"]: column
        for column in inspect(engine).get_columns("ai_tasks")
    }
    for column_name in (
        "source_version",
        "source_ref",
        "document_type",
        "formal_document",
    ):
        assert columns[column_name]["nullable"] is False
        assert columns[column_name]["default"] is None

    command.downgrade(config, "0004_desktop_updates")
    downgraded_columns = {
        column["name"] for column in inspect(engine).get_columns("ai_tasks")
    }
    assert {
        "source_version",
        "source_ref",
        "document_type",
        "formal_document",
    }.isdisjoint(downgraded_columns)
    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT code FROM ai_tasks WHERE code = 'migration-task'")
        ).scalar_one() == "migration-task"

    command.upgrade(config, "0005_task_document_metadata")
    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT source_version, source_ref, document_type, "
                "formal_document FROM ai_tasks WHERE code = 'migration-task'"
            )
        ).one()
    assert tuple(row) == ("", "", "PLAIN_TEXT", False)
