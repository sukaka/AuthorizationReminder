from collections.abc import Awaitable, Callable
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from sqlalchemy.orm import Session
from sqlalchemy import select

from .auth import get_session, require_action
from .config import Settings, get_settings
from .crypto import ContentCipher
from .database import get_db
from .generation_service import complete_generation, prepare_generation
from .knowledge import KnowledgeRetriever
from .models import Task, TaskField
from .prompt_client import PromptCenterClient
from .schemas import (
    CompleteGenerationIn,
    CompleteGenerationOut,
    PrepareGenerationIn,
    PrepareGenerationOut,
    SessionPayload,
    TaskFieldOut,
    TaskOut,
)
from .sensitive import SensitiveDetector, derive_confirmation_key


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


def get_prompt_client(
    current_settings: Annotated[Settings, Depends(get_settings)],
) -> PromptCenterClient:
    return PromptCenterClient(
        current_settings.prompt_center_url,
        current_settings.prompt_center_runtime_token,
        current_settings.auth_fetch_timeout_ms / 1000,
    )


def get_content_cipher(
    current_settings: Annotated[Settings, Depends(get_settings)],
) -> ContentCipher:
    return ContentCipher(current_settings.content_encryption_key)


def get_sensitive_detector(
    current_settings: Annotated[Settings, Depends(get_settings)],
) -> SensitiveDetector:
    return SensitiveDetector(
        derive_confirmation_key(current_settings.content_encryption_key)
    )


def get_knowledge_retriever(
    cipher: Annotated[ContentCipher, Depends(get_content_cipher)],
) -> KnowledgeRetriever:
    return KnowledgeRetriever(cipher)


@app.get("/api/ai/session", response_model=SessionPayload)
async def session(
    payload: Annotated[SessionPayload, Depends(get_session)],
) -> SessionPayload:
    return payload


@app.get("/api/ai/tasks/{task_code}", response_model=TaskOut)
def get_task(
    task_code: str,
    _session_payload: Annotated[SessionPayload, Depends(get_session)],
    db: Annotated[Session, Depends(get_db)],
) -> TaskOut:
    task = db.scalar(
        select(Task).where(Task.code == task_code, Task.status == "ACTIVE")
    )
    if task is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="任务不存在或尚未发布")
    fields = db.scalars(
        select(TaskField)
        .where(TaskField.task_id == task.id)
        .order_by(TaskField.sort_order, TaskField.id)
    ).all()
    return TaskOut(
        uuid=task.uuid,
        code=task.code,
        name=task.name,
        description=task.description,
        output_format=task.output_format,
        safety_notice=task.safety_notice,
        fields=[
            TaskFieldOut(
                field_key=field.field_key,
                label=field.label,
                field_type=field.field_type.upper(),
                required=field.required,
                placeholder=field.placeholder,
                example=field.example,
                options=field.options_json or [],
                validation=field.validation_json or {},
            )
            for field in fields
        ],
    )


@app.post(
    "/api/ai/generations/prepare",
    response_model=PrepareGenerationOut,
    status_code=201,
)
async def prepare_generation_route(
    body: PrepareGenerationIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    prompt_client: Annotated[PromptCenterClient, Depends(get_prompt_client)],
    cipher: Annotated[ContentCipher, Depends(get_content_cipher)],
    sensitive_detector: Annotated[
        SensitiveDetector,
        Depends(get_sensitive_detector),
    ],
    knowledge_retriever: Annotated[
        KnowledgeRetriever,
        Depends(get_knowledge_retriever),
    ],
) -> PrepareGenerationOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    prepared = await prepare_generation(
        db,
        session_payload,
        body,
        prompt_client,
        cipher,
        current_settings.content_encryption_key_version,
        sensitive_detector,
        knowledge_retriever,
    )
    return PrepareGenerationOut(**prepared.__dict__)


@app.post(
    "/api/ai/generations/{generation_uuid}/complete",
    response_model=CompleteGenerationOut,
)
async def complete_generation_route(
    generation_uuid: str,
    body: CompleteGenerationIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_content_cipher)],
) -> CompleteGenerationOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    record = complete_generation(
        db,
        session_payload,
        generation_uuid,
        body,
        cipher,
    )
    return CompleteGenerationOut(
        generation_uuid=record.uuid,
        status=record.status,
    )


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
