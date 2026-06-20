import base64
import hashlib
import os
from types import SimpleNamespace

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
os.environ.setdefault("AUDIT_HASH_SALT", "a" * 32)
os.environ.setdefault("AI_LOCAL_BINDING_SECRET", "local-binding-test-secret-32-bytes!!")


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


@pytest.fixture
def active_task(seeded_task):
    return seeded_task


@pytest.fixture
def client_for_user(generation_db):
    from fastapi.testclient import TestClient
    from fastapi import Request

    from app.auth import get_session
    from app.database import get_db
    from app.main import app
    from app.schemas import AuthScope, SessionPayload, UserPayload

    clients: list[TestClient] = []

    async def session_override(request: Request) -> SessionPayload:
        user_id = request.headers["x-test-user-id"]
        return SessionPayload(
            user=UserPayload(
                id=user_id,
                username=f"user-{user_id}",
                role="employee",
            ),
            scope=AuthScope(department="测试部", managed_departments=[]),
            apps=["ai-assistant"],
        )

    app.dependency_overrides[get_db] = lambda: generation_db
    app.dependency_overrides[get_session] = session_override

    def factory(user_id: str) -> TestClient:
        client = TestClient(
            app,
            headers={"X-Test-User-ID": user_id},
        )
        client.__enter__()
        clients.append(client)
        return client

    try:
        yield factory
    finally:
        for client in reversed(clients):
            client.__exit__(None, None, None)
        app.dependency_overrides.pop(get_session, None)
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def records(generation_db, seeded_task):
    from app.crypto import ContentCipher
    from app.models import GenerationRecord

    cipher = ContentCipher(
        base64.urlsafe_b64encode(b"k" * 32).decode("ascii")
    )

    def create(uuid: str, user_id: str, content: str) -> GenerationRecord:
        encrypted_input = cipher.encrypt_json(
            {"inputs": {"work_content": content}},
            uuid.encode(),
        )
        encrypted_output = cipher.encrypt_json(
            {"output": f"{content} 的生成结果"},
            uuid.encode(),
        )
        record = GenerationRecord(
            uuid=uuid,
            sso_user_id=user_id,
            username_snapshot=f"user-{user_id}",
            department_snapshot="测试部",
            task_id=seeded_task.id,
            prompt_external_id=7,
            prompt_version=3,
            input_ciphertext=encrypted_input.ciphertext,
            input_nonce=encrypted_input.nonce,
            output_ciphertext=encrypted_output.ciphertext,
            output_nonce=encrypted_output.nonce,
            key_version="v1",
            completion_token_hash=hashlib.sha256(b"completed").digest(),
            model_display_name="本地模型",
            model_id="local-model",
            status="COMPLETED",
            usage_json={"input_tokens": 10, "output_tokens": 20},
        )
        generation_db.add(record)
        generation_db.flush()
        return record

    u1 = create("generation-u1", "u-1", "用户一内容")
    u2 = create("generation-u2", "u-2", "用户二内容")
    generation_db.commit()
    return SimpleNamespace(u1=u1, u2=u2)


@pytest.fixture
def completed_generation(generation_db, seeded_task):
    from app.crypto import ContentCipher
    from app.models import GenerationRecord

    cipher = ContentCipher(
        base64.urlsafe_b64encode(b"k" * 32).decode("ascii")
    )
    uuid = "completed-generation-dev"
    encrypted_input = cipher.encrypt_json(
        {"inputs": {"work_content": "完成内容"}},
        uuid.encode(),
    )
    encrypted_output = cipher.encrypt_json(
        {"output": "完成结果"},
        uuid.encode(),
    )
    record = GenerationRecord(
        uuid=uuid,
        sso_user_id="dev",
        username_snapshot="dev_admin",
        department_snapshot="通用",
        task_id=seeded_task.id,
        prompt_external_id=7,
        prompt_version=3,
        input_ciphertext=encrypted_input.ciphertext,
        input_nonce=encrypted_input.nonce,
        output_ciphertext=encrypted_output.ciphertext,
        output_nonce=encrypted_output.nonce,
        key_version="v1",
        completion_token_hash=hashlib.sha256(b"completed").digest(),
        model_display_name="本地模型",
        model_id="local-model",
        status="COMPLETED",
    )
    generation_db.add(record)
    generation_db.commit()
    return record
