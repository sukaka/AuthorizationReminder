from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from .auth import get_session, require_action
from .config import Settings, get_settings
from .crypto import ContentCipher
from .database import get_db
from .feedback_service import create_feedback
from .generation_service import complete_generation, prepare_generation
from .history_service import (
    HistoryFilters,
    get_history_detail,
    list_history,
    load_regeneration_source,
    tombstone_history,
)
from .knowledge import KnowledgeRetriever
from .models import Assistant, GenerationRecord, Task, TaskField, UserFavorite
from .prompt_client import PromptCenterClient
from .schemas import (
    CompleteGenerationIn,
    CompleteGenerationOut,
    FeedbackIn,
    FeedbackOut,
    HistoryDetailOut,
    HistoryItemOut,
    HistoryListOut,
    HomeOut,
    PrepareGenerationIn,
    PrepareGenerationOut,
    RegenerateOut,
    SessionPayload,
    TaskCardOut,
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


def _task_card(
    task: Task,
    assistant: Assistant,
    last_used_at: datetime | None = None,
) -> TaskCardOut:
    return TaskCardOut(
        task_uuid=task.uuid,
        task_code=task.code,
        task_name=task.name,
        description=task.description,
        assistant_code=assistant.code,
        assistant_name=assistant.name,
        last_used_at=last_used_at,
    )


def _history_item(
    record: GenerationRecord,
    task: Task,
    assistant: Assistant,
) -> HistoryItemOut:
    return HistoryItemOut(
        uuid=record.uuid,
        task_uuid=task.uuid,
        task_name=task.name,
        assistant_code=assistant.code,
        assistant_name=assistant.name,
        status=record.status,
        model_display_name=record.model_display_name,
        model_id=record.model_id,
        prompt_version=record.prompt_version,
        latency_ms=record.latency_ms,
        usage=record.usage_json or {},
        created_at=record.created_at,
        finished_at=record.finished_at,
    )


@app.put("/api/ai/favorites/{task_uuid}", status_code=204)
async def add_favorite(
    task_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    task = db.scalar(
        select(Task).where(Task.uuid == task_uuid, Task.status == "ACTIVE")
    )
    if task is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="任务不存在或尚未发布")
    values = {
        "sso_user_id": str(session_payload.user.id),
        "task_id": task.id,
    }
    dialect = db.get_bind().dialect.name
    if dialect == "mysql":
        db.execute(mysql_insert(UserFavorite).values(**values).prefix_with("IGNORE"))
    elif dialect == "sqlite":
        db.execute(
            sqlite_insert(UserFavorite)
            .values(**values)
            .on_conflict_do_nothing(
                index_elements=["sso_user_id", "task_id"]
            )
        )
    elif db.scalar(
        select(UserFavorite.id).where(
            UserFavorite.sso_user_id == values["sso_user_id"],
            UserFavorite.task_id == task.id,
        )
    ) is None:
        db.add(UserFavorite(**values))
    db.commit()
    return Response(status_code=204)


@app.delete("/api/ai/favorites/{task_uuid}", status_code=204)
async def remove_favorite(
    task_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    task_id = db.scalar(select(Task.id).where(Task.uuid == task_uuid))
    if task_id is not None:
        db.execute(
            delete(UserFavorite).where(
                UserFavorite.sso_user_id == str(session_payload.user.id),
                UserFavorite.task_id == task_id,
            )
        )
        db.commit()
    return Response(status_code=204)


@app.get("/api/ai/home", response_model=HomeOut)
def home(
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    db: Annotated[Session, Depends(get_db)],
) -> HomeOut:
    user_id = str(session_payload.user.id)
    favorite_rows = db.execute(
        select(Task, Assistant)
        .join(UserFavorite, UserFavorite.task_id == Task.id)
        .join(Assistant, Assistant.id == Task.assistant_id)
        .where(
            UserFavorite.sso_user_id == user_id,
            Task.status == "ACTIVE",
            Assistant.status == "ACTIVE",
        )
        .order_by(UserFavorite.created_at.desc())
        .limit(50)
    ).all()
    latest_by_task = (
        select(
            GenerationRecord.task_id.label("task_id"),
            func.max(GenerationRecord.created_at).label("last_used_at"),
        )
        .where(
            GenerationRecord.sso_user_id == user_id,
            GenerationRecord.status != "DELETED",
        )
        .group_by(GenerationRecord.task_id)
        .subquery()
    )
    recent_task_rows = db.execute(
        select(Task, Assistant, latest_by_task.c.last_used_at)
        .join(latest_by_task, latest_by_task.c.task_id == Task.id)
        .join(Assistant, Assistant.id == Task.assistant_id)
        .where(Task.status == "ACTIVE", Assistant.status == "ACTIVE")
        .order_by(latest_by_task.c.last_used_at.desc())
        .limit(8)
    ).all()
    recent_generation_rows = db.execute(
        select(GenerationRecord, Task, Assistant)
        .join(Task, Task.id == GenerationRecord.task_id)
        .join(Assistant, Assistant.id == Task.assistant_id)
        .where(
            GenerationRecord.sso_user_id == user_id,
            GenerationRecord.status != "DELETED",
        )
        .order_by(
            GenerationRecord.created_at.desc(),
            GenerationRecord.id.desc(),
        )
        .limit(8)
    ).all()
    return HomeOut(
        favorites=[
            _task_card(task, assistant)
            for task, assistant in favorite_rows
        ],
        recent_tasks=[
            _task_card(task, assistant, last_used_at)
            for task, assistant, last_used_at in recent_task_rows
        ],
        recent_generations=[
            _history_item(record, task, assistant)
            for record, task, assistant in recent_generation_rows
        ],
        safety_reminders=[
            "生成内容必须由员工复核后再使用。",
            "提交敏感信息前请确认处理范围和必要性。",
            "模型配置与 API Key 仅保存在当前设备。",
        ],
    )


@app.post(
    "/api/ai/generations/{generation_uuid}/feedback",
    response_model=FeedbackOut,
    status_code=201,
)
async def submit_feedback(
    generation_uuid: str,
    body: FeedbackIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_content_cipher)],
) -> FeedbackOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    record = create_feedback(
        db,
        str(session_payload.user.id),
        generation_uuid,
        body.feedback_type,
        body.content,
        cipher,
        current_settings.content_encryption_key_version,
    )
    return FeedbackOut(
        uuid=record.uuid,
        generation_uuid=generation_uuid,
        feedback_type=body.feedback_type,
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


@app.get("/api/ai/generations", response_model=HistoryListOut)
def generation_history(
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    db: Annotated[Session, Depends(get_db)],
    task_uuid: str | None = None,
    assistant_code: str | None = None,
    status: str | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> HistoryListOut:
    items, total = list_history(
        db,
        str(session_payload.user.id),
        HistoryFilters(
            task_uuid=task_uuid,
            assistant_code=assistant_code,
            status=status,
            created_from=created_from,
            created_to=created_to,
        ),
        page=page,
        page_size=page_size,
    )
    return HistoryListOut(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@app.get(
    "/api/ai/generations/{generation_uuid}",
    response_model=HistoryDetailOut,
)
def generation_history_detail(
    generation_uuid: str,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_content_cipher)],
) -> HistoryDetailOut:
    return HistoryDetailOut(
        **get_history_detail(
            db,
            str(session_payload.user.id),
            generation_uuid,
            cipher,
        )
    )


@app.delete("/api/ai/generations/{generation_uuid}", status_code=204)
async def delete_generation_history(
    generation_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_content_cipher)],
) -> Response:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    tombstone_history(
        db,
        str(session_payload.user.id),
        generation_uuid,
        cipher,
    )
    return Response(status_code=204)


@app.post(
    "/api/ai/generations/{generation_uuid}/regenerate",
    response_model=RegenerateOut,
    status_code=201,
)
async def regenerate_history(
    generation_uuid: str,
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
) -> RegenerateOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    parent, task, inputs = load_regeneration_source(
        db,
        str(session_payload.user.id),
        generation_uuid,
        cipher,
    )
    scan = sensitive_detector.scan(inputs)
    prepared = await prepare_generation(
        db,
        session_payload,
        PrepareGenerationIn(
            task_uuid=task.uuid,
            inputs=inputs,
            sensitive_confirmation_digest=scan.confirmation_digest,
        ),
        prompt_client,
        cipher,
        current_settings.content_encryption_key_version,
        sensitive_detector,
        knowledge_retriever,
    )
    child = db.scalar(
        select(GenerationRecord).where(
            GenerationRecord.uuid == prepared.generation_uuid
        )
    )
    child.parent_generation_id = parent.id
    db.commit()
    return RegenerateOut(
        **prepared.__dict__,
        parent_generation_uuid=parent.uuid,
    )


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
