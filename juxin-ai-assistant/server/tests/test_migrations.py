import ast
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
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


def test_migration_revision_graph_is_single_linear_head() -> None:
    script = ScriptDirectory.from_config(
        migration_config("sqlite+pysqlite:///:memory:")
    )

    assert script.get_heads() == ["0007_task_templates_and_attachments"]
    assert [
        revision.revision for revision in script.walk_revisions()
    ] == [
        "0007_task_templates_and_attachments",
        "0006_prompt_catalog_rollouts",
        "0005_task_document_metadata",
        "0004_desktop_updates",
        "0003_governance",
        "0002_employee_features",
        "0001_foundation",
    ]


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


def test_desktop_update_migration_matches_models(tmp_path: Path) -> None:
    database_path = tmp_path / "desktop-update-schema.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "0004_desktop_updates")
    inspector = inspect(engine)

    release_columns = {
        column["name"]
        for column in inspector.get_columns("ai_desktop_update_releases")
    }
    artifact_columns = {
        column["name"]
        for column in inspector.get_columns("ai_desktop_update_artifacts")
    }
    assert release_columns == {
        "id",
        "uuid",
        "agent_version",
        "channel",
        "status",
        "release_notes",
        "created_by",
        "created_at",
        "published_at",
        "withdrawn_at",
    }
    assert artifact_columns == {
        "id",
        "release_id",
        "target",
        "file_name",
        "storage_key",
        "content_type",
        "size_bytes",
        "sha256",
        "tauri_signature",
        "created_at",
    }

    release_uniques = {
        frozenset(constraint["column_names"])
        for constraint in inspector.get_unique_constraints(
            "ai_desktop_update_releases"
        )
    }
    artifact_uniques = {
        frozenset(constraint["column_names"])
        for constraint in inspector.get_unique_constraints(
            "ai_desktop_update_artifacts"
        )
    }
    assert release_uniques == {
        frozenset({"uuid"}),
        frozenset({"channel", "agent_version"}),
    }
    assert artifact_uniques == {
        frozenset({"release_id", "target"}),
        frozenset({"storage_key"}),
        frozenset({"sha256"}),
    }

    release_checks = {
        constraint["name"]
        for constraint in inspector.get_check_constraints(
            "ai_desktop_update_releases"
        )
    }
    artifact_checks = {
        constraint["name"]
        for constraint in inspector.get_check_constraints(
            "ai_desktop_update_artifacts"
        )
    }
    assert release_checks == {
        "ck_desktop_update_release_channel",
        "ck_desktop_update_release_status",
    }
    assert artifact_checks == {"ck_desktop_update_artifact_target"}

    release_indexes = {
        frozenset(index["column_names"])
        for index in inspector.get_indexes("ai_desktop_update_releases")
    }
    artifact_indexes = {
        frozenset(index["column_names"])
        for index in inspector.get_indexes("ai_desktop_update_artifacts")
    }
    assert release_indexes == {
        frozenset({"agent_version"}),
        frozenset({"channel"}),
        frozenset({"status"}),
    }
    assert artifact_indexes == {frozenset({"release_id"})}
    assert inspector.get_foreign_keys("ai_desktop_update_artifacts") == []


def test_desktop_update_text_columns_do_not_use_mysql_defaults() -> None:
    migration_path = SERVER_ROOT / "alembic" / "versions" / "0004_desktop_updates.py"
    tree = ast.parse(migration_path.read_text(encoding="utf-8"))

    text_columns_with_defaults: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if not (
            isinstance(node.func, ast.Attribute)
            and node.func.attr == "Column"
            and len(node.args) >= 2
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
        ):
            continue
        type_call = node.args[1]
        is_text = (
            isinstance(type_call, ast.Call)
            and isinstance(type_call.func, ast.Attribute)
            and type_call.func.attr == "Text"
        )
        has_server_default = any(
            keyword.arg == "server_default" for keyword in node.keywords
        )
        if is_text and has_server_default:
            text_columns_with_defaults.append(node.args[0].value)

    assert text_columns_with_defaults == []


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


def test_prompt_catalog_rollout_migration_round_trip(tmp_path: Path) -> None:
    database_path = tmp_path / "prompt-rollout.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "0005_task_document_metadata")
    command.upgrade(config, "0006_prompt_catalog_rollouts")
    inspector = inspect(engine)

    assert "ai_prompt_catalog_rollouts" in inspector.get_table_names()
    assert {
        "id",
        "token",
        "status",
        "force_config",
        "target_json",
        "frozen_tasks_json",
        "created_at",
        "updated_at",
    } == {
        column["name"]
        for column in inspector.get_columns("ai_prompt_catalog_rollouts")
    }
    assert "rollout_token" in {
        column["name"]
        for column in inspector.get_columns("ai_task_prompt_bindings")
    }

    command.downgrade(config, "0005_task_document_metadata")
    inspector = inspect(engine)
    assert "ai_prompt_catalog_rollouts" not in inspector.get_table_names()
    assert "rollout_token" not in {
        column["name"]
        for column in inspector.get_columns("ai_task_prompt_bindings")
    }


def test_0007_adds_task_template_metadata(tmp_path: Path) -> None:
    database_path = tmp_path / "task-template-metadata.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "0006_prompt_catalog_rollouts")
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
                "uuid": "00000000-0000-0000-0000-000000000007",
                "code": "template-migration-assistant",
                "name": "模板迁移助手",
            },
        )
        assistant_id = connection.execute(
            text(
                "SELECT id FROM ai_assistants "
                "WHERE code = 'template-migration-assistant'"
            )
        ).scalar_one()
        connection.execute(
            text(
                "INSERT INTO ai_tasks "
                "(uuid, assistant_id, code, name, description, output_format, "
                "safety_notice, source_version, source_ref, document_type, "
                "formal_document, sort_order, status, ever_active, created_by, "
                "updated_by) "
                "VALUES (:uuid, :assistant_id, :code, :name, '', 'Markdown', "
                "'生成内容需人工复核', '', '', 'PLAIN_TEXT', 0, 0, 'ACTIVE', "
                "1, 'system', 'system')"
            ),
            {
                "uuid": "00000000-0000-0000-0000-000000000008",
                "assistant_id": assistant_id,
                "code": "template-migration-task",
                "name": "模板迁移任务",
            },
        )

    command.upgrade(config, "0007_task_templates_and_attachments")
    inspector = inspect(engine)
    task_columns = {
        column["name"]: column
        for column in inspector.get_columns("ai_tasks")
    }

    assert "document_template_code" in task_columns
    assert "output_schema_json" in task_columns
    assert "attachment_policy_json" in task_columns
    assert task_columns["document_template_code"]["nullable"] is False
    assert task_columns["document_template_code"]["default"] is None
    assert task_columns["output_schema_json"]["nullable"] is True
    assert task_columns["attachment_policy_json"]["nullable"] is True
    assert "ai_generation_attachments" in inspector.get_table_names()

    attachment_columns = {
        column["name"]: column
        for column in inspector.get_columns("ai_generation_attachments")
    }
    assert attachment_columns["file_type"]["type"].length == 128
    assert {
        "id",
        "uuid",
        "sso_user_id",
        "task_id",
        "generation_id",
        "file_name",
        "file_type",
        "file_size",
        "content_sha256",
        "extracted_text_ciphertext",
        "extracted_text_nonce",
        "key_version",
        "status",
        "error_code",
        "created_at",
        "updated_at",
    } == set(attachment_columns)
    attachment_indexes = {
        frozenset(index["column_names"])
        for index in inspector.get_indexes("ai_generation_attachments")
    }
    assert {
        frozenset({"content_sha256"}),
        frozenset({"generation_id"}),
        frozenset({"sso_user_id"}),
        frozenset({"status"}),
        frozenset({"task_id"}),
    }.issubset(attachment_indexes)

    with engine.connect() as connection:
        assert connection.execute(
            text(
                "SELECT document_template_code FROM ai_tasks "
                "WHERE code = 'template-migration-task'"
            )
        ).scalar_one() == ""

    command.downgrade(config, "0006_prompt_catalog_rollouts")
    inspector = inspect(engine)
    assert "ai_generation_attachments" not in inspector.get_table_names()
    task_columns = {column["name"] for column in inspector.get_columns("ai_tasks")}
    assert {
        "document_template_code",
        "output_schema_json",
        "attachment_policy_json",
    }.isdisjoint(task_columns)
