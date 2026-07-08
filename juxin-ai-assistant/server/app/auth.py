from typing import Annotated, Any

import httpx
from fastapi import Depends, HTTPException, Request
from pydantic import ValidationError

from .config import Settings, get_settings
from .schemas import AuthScope, SessionPayload, UserPayload


def get_request_auth_token(request: Request, settings: Settings) -> tuple[str, bool]:
    authorization = str(request.headers.get("authorization") or "").strip()
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() == "bearer" and value.strip():
        return value.strip(), True
    return str(request.cookies.get(settings.auth_cookie_name) or "").strip(), False


async def get_session(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> SessionPayload:
    if settings.auth_dev_bypass:
        return SessionPayload(
            user=UserPayload(id="dev", username="dev_admin", role="admin"),
            scope=AuthScope(department="通用", managed_departments=["通用"]),
            apps=[settings.auth_system_key],
        )

    token, uses_bearer = get_request_auth_token(request, settings)
    if not token:
        raise HTTPException(status_code=401, detail="未登录")

    try:
        async with httpx.AsyncClient(
            base_url=settings.auth_service_url,
            timeout=settings.auth_fetch_timeout_ms / 1000,
            cookies={settings.auth_cookie_name: token},
            headers={"Authorization": f"Bearer {token}"} if uses_bearer else None,
        ) as client:
            response = await client.get("/api/auth/introspect")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="统一登录平台暂不可用") from exc

    if response.status_code == 401:
        raise HTTPException(status_code=401, detail="登录已过期")
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail="统一登录校验失败")

    try:
        payload: dict[str, Any] = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="统一登录返回格式无效") from exc

    apps = payload.get("apps") or []
    if settings.auth_system_key not in apps:
        raise HTTPException(status_code=403, detail="无权限访问聚信 AI 助手")
    try:
        return SessionPayload(
            user=payload["user"],
            scope=payload.get("scope") or {},
            apps=apps,
        )
    except (KeyError, ValidationError) as exc:
        raise HTTPException(status_code=502, detail="统一登录返回格式无效") from exc


async def require_action(
    action: str,
    request: Request,
    session: SessionPayload,
    settings: Settings,
    *,
    resource: dict[str, Any] | None = None,
) -> SessionPayload:
    if settings.auth_dev_bypass:
        return session

    token, uses_bearer = get_request_auth_token(request, settings)
    if not token:
        raise HTTPException(status_code=401, detail="未登录")
    try:
        async with httpx.AsyncClient(
            base_url=settings.auth_service_url,
            timeout=settings.auth_fetch_timeout_ms / 1000,
            cookies={settings.auth_cookie_name: token},
            headers={"Authorization": f"Bearer {token}"} if uses_bearer else None,
        ) as client:
            body: dict[str, Any] = {
                "system": settings.auth_system_key,
                "action": action,
            }
            if resource:
                body["resource"] = resource
            response = await client.post(
                "/api/auth/authorize",
                json=body,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="统一登录平台暂不可用") from exc

    try:
        payload = response.json()
    except ValueError:
        payload = {}
    if response.status_code >= 400 or not payload.get("allow"):
        raise HTTPException(
            status_code=403,
            detail=payload.get("reason") or "无权限访问聚信 AI 助手",
        )
    return session
