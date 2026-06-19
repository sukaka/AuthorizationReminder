from sqlalchemy import create_engine, inspect

from app.database import Base
from app import models  # noqa: F401


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


def test_generation_lookup_indexes_cover_owner_task_and_status() -> None:
    table = Base.metadata.tables["ai_generation_records"]
    indexed_columns = {
        column.name
        for index in table.indexes
        for column in index.columns
    }

    assert {"sso_user_id", "task_id", "status"}.issubset(indexed_columns)
