from typing import Annotated, Any

import httpx
from fastapi import Cookie, Depends, HTTPException, Request, status

from .config import Settings, get_settings
from .schemas import UserPayload


async def get_current_user(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    token: Annotated[str | None, Cookie(alias="juxin_auth_token")] = None,
) -> UserPayload:
    if settings.auth_dev_bypass:
        return UserPayload(id="dev", username="dev_admin", role="admin", app_access=[settings.auth_system_key])

    cookie_token = request.cookies.get(settings.auth_cookie_name) or token
    if not cookie_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录")

    timeout = max(1, settings.auth_fetch_timeout_ms / 1000)
    try:
        async with httpx.AsyncClient(base_url=settings.auth_service_url, timeout=timeout) as client:
            response = await client.get(
                "/api/auth/introspect",
                cookies={settings.auth_cookie_name: cookie_token},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="统一登录平台暂不可用") from exc

    if response.status_code == 401:
        raise HTTPException(status_code=401, detail="登录已过期")
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text or "统一登录校验失败")

    payload: dict[str, Any] = response.json()
    user = payload.get("user") or {}
    apps = payload.get("apps") or []
    user["app_access"] = apps if isinstance(apps, list) else []
    return UserPayload(**user)


async def require_action(
    action: str,
    request: Request,
    user: Annotated[UserPayload, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> UserPayload:
    if settings.auth_dev_bypass:
        return user

    cookie_token = request.cookies.get(settings.auth_cookie_name)
    timeout = max(1, settings.auth_fetch_timeout_ms / 1000)
    try:
        async with httpx.AsyncClient(base_url=settings.auth_service_url, timeout=timeout) as client:
            response = await client.post(
                "/api/auth/authorize",
                cookies={settings.auth_cookie_name: cookie_token},
                json={"system": settings.auth_system_key, "action": action},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="统一授权服务暂不可用") from exc

    payload = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
    if response.status_code >= 400 or not payload.get("allow"):
        raise HTTPException(status_code=403, detail=payload.get("reason") or "无权限访问软件成分分析平台")
    return user
