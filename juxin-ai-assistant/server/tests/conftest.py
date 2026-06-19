import base64
import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool


os.environ.setdefault("AUTH_DEV_BYPASS", "true")
os.environ.setdefault(
    "CONTENT_ENCRYPTION_KEY",
    base64.urlsafe_b64encode(b"k" * 32).decode("ascii"),
)
os.environ.setdefault("PROMPT_CENTER_RUNTIME_TOKEN", "r" * 32)
os.environ.setdefault("PROMPT_CENTER_URL", "http://prompt.test:5189")


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as value:
        yield value


@pytest.fixture
def generation_db():
    from app import models  # noqa: F401
    from app.database import Base

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        yield session
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture
def generation_client(generation_db):
    from fastapi.testclient import TestClient

    from app.database import get_db
    from app.main import app

    app.dependency_overrides[get_db] = lambda: generation_db
    try:
        with TestClient(app) as value:
            yield value
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def seeded_task(generation_db):
    from app.models import Assistant, Task, TaskField, TaskPromptBinding

    assistant = Assistant(code="general", name="通用办公助手", status="ACTIVE")
    generation_db.add(assistant)
    generation_db.flush()
    task = Task(
        assistant_id=assistant.id,
        code="weekly-summary",
        name="周报总结",
        output_format="Markdown",
        safety_notice="生成内容需人工复核",
        status="ACTIVE",
    )
    generation_db.add(task)
    generation_db.flush()
    generation_db.add_all([
        TaskField(
            task_id=task.id,
            field_key="work_content",
            label="工作内容",
            field_type="textarea",
            required=True,
            sort_order=1,
        ),
        TaskPromptBinding(
            task_id=task.id,
            prompt_external_id=7,
            version_policy="PUBLISHED",
            status="ACTIVE",
        ),
    ])
    generation_db.commit()
    return task
