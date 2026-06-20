import base64

import httpx
import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth import get_session
from app.config import Settings, get_settings
from app.database import get_db
from app.admin.schemas import FieldType, TaskFieldIn
from app.main import app, get_prompt_client
from app.models import Assistant, Task, TaskField, TaskPromptBinding
from app.schemas import AuthScope, SessionPayload, UserPayload


class PublishedPromptStub:
    async def get_published(
        self,
        prompt_id: int,
        version: int | None = None,
    ) -> dict[str, str | int]:
        return {"id": prompt_id, "version": version or 3, "status": "PUBLISHED"}


class MissingPromptStub:
    async def get_published(
        self,
        prompt_id: int,
        version: int | None = None,
    ) -> dict[str, str | int]:
        del prompt_id, version
        raise LookupError("published prompt missing")


def test_admin_field_schema_matches_runtime_supported_types() -> None:
    # Given: the field types supported by employee-flow runtime validation.
    expected = {
        "TEXT",
        "TEXTAREA",
        "SELECT",
        "MULTISELECT",
        "NUMBER",
        "DATE",
        "SWITCH",
        "FILE_RESERVED",
    }

    # When: the governance input enum is inspected.
    actual = {item.value for item in FieldType}

    # Then: the management API exposes exactly the same eight variants.
    assert actual == expected


def test_admin_field_schema_rejects_legacy_checkbox_type() -> None:
    # Given: a field using the obsolete CHECKBOX variant.
    payload = {
        "field_key": "include_risk",
        "label": "包含风险",
        "field_type": "CHECKBOX",
    }

    # When/Then: Pydantic rejects it instead of persisting an unusable field.
    with pytest.raises(ValueError, match="field_type"):
        TaskFieldIn.model_validate(payload)


def test_non_admin_cannot_mutate_tasks(
    generation_db,
    seeded_task,
    respx_mock,
) -> None:
    # Given: a valid unified user whose admin action is denied.
    async def user_session(_request: Request) -> SessionPayload:
        return SessionPayload(
            user=UserPayload(id="user-1", username="user", role="employee"),
            scope=AuthScope(department="销售", managed_departments=[]),
            apps=["ai-assistant"],
        )

    secured_settings = Settings(
        auth_dev_bypass=False,
        auth_service_url="http://auth.test:5180",
        prompt_center_runtime_token="r" * 32,
        content_encryption_key=base64.urlsafe_b64encode(b"k" * 32).decode(),
        audit_hash_salt="a" * 32,
    )
    authorize = respx_mock.post(
        "http://auth.test:5180/api/auth/authorize"
    ).mock(
        return_value=httpx.Response(
            403,
            json={"allow": False, "reason": "仅管理员可执行"},
        )
    )
    app.dependency_overrides[get_db] = lambda: generation_db
    app.dependency_overrides[get_session] = user_session
    app.dependency_overrides[get_settings] = lambda: secured_settings

    # When: the user directly calls an admin mutation URL.
    try:
        with TestClient(
            app,
            cookies={"juxin_auth_token": "opaque-session"},
        ) as client:
            response = client.put(
                f"/api/ai/admin/tasks/{seeded_task.uuid}",
                json={"name": "篡改"},
            )
    finally:
        app.dependency_overrides.pop(get_settings, None)
        app.dependency_overrides.pop(get_session, None)
        app.dependency_overrides.pop(get_db, None)

    # Then: unified authorization remains authoritative.
    assert response.status_code == 403
    assert authorize.called
    assert seeded_task.name == "周报总结"


def test_admin_creates_task_with_draft_status(generation_db) -> None:
    # Given: an active assistant and an authorized administrator.
    assistant = Assistant(code="admin-test", name="管理测试助手", status="ACTIVE")
    generation_db.add(assistant)
    generation_db.commit()
    app.dependency_overrides[get_db] = lambda: generation_db

    # When: the administrator creates a task.
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/ai/admin/tasks",
                json={
                    "assistant_uuid": assistant.uuid,
                    "code": "contract-review",
                    "name": "合同审查",
                    "description": "检查合同风险",
                    "output_format": "Markdown",
                    "safety_notice": "需人工复核",
                },
            )
    finally:
        app.dependency_overrides.pop(get_db, None)

    # Then: the API creates a draft and persists its audit-safe metadata.
    assert response.status_code == 201
    task = generation_db.scalar(select(Task).where(Task.code == "contract-review"))
    assert task is not None
    assert task.status == "DRAFT"


def test_replacing_invalid_fields_is_atomic(generation_db, seeded_task) -> None:
    # Given: a task with one valid field.
    original_keys = [
        field.field_key
        for field in generation_db.scalars(
            select(TaskField).where(TaskField.task_id == seeded_task.id)
        )
    ]
    app.dependency_overrides[get_db] = lambda: generation_db

    # When: an invalid replacement is submitted.
    try:
        with TestClient(app) as client:
            response = client.put(
                f"/api/ai/admin/tasks/{seeded_task.uuid}/fields",
                json={
                    "fields": [
                        {
                            "field_key": "bad key",
                            "label": "错误",
                            "field_type": "TEXT",
                        }
                    ]
                },
            )
    finally:
        app.dependency_overrides.pop(get_db, None)

    # Then: validation fails before the existing rows are changed.
    assert response.status_code == 422
    current_keys = [
        field.field_key
        for field in generation_db.scalars(
            select(TaskField).where(TaskField.task_id == seeded_task.id)
        )
    ]
    assert current_keys == original_keys


def test_active_task_requires_published_prompt(generation_db) -> None:
    # Given: a draft task with no Prompt binding.
    assistant = Assistant(code="activation-test", name="激活测试", status="ACTIVE")
    generation_db.add(assistant)
    generation_db.flush()
    task = Task(
        assistant_id=assistant.id,
        code="activation-check",
        name="激活检查",
        status="DRAFT",
    )
    generation_db.add(task)
    generation_db.commit()
    app.dependency_overrides[get_db] = lambda: generation_db
    app.dependency_overrides[get_prompt_client] = lambda: PublishedPromptStub()

    # When: the task is activated without a binding.
    try:
        with TestClient(app) as client:
            response = client.put(
                f"/api/ai/admin/tasks/{task.uuid}",
                json={"status": "ACTIVE"},
            )
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_prompt_client, None)

    # Then: activation is rejected and the draft remains unchanged.
    assert response.status_code == 409
    assert response.json()["code"] == "PUBLISHED_PROMPT_REQUIRED"
    assert task.status == "DRAFT"


def test_prompt_binding_is_validated_before_commit(
    generation_db,
    seeded_task,
) -> None:
    # Given: a published Prompt runtime adapter.
    app.dependency_overrides[get_db] = lambda: generation_db
    app.dependency_overrides[get_prompt_client] = lambda: PublishedPromptStub()

    # When: an administrator pins a published version.
    try:
        with TestClient(app) as client:
            response = client.put(
                f"/api/ai/admin/tasks/{seeded_task.uuid}/prompt-binding",
                json={
                    "prompt_external_id": 42,
                    "version_policy": "PINNED",
                    "pinned_version": 5,
                    "status": "ACTIVE",
                },
            )
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_prompt_client, None)

    # Then: the validated binding replaces the previous runtime reference.
    assert response.status_code == 200
    binding = generation_db.scalar(
        select(TaskPromptBinding).where(
            TaskPromptBinding.task_id == seeded_task.id
        )
    )
    assert binding is not None
    assert binding.prompt_external_id == 42
    assert binding.pinned_version == 5


def test_previously_active_task_cannot_be_deleted_after_returning_to_draft(
    generation_db,
    seeded_task,
) -> None:
    # Given: an active task without generation records.
    app.dependency_overrides[get_db] = lambda: generation_db
    app.dependency_overrides[get_prompt_client] = lambda: PublishedPromptStub()

    # When: an administrator moves it back to draft and requests physical deletion.
    try:
        with TestClient(app) as client:
            moved = client.put(
                f"/api/ai/admin/tasks/{seeded_task.uuid}",
                json={"status": "DRAFT"},
            )
            deleted = client.delete(
                f"/api/ai/admin/tasks/{seeded_task.uuid}",
            )
    finally:
        app.dependency_overrides.pop(get_prompt_client, None)
        app.dependency_overrides.pop(get_db, None)

    # Then: activation history remains authoritative even when current status is draft.
    assert moved.status_code == 200
    assert deleted.status_code == 409
    assert deleted.json()["code"] == "TASK_DISABLE_REQUIRED"
    assert generation_db.scalar(
        select(Task).where(Task.uuid == seeded_task.uuid)
    ) is seeded_task


def test_compound_task_configuration_rolls_back_when_prompt_validation_fails(
    generation_db,
    seeded_task,
) -> None:
    # Given: an existing task configuration and an unavailable replacement Prompt.
    original_name = seeded_task.name
    original_keys = [
        field.field_key
        for field in generation_db.scalars(
            select(TaskField).where(TaskField.task_id == seeded_task.id)
        )
    ]
    original_binding = generation_db.scalar(
        select(TaskPromptBinding).where(
            TaskPromptBinding.task_id == seeded_task.id
        )
    )
    assert original_binding is not None
    original_prompt_id = original_binding.prompt_external_id
    app.dependency_overrides[get_db] = lambda: generation_db
    app.dependency_overrides[get_prompt_client] = lambda: MissingPromptStub()

    # When: one compound save changes task, fields, and Prompt binding.
    try:
        with TestClient(app) as client:
            response = client.put(
                f"/api/ai/admin/tasks/{seeded_task.uuid}/configuration",
                json={
                    "task": {"name": "不应持久化", "status": "ACTIVE"},
                    "fields": [
                        {
                            "field_key": "replacement",
                            "label": "替换字段",
                            "field_type": "TEXT",
                        }
                    ],
                    "prompt_binding": {
                        "prompt_external_id": 999,
                        "version_policy": "PUBLISHED",
                        "status": "ACTIVE",
                    },
                },
            )
    finally:
        app.dependency_overrides.pop(get_prompt_client, None)
        app.dependency_overrides.pop(get_db, None)

    # Then: a failed Prompt validation leaves every part unchanged.
    assert response.status_code == 409
    assert response.json()["code"] == "PUBLISHED_PROMPT_REQUIRED"
    generation_db.expire_all()
    assert seeded_task.name == original_name
    assert [
        field.field_key
        for field in generation_db.scalars(
            select(TaskField).where(TaskField.task_id == seeded_task.id)
        )
    ] == original_keys
    binding = generation_db.scalar(
        select(TaskPromptBinding).where(
            TaskPromptBinding.task_id == seeded_task.id
        )
    )
    assert binding is not None
    assert binding.prompt_external_id == original_prompt_id


def test_compound_task_configuration_rejects_active_task_with_disabled_binding(
    generation_db,
    seeded_task,
) -> None:
    # Given: an active task and a published Prompt that can be resolved.
    app.dependency_overrides[get_db] = lambda: generation_db
    app.dependency_overrides[get_prompt_client] = lambda: PublishedPromptStub()

    # When: one compound save attempts to keep the task active but disable its binding.
    try:
        with TestClient(app) as client:
            response = client.put(
                f"/api/ai/admin/tasks/{seeded_task.uuid}/configuration",
                json={
                    "task": {"status": "ACTIVE"},
                    "fields": [],
                    "prompt_binding": {
                        "prompt_external_id": 7,
                        "version_policy": "PUBLISHED",
                        "status": "DISABLED",
                    },
                },
            )
    finally:
        app.dependency_overrides.pop(get_prompt_client, None)
        app.dependency_overrides.pop(get_db, None)

    # Then: the server rejects the inconsistent runtime state atomically.
    assert response.status_code == 409
    assert response.json()["code"] == "PUBLISHED_PROMPT_REQUIRED"
    generation_db.expire_all()
    binding = generation_db.scalar(
        select(TaskPromptBinding).where(
            TaskPromptBinding.task_id == seeded_task.id
        )
    )
    assert binding is not None
    assert binding.status == "ACTIVE"
