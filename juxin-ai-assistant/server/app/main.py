from collections.abc import Awaitable, Callable
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from .auth import get_session
from .config import Settings, get_settings
from .schemas import SessionPayload


settings = get_settings()
app = FastAPI(title=settings.app_name, version=settings.app_version)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
)


@app.middleware("http")
async def enforce_write_origin(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    if request.method not in {"GET", "HEAD", "OPTIONS"} and not settings.auth_dev_bypass:
        if request.headers.get("origin", "") not in settings.allowed_origins:
            return JSONResponse(
                status_code=403,
                content={
                    "success": False,
                    "code": "ORIGIN_FORBIDDEN",
                    "message": "请求来源不受信任",
                    "data": None,
                },
            )
    return await call_next(request)


@app.exception_handler(Exception)
async def unhandled_error(_request: Request, _error: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "code": "INTERNAL_ERROR",
            "message": "服务暂不可用",
            "data": None,
        },
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "juxin-ai-assistant",
        "version": settings.app_version,
    }


@app.get("/api/ai/session", response_model=SessionPayload)
async def session(
    payload: Annotated[SessionPayload, Depends(get_session)],
) -> SessionPayload:
    return payload


@app.post("/api/ai/logout", status_code=204)
async def logout(
    request: Request,
    current_settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    token = request.cookies.get(current_settings.auth_cookie_name)
    if token:
        try:
            async with httpx.AsyncClient(
                base_url=current_settings.auth_service_url,
                timeout=current_settings.auth_fetch_timeout_ms / 1000,
                cookies={current_settings.auth_cookie_name: token},
            ) as client:
                upstream = await client.post("/api/auth/logout")
        except httpx.HTTPError:
            return JSONResponse(
                status_code=503,
                content={"detail": "统一登录平台暂不可用"},
            )
        if upstream.status_code >= 400:
            return JSONResponse(
                status_code=upstream.status_code,
                content={"detail": "统一退出失败"},
            )
    response = Response(status_code=204)
    response.delete_cookie(current_settings.auth_cookie_name, path="/")
    return response
