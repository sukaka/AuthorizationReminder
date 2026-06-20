import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.auth import require_action
from app.config import Settings, get_settings
from app.main import app
from app.schemas import AuthScope, SessionPayload, UserPayload


def test_service_has_no_standalone_login_route() -> None:
    routes = {route.path for route in app.routes}

    assert "/api/ai/auth/login" not in routes
    assert "/api/auth/login" not in routes


def test_session_returns_unified_user(client: TestClient) -> None:
    response = client.get("/api/ai/session")

    assert response.status_code == 200
    assert response.json()["user"]["username"] == "dev_admin"
    assert response.json()["apps"] == ["ai-assistant"]


@pytest.fixture
def sso_settings() -> Settings:
    return Settings(
        auth_dev_bypass=False,
        auth_service_url="http://auth.test:5180",
        prompt_center_runtime_token="r" * 32,
        content_encryption_key="k" * 43,
    )


@pytest.fixture
def sso_client(sso_settings: Settings):
    app.dependency_overrides[get_settings] = lambda: sso_settings
    try:
        with TestClient(app) as value:
            yield value
    finally:
        app.dependency_overrides.pop(get_settings, None)


def test_session_requires_unified_login_cookie(sso_client: TestClient) -> None:
    response = sso_client.get("/api/ai/session")

    assert response.status_code == 401
    assert response.json()["detail"] == "未登录"


def test_session_forwards_only_unified_cookie(
    sso_client: TestClient,
    respx_mock,
) -> None:
    introspect = respx_mock.get("http://auth.test:5180/api/auth/introspect").mock(
        return_value=httpx.Response(
            200,
            json={
                "user": {"id": 7, "username": "zhanglei", "role": "user"},
                "scope": {"department": "研发部", "managedDepartments": []},
                "apps": ["ai-assistant"],
            },
        )
    )
    sso_client.cookies.set("juxin_auth_token", "opaque-session")

    response = sso_client.get("/api/ai/session")

    assert response.status_code == 200
    assert response.json()["user"]["username"] == "zhanglei"
    outbound = introspect.calls[0].request
    assert outbound.headers["cookie"] == "juxin_auth_token=opaque-session"
    assert "authorization" not in outbound.headers
    assert outbound.content == b""


def test_session_normalizes_structured_department_scope(
    sso_client: TestClient,
    respx_mock,
) -> None:
    respx_mock.get("http://auth.test:5180/api/auth/introspect").mock(
        return_value=httpx.Response(
            200,
            json={
                "user": {"id": 9, "username": "manager", "role": "employee"},
                "scope": {
                    "department": {"code": "SALES", "name": "销售部", "is_active": 1},
                    "managedDepartments": [
                        {"code": "SALES", "name": "销售部", "is_active": 1},
                        {"code": "DELIVERY", "name": "交付部", "is_active": 1},
                    ],
                },
                "apps": ["ai-assistant"],
            },
        )
    )
    sso_client.cookies.set("juxin_auth_token", "opaque-session")

    response = sso_client.get("/api/ai/session")

    assert response.status_code == 200
    assert response.json()["scope"] == {
        "department": "SALES",
        "managedDepartments": ["SALES", "DELIVERY"],
    }


def test_session_denies_user_without_ai_assistant_access(
    sso_client: TestClient,
    respx_mock,
) -> None:
    respx_mock.get("http://auth.test:5180/api/auth/introspect").mock(
        return_value=httpx.Response(
            200,
            json={
                "user": {"id": 8, "username": "limited", "role": "user"},
                "scope": {},
                "apps": ["prompt-center"],
            },
        )
    )
    sso_client.cookies.set("juxin_auth_token", "opaque-session")

    response = sso_client.get("/api/ai/session")

    assert response.status_code == 403
    assert response.json()["detail"] == "无权限访问聚信 AI 助手"


def test_session_maps_expired_unified_session_to_401(
    sso_client: TestClient,
    respx_mock,
) -> None:
    respx_mock.get("http://auth.test:5180/api/auth/introspect").mock(
        return_value=httpx.Response(401, json={"error": "登录已过期"})
    )
    sso_client.cookies.set("juxin_auth_token", "expired-session")

    response = sso_client.get("/api/ai/session")

    assert response.status_code == 401
    assert response.json()["detail"] == "登录已过期"


def test_session_maps_unified_auth_outage_to_503(
    sso_client: TestClient,
    respx_mock,
) -> None:
    respx_mock.get("http://auth.test:5180/api/auth/introspect").mock(
        side_effect=httpx.ConnectError("auth unavailable")
    )
    sso_client.cookies.set("juxin_auth_token", "opaque-session")

    response = sso_client.get("/api/ai/session")

    assert response.status_code == 503
    assert response.json()["detail"] == "统一登录平台暂不可用"


def test_logout_uses_unified_logout_and_clears_cookie(
    sso_client: TestClient,
    respx_mock,
) -> None:
    logout = respx_mock.post("http://auth.test:5180/api/auth/logout").mock(
        return_value=httpx.Response(200, json={"ok": True})
    )
    sso_client.cookies.set("juxin_auth_token", "opaque-session")

    response = sso_client.post("/api/ai/logout")

    assert response.status_code == 204
    outbound = logout.calls[0].request
    assert outbound.headers["cookie"] == "juxin_auth_token=opaque-session"
    assert "authorization" not in outbound.headers
    assert outbound.content == b""
    assert "juxin_auth_token=" in response.headers["set-cookie"]
    assert "Max-Age=0" in response.headers["set-cookie"]


def request_with_auth_cookie(value: str = "opaque-session") -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/internal-test",
            "headers": [(b"cookie", f"juxin_auth_token={value}".encode())],
        }
    )


def build_session_payload() -> SessionPayload:
    return SessionPayload(
        user=UserPayload(id=7, username="zhanglei", role="user"),
        scope=AuthScope(department="研发部"),
        apps=["ai-assistant"],
    )


@pytest.mark.asyncio
async def test_require_action_uses_unified_authorization(
    sso_settings: Settings,
    respx_mock,
) -> None:
    authorize = respx_mock.post("http://auth.test:5180/api/auth/authorize").mock(
        return_value=httpx.Response(200, json={"allow": True})
    )

    result = await require_action(
        "ai_assistant:use",
        request_with_auth_cookie(),
        build_session_payload(),
        sso_settings,
    )

    assert result.user.username == "zhanglei"
    outbound = authorize.calls[0].request
    assert outbound.headers["cookie"] == "juxin_auth_token=opaque-session"
    assert outbound.content == b'{"system":"ai-assistant","action":"ai_assistant:use"}'


@pytest.mark.asyncio
async def test_require_action_maps_unified_denial_to_403(
    sso_settings: Settings,
    respx_mock,
) -> None:
    respx_mock.post("http://auth.test:5180/api/auth/authorize").mock(
        return_value=httpx.Response(200, json={"allow": False, "reason": "无使用权限"})
    )

    with pytest.raises(HTTPException) as captured:
        await require_action(
            "ai_assistant:use",
            request_with_auth_cookie(),
            build_session_payload(),
            sso_settings,
        )

    assert captured.value.status_code == 403
    assert captured.value.detail == "无使用权限"


@pytest.mark.asyncio
async def test_require_action_forwards_department_resource(
    sso_settings: Settings,
    respx_mock,
) -> None:
    authorize = respx_mock.post("http://auth.test:5180/api/auth/authorize").mock(
        return_value=httpx.Response(200, json={"allow": True})
    )

    await require_action(
        "ai_assistant:task:suggest",
        request_with_auth_cookie(),
        build_session_payload(),
        sso_settings,
        resource={"department_code": "SALES"},
    )

    assert authorize.calls[0].request.content == (
        b'{"system":"ai-assistant","action":"ai_assistant:task:suggest",'
        b'"resource":{"department_code":"SALES"}}'
    )
