from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

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
