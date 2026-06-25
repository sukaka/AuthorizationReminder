from sqlalchemy import create_engine, inspect

from app.database import Base
from app import models  # noqa: F401
from app.models import Assistant, Task


FOUNDATION_TABLES = {
    "ai_assistants",
    "ai_tasks",
    "ai_task_fields",
    "ai_task_prompt_bindings",
    "ai_generation_records",
}


def unique_column_sets(table_name: str) -> set[frozenset[str]]:
    table = Base.metadata.tables[table_name]
    return {
        frozenset(column.name for column in constraint.columns)
        for constraint in table.constraints
        if getattr(constraint, "unique", False)
        or constraint.__class__.__name__ == "UniqueConstraint"
    }


def test_foundation_tables_constraints_and_ciphertext_boundary() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    inspector = inspect(engine)

    assert FOUNDATION_TABLES.issubset(set(inspector.get_table_names()))
    generation_columns = {
        column["name"] for column in inspector.get_columns("ai_generation_records")
    }
    assert generation_columns >= {
        "uuid",
        "sso_user_id",
        "input_ciphertext",
        "output_ciphertext",
        "input_nonce",
        "output_nonce",
        "key_version",
        "completion_token_hash",
        "status",
        "created_at",
        "updated_at",
    }
    assert {"input_plaintext", "output_plaintext"}.isdisjoint(generation_columns)
    assert frozenset({"code"}) in unique_column_sets("ai_assistants")
    assert frozenset({"code"}) in unique_column_sets("ai_tasks")
    assert frozenset({"task_id", "field_key"}) in unique_column_sets("ai_task_fields")
    assert frozenset({"task_id"}) in unique_column_sets("ai_task_prompt_bindings")
    assert "ai_prompt_catalog_rollouts" in inspector.get_table_names()
    assert "rollout_token" in {
        column["name"]
        for column in inspector.get_columns("ai_task_prompt_bindings")
    }


def test_generation_lookup_indexes_cover_owner_task_and_status() -> None:
    table = Base.metadata.tables["ai_generation_records"]
    indexed_columns = {
        column.name
        for index in table.indexes
        for column in index.columns
    }

    assert {"sso_user_id", "task_id", "status"}.issubset(indexed_columns)


def test_task_model_has_document_template_metadata() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    inspector = inspect(engine)
    columns = {
        column["name"]
        for column in inspector.get_columns("ai_tasks")
    }

    assert "document_template_code" in columns
    assert "output_schema_json" in columns
    assert "attachment_policy_json" in columns


def test_task_supports_manual_source_and_document_metadata(generation_db) -> None:
    assistant = Assistant(code="formal", name="正式文档助手")
    generation_db.add(assistant)
    generation_db.flush()
    task = Task(
        assistant_id=assistant.id,
        code="formal-report",
        name="正式报告",
        source_version="V1.10",
        source_ref="V1.10｜第六部分｜实施报告",
        document_type="REPORT",
        formal_document=True,
    )
    generation_db.add(task)
    generation_db.flush()

    assert task.source_version == "V1.10"
    assert task.source_ref == "V1.10｜第六部分｜实施报告"
    assert task.document_type == "REPORT"
    assert task.formal_document is True


def test_task_document_metadata_defaults(generation_db) -> None:
    assistant = Assistant(code="plain", name="普通文档助手")
    generation_db.add(assistant)
    generation_db.flush()
    task = Task(
        assistant_id=assistant.id,
        code="plain-text",
        name="普通文本",
    )
    generation_db.add(task)
    generation_db.flush()

    assert task.source_version == ""
    assert task.source_ref == ""
    assert task.document_type == "PLAIN_TEXT"
    assert task.formal_document is False
