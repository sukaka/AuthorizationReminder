import base64

import httpx
import pytest
from fastapi import Request
from fastapi.testclient import TestClient

from app.auth import get_session
from app.config import Settings, get_settings
from app.database import get_db
from app.main import app
from app.schemas import AuthScope, SessionPayload, UserPayload


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("POST", "/api/ai/admin/tasks", {
            "assistant_uuid": "assistant-1", "code": "blocked-task", "name": "越权任务",
        }),
        ("POST", "/api/ai/admin/knowledge", {
            "title": "越权知识", "category": "COMPANY", "content": "不可写入",
        }),
        ("PUT", "/api/ai/admin/settings", {"history_retention_days": 30}),
        ("POST", "/api/ai/admin/suggestions/suggestion-1/review", {"decision": "APPROVE"}),
        ("GET", "/api/ai/admin/stats", None),
        ("GET", "/api/ai/admin/audit-logs", None),
    ],
)
def test_employee_direct_governance_requests_are_denied(
    generation_db,
    respx_mock,
    method: str,
    path: str,
    body: dict | None,
) -> None:
    async def employee_session(_request: Request) -> SessionPayload:
        return SessionPayload(
            user=UserPayload(id="employee-1", username="employee", role="employee"),
            scope=AuthScope(department="SALES", managed_departments=[]),
            apps=["ai-assistant"],
        )

    settings = Settings(
        auth_dev_bypass=False,
        auth_service_url="http://auth.test:5180",
        prompt_center_runtime_token="r" * 32,
        content_encryption_key=base64.urlsafe_b64encode(b"k" * 32).decode(),
        audit_hash_salt="a" * 32,
    )
    authorize = respx_mock.post("http://auth.test:5180/api/auth/authorize").mock(
        return_value=httpx.Response(403, json={"allow": False, "reason": "仅管理员可执行"})
    )
    app.dependency_overrides[get_db] = lambda: generation_db
    app.dependency_overrides[get_session] = employee_session
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        with TestClient(app, cookies={"juxin_auth_token": "opaque-session"}) as client:
            response = client.request(method, path, json=body)
    finally:
        app.dependency_overrides.pop(get_settings, None)
        app.dependency_overrides.pop(get_session, None)
        app.dependency_overrides.pop(get_db, None)

    assert response.status_code == 403
    assert response.json()["detail"] == "仅管理员可执行"
    assert authorize.called
