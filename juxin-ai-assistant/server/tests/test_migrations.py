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

    assert script.get_heads() == ["0016_user_memories"]
    assert [
        revision.revision for revision in script.walk_revisions()
    ] == [
        "0016_user_memories",
        "0015_agent_tool_calls",
        "0014_web_sources",
        "0013_knowledge_document_types",
        "0012_knowledge_categories",
        "0011_knowledge_document_management",
        "0010_chat_session_lifecycle",
        "0009_chat_word_exports",
        "0008_chat_rag_sources",
        "0007_task_templates_and_attachments",
        "0006_prompt_catalog_rollouts",
        "0005_task_document_metadata",
        "0004_desktop_updates",
        "0003_governance",
        "0002_employee_features",
        "0001_foundation",
    ]


def test_knowledge_migration_does_not_set_defaults_on_mysql_text_or_json_columns() -> None:
    migration_path = SERVER_ROOT / "alembic" / "versions" / "0011_knowledge_document_management.py"
    tree = ast.parse(migration_path.read_text(encoding="utf-8"))
    offenders: list[str] = []

    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if not isinstance(node.func, ast.Attribute) or node.func.attr != "Column":
            continue
        if len(node.args) < 2 or not isinstance(node.args[0], ast.Constant):
            continue
        column_name = str(node.args[0].value)
        type_call = node.args[1]
        if (
            isinstance(type_call, ast.Call)
            and isinstance(type_call.func, ast.Attribute)
            and type_call.func.attr in {"Text", "JSON"}
            and any(keyword.arg == "server_default" for keyword in node.keywords)
        ):
            offenders.append(column_name)

    assert offenders == []


def test_foundation_migration_round_trip(tmp_path: Path) -> None:
    database_path = tmp_path / "migration.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "head")
    assert FOUNDATION_TABLES.issubset(set(inspect(engine).get_table_names()))


def test_user_memories_migration_creates_personal_memory_table(tmp_path: Path) -> None:
    database_path = tmp_path / "user-memories.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "0016_user_memories")
    inspector = inspect(engine)

    columns = {column["name"] for column in inspector.get_columns("ai_user_memories")}
    assert {
        "id",
        "uuid",
        "sso_user_id",
        "memory_type",
        "content",
        "status",
        "source",
        "metadata_json",
        "created_at",
        "updated_at",
    }.issubset(columns)


def test_chat_word_export_migration_creates_export_records(tmp_path: Path) -> None:
    database_path = tmp_path / "chat-word-export.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "0009_chat_word_exports")
    inspector = inspect(engine)

    columns = {column["name"] for column in inspector.get_columns("export_records")}
    assert {
        "id",
        "uuid",
        "conversation_id",
        "message_id",
        "file_name",
        "file_path",
        "export_type",
        "template_name",
        "created_by",
        "created_at",
        "updated_at",
    }.issubset(columns)

    command.downgrade(config, "base")
    assert FOUNDATION_TABLES.isdisjoint(set(inspect(engine).get_table_names()))

    command.upgrade(config, "head")
    assert FOUNDATION_TABLES.issubset(set(inspect(engine).get_table_names()))


def test_chat_session_lifecycle_migration_adds_status_timestamps(tmp_path: Path) -> None:
    database_path = tmp_path / "chat-session-lifecycle.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "0010_chat_session_lifecycle")
    inspector = inspect(engine)

    session_columns = {
        column["name"]
        for column in inspector.get_columns("ai_chat_sessions")
    }
    assert {
        "status",
        "archived_at",
        "deleted_at",
        "hard_deleted_at",
        "updated_at",
    }.issubset(session_columns)


def test_knowledge_document_management_migration_adds_core_tables_and_fields(tmp_path: Path) -> None:
    database_path = tmp_path / "knowledge-document-management.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "0011_knowledge_document_management")
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())

    assert {
        "ai_knowledge_bases",
        "ai_knowledge_search_logs",
        "ai_knowledge_review_logs",
    }.issubset(table_names)

    file_columns = {
        column["name"]
        for column in inspector.get_columns("ai_knowledge_files")
    }
    assert {
        "knowledge_base_id",
        "original_file_name",
        "stored_file_name",
        "file_path",
        "category",
        "document_type",
        "tags_json",
        "summary",
        "parse_status",
        "index_status",
        "source_type",
        "usage_type",
        "review_status",
        "rag_enabled",
        "reference_enabled",
        "rag_scope",
        "permission_scope",
        "owner_user_id",
        "conversation_id",
        "version",
        "parent_file_id",
        "is_current_version",
        "replaced_by_file_id",
        "uploaded_by",
        "reviewed_by",
        "reviewed_at",
        "review_comment",
        "archived_at",
        "deleted_at",
        "hard_deleted_at",
        "last_used_at",
        "usage_count",
    }.issubset(file_columns)

    chunk_columns = {
        column["name"]
        for column in inspector.get_columns("ai_knowledge_chunks")
    }
    assert {
        "knowledge_base_id",
        "token_count",
        "metadata_json",
        "embedding_id",
        "deleted_at",
    }.issubset(chunk_columns)


def test_knowledge_categories_migration_adds_category_table(tmp_path: Path) -> None:
    database_path = tmp_path / "knowledge-categories.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "0012_knowledge_categories")
    inspector = inspect(engine)

    assert "ai_knowledge_categories" in set(inspector.get_table_names())
    category_columns = {
        column["name"]
        for column in inspector.get_columns("ai_knowledge_categories")
    }
    assert {
        "uuid",
        "name",
        "parent_id",
        "scope",
        "sort_order",
        "status",
        "created_by",
        "deleted_at",
        "created_at",
        "updated_at",
    }.issubset(category_columns)


def test_knowledge_document_types_migration_adds_document_type_table(tmp_path: Path) -> None:
    database_path = tmp_path / "knowledge-document-types.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "0013_knowledge_document_types")
    inspector = inspect(engine)

    assert "ai_knowledge_document_types" in set(inspector.get_table_names())
    document_type_columns = {
        column["name"]
        for column in inspector.get_columns("ai_knowledge_document_types")
    }
    assert {
        "uuid",
        "name",
        "sort_order",
        "status",
        "created_by",
        "deleted_at",
        "created_at",
        "updated_at",
    }.issubset(document_type_columns)


def test_web_sources_migration_adds_capture_search_tables(tmp_path: Path) -> None:
    database_path = tmp_path / "web-sources.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "0014_web_sources")
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())

    assert {
        "ai_web_captures",
        "ai_web_search_logs",
        "ai_search_cache",
    }.issubset(table_names)

    capture_columns = {
        column["name"]
        for column in inspector.get_columns("ai_web_captures")
    }
    assert {
        "uuid",
        "user_id",
        "conversation_id",
        "url",
        "final_url",
        "title",
        "summary",
        "extracted_text",
        "suggested_category",
        "suggested_document_type",
        "status",
        "save_target",
        "review_status",
        "content_hash",
        "knowledge_file_id",
        "created_at",
        "updated_at",
    }.issubset(capture_columns)
    file_columns = {
        column["name"]
        for column in inspector.get_columns("ai_knowledge_files")
    }
    assert {
        "source_origin",
        "web_capture_id",
        "source_url",
    }.issubset(file_columns)
    search_log_columns = {
        column["name"]
        for column in inspector.get_columns("ai_web_search_logs")
    }
    assert {
        "user_id",
        "conversation_id",
        "query",
        "provider",
        "status",
        "result_count",
        "result_urls_json",
        "used_urls_json",
        "answer_message_id",
    }.issubset(search_log_columns)


def test_agent_tool_calls_migration_adds_runtime_log_table(tmp_path: Path) -> None:
    database_path = tmp_path / "agent-tool-calls.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "0015_agent_tool_calls")
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())

    assert "ai_agent_tool_calls" in table_names
    columns = {
        column["name"]
        for column in inspector.get_columns("ai_agent_tool_calls")
    }
    assert {
        "id",
        "uuid",
        "run_id",
        "message_id",
        "user_id",
        "conversation_id",
        "mode",
        "tool_name",
        "tool_version",
        "status",
        "permission",
        "latency_ms",
        "source_count",
        "input_summary_json",
        "output_summary_json",
        "error_code",
        "error_message_safe",
        "started_at",
        "finished_at",
        "created_at",
        "updated_at",
    }.issubset(columns)


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


def test_0008_adds_knowledge_file_and_chat_tables(tmp_path: Path) -> None:
    database_path = tmp_path / "chat-rag-sources.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    config = migration_config(database_url)
    engine = create_engine(database_url)

    command.upgrade(config, "0008_chat_rag_sources")
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())

    assert {
        "ai_knowledge_files",
        "ai_knowledge_chunks",
        "ai_chat_sessions",
        "ai_chat_messages",
        "ai_chat_message_sources",
    }.issubset(table_names)

    file_columns = {
        column["name"]
        for column in inspector.get_columns("ai_knowledge_files")
    }
    assert {
        "id",
        "uuid",
        "sso_user_id",
        "file_name",
        "file_type",
        "file_size",
        "content_sha256",
        "visibility",
        "status",
        "error_code",
        "key_version",
        "created_at",
        "updated_at",
    } == file_columns

    chunk_columns = {
        column["name"]
        for column in inspector.get_columns("ai_knowledge_chunks")
    }
    assert {
        "id",
        "chunk_id",
        "file_id",
        "file_name",
        "chunk_text_ciphertext",
        "chunk_text_nonce",
        "page_number",
        "section_title",
        "chunk_index",
        "token_estimate",
        "status",
        "created_at",
        "updated_at",
    } == chunk_columns

    command.downgrade(config, "0007_task_templates_and_attachments")
    downgraded_tables = set(inspect(engine).get_table_names())
    assert {
        "ai_knowledge_files",
        "ai_knowledge_chunks",
        "ai_chat_sessions",
        "ai_chat_messages",
        "ai_chat_message_sources",
    }.isdisjoint(downgraded_tables)
