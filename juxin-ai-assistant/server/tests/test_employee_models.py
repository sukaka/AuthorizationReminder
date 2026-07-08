from sqlalchemy import create_engine, inspect

from app import models  # noqa: F401
from app.database import Base


def test_employee_feature_tables_columns_and_constraints() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    inspector = inspect(engine)

    assert {
        "ai_knowledge_items",
        "ai_knowledge_task_links",
        "ai_feedback_records",
        "ai_user_favorites",
    }.issubset(set(inspector.get_table_names()))

    generation_columns = {
        item["name"]
        for item in inspector.get_columns("ai_generation_records")
    }
    assert {
        "parent_generation_id",
        "completion_token_hash",
        "input_nonce",
        "output_nonce",
        "finished_at",
        "error_message_safe",
        "knowledge_refs_json",
    } <= generation_columns

    link_uniques = {
        tuple(item["column_names"])
        for item in inspector.get_unique_constraints("ai_knowledge_task_links")
    }
    feedback_uniques = {
        tuple(item["column_names"])
        for item in inspector.get_unique_constraints("ai_feedback_records")
    }
    favorite_uniques = {
        tuple(item["column_names"])
        for item in inspector.get_unique_constraints("ai_user_favorites")
    }
    assert ("knowledge_id", "task_id") in link_uniques
    assert ("generation_id", "sso_user_id", "feedback_type") in feedback_uniques
    assert ("sso_user_id", "task_id") in favorite_uniques

    generation_foreign_keys = inspector.get_foreign_keys("ai_generation_records")
    assert any(
        item["constrained_columns"] == ["parent_generation_id"]
        and item["referred_table"] == "ai_generation_records"
        for item in generation_foreign_keys
    )

    engine.dispose()
