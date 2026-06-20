from fastapi.testclient import TestClient

from app.database import get_db
from app.governance_models import AuditLog
from app.main import app
from app.admin.schemas import AuditLogOut


def test_audit_output_schema_builds_without_recursive_json_types() -> None:
    # Given: the public audit response model.
    # When: FastAPI asks Pydantic to build its OpenAPI schema.
    schema = AuditLogOut.model_json_schema()

    # Then: the public contract is finite, adapter-aligned, and hash-free.
    assert set(schema["properties"]) == {
        "id",
        "sso_user_id",
        "username_snapshot",
        "action",
        "entity_type",
        "entity_uuid",
        "result",
        "metadata_json",
        "created_at",
    }


def test_audit_api_filters_and_resanitizes_metadata(generation_db) -> None:
    # Given: audit rows including legacy unsafe metadata.
    generation_db.add_all(
        [
            AuditLog(
                sso_user_id="admin-1",
                username_snapshot="admin",
                action="task.update",
                entity_type="task",
                entity_uuid="task-1",
                result="SUCCESS",
                metadata_json={
                    "task_uuid": "task-1",
                    "input": "legacy private body",
                    "status": {
                        "name": "ACTIVE",
                        "authorization": "Bearer secret",
                    },
                },
                ip_hash="a" * 64,
                user_agent_hash="b" * 64,
            ),
            AuditLog(
                sso_user_id="admin-2",
                username_snapshot="other-admin",
                action="knowledge.disable",
                entity_type="knowledge",
                entity_uuid="knowledge-1",
                result="SUCCESS",
                metadata_json={"status": "DISABLED"},
                ip_hash="c" * 64,
                user_agent_hash="d" * 64,
            ),
        ]
    )
    generation_db.commit()
    app.dependency_overrides[get_db] = lambda: generation_db

    # When: the audit-center adapter filters by its public query names.
    try:
        with TestClient(app) as client:
            response = client.get(
                "/api/ai/admin/audit-logs",
                params={
                    "action": "task.update",
                    "entity": "task",
                    "username": "admin",
                    "date_from": "2020-01-01",
                    "date_to": "2030-01-01",
                    "limit": 100,
                },
            )
    finally:
        app.dependency_overrides.pop(get_db, None)

    # Then: only the matching row and recursively sanitized metadata are returned.
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    item = payload["items"][0]
    assert set(item) == {
        "id",
        "sso_user_id",
        "username_snapshot",
        "action",
        "entity_type",
        "entity_uuid",
        "result",
        "metadata_json",
        "created_at",
    }
    assert item["metadata_json"] == {
        "task_uuid": "task-1",
        "status": {"name": "ACTIVE"},
    }
    assert item["username_snapshot"] == "admin"
    assert isinstance(item["id"], int)
    assert "ip_hash" not in item
    assert "user_agent_hash" not in item
    assert "legacy private body" not in response.text
    assert "Bearer secret" not in response.text


def test_audit_api_caps_page_size_at_500(generation_db) -> None:
    # Given: the protected audit list endpoint.
    app.dependency_overrides[get_db] = lambda: generation_db

    # When: a caller requests more than the aggregation limit.
    try:
        with TestClient(app) as client:
            response = client.get(
                "/api/ai/admin/audit-logs",
                params={"limit": 501},
            )
    finally:
        app.dependency_overrides.pop(get_db, None)

    # Then: request validation rejects the oversized page.
    assert response.status_code == 422
