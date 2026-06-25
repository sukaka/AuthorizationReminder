from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Annotated
from urllib.parse import quote

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from .auth import get_session, require_action
from .admin.errors import GovernanceError
from .admin.route_common import write_request_audit
from .admin.router import create_governance_router
from .desktop_update_public import create_desktop_update_public_router
from .config import Settings, get_settings
from .crypto import ContentCipher
from .database import get_db
from .desktop_bootstrap import DesktopBootstrap, build_desktop_bootstrap
from .feedback_service import create_feedback
from .generation_service import complete_generation, fail_generation, prepare_generation
from .history_service import (
    HistoryFilters,
    get_history_detail,
    list_history,
    load_generation_export_payload,
    load_regeneration_source,
    tombstone_history,
)
from .knowledge import KnowledgeRetriever
from .local_binding import (
    LocalBindingTokenError,
    issue_local_binding_token,
    verify_local_binding_token,
)
from .models import Assistant, GenerationRecord, Task, TaskField, UserFavorite
from .prompt_client import PromptCenterClient
from .schemas import (
    CatalogAssistantOut,
    CatalogOut,
    CompleteGenerationIn,
    CompleteGenerationOut,
    FeedbackIn,
    FeedbackOut,
    GenerationFailureIn,
    HistoryDetailOut,
    HistoryItemOut,
    HistoryListOut,
    HomeOut,
    LocalModelAuditEventIn,
    PrepareGenerationIn,
    PrepareGenerationOut,
    RegenerateOut,
    LocalBindingVerifyIn,
    LocalBindingVerifyOut,
    SessionOut,
    SessionPayload,
    TaskCardOut,
    TaskFieldOut,
    TaskOut,
)
from .sensitive import SensitiveDetector, derive_confirmation_key
from .word_export import render_generation_docx


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
    verify_path = "/api/ai/local-binding/verify"
    if (
        request.method not in {"GET", "HEAD", "OPTIONS"}
        and request.url.path != verify_path
        and not settings.auth_dev_bypass
    ):
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


@app.exception_handler(GovernanceError)
async def governance_error(
    _request: Request,
    error: GovernanceError,
) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={
            "success": False,
            "code": error.code,
            "message": error.message,
            "data": None,
        },
    )


@app.exception_handler(RequestValidationError)
async def request_validation_error(
    request: Request,
    error: RequestValidationError,
) -> JSONResponse:
    if request.url.path == "/api/ai/local-binding/verify":
        return JSONResponse(
            status_code=401,
            content={"detail": "LOCAL_BINDING_TOKEN_INVALID"},
        )
    return JSONResponse(
        status_code=422,
        content={"detail": jsonable_encoder(error.errors())},
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "juxin-ai-assistant",
        "version": settings.app_version,
    }


@app.get("/api/ai/desktop/bootstrap", response_model=DesktopBootstrap)
def desktop_bootstrap(
    current_settings: Annotated[Settings, Depends(get_settings)],
) -> DesktopBootstrap:
    return build_desktop_bootstrap(current_settings)


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


def _safe_export_filename(file_name: str) -> str:
    cleaned = "".join(
        char
        for char in file_name
        if char not in {"/", "\\", ":", "\r", "\n", '"', ";"}
        and ord(char) >= 32
        and ord(char) != 127
    ).strip()
    return cleaned or "generation.docx"


def _content_disposition_for_download(file_name: str) -> str:
    safe_name = _safe_export_filename(file_name)
    ascii_name = "".join(
        char
        if char.isascii()
        and (char.isalnum() or char in {" ", ".", "_", "-", "(", ")"})
        else "_"
        for char in safe_name
    ).strip()
    ascii_name = ascii_name or "generation.docx"
    return (
        f'attachment; filename="{ascii_name}"; '
        f"filename*=UTF-8''{quote(safe_name, safe='')}"
    )


@app.get("/api/ai/session", response_model=SessionOut)
async def session(
    payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
) -> SessionOut:
    return SessionOut(
        **payload.model_dump(),
        local_binding_token=issue_local_binding_token(
            str(payload.user.id),
            current_settings.ai_local_binding_secret,
        ),
    )


@app.post("/api/ai/local-binding/verify", response_model=LocalBindingVerifyOut)
async def verify_local_binding(
    body: LocalBindingVerifyIn,
    current_settings: Annotated[Settings, Depends(get_settings)],
) -> LocalBindingVerifyOut:
    try:
        user_id = verify_local_binding_token(
            body.token,
            current_settings.ai_local_binding_secret,
        )
    except LocalBindingTokenError as exc:
        raise HTTPException(
            status_code=401,
            detail="LOCAL_BINDING_TOKEN_INVALID",
        ) from exc
    return LocalBindingVerifyOut(user_id=user_id)


def _task_out(task: Task, fields: list[TaskField]) -> TaskOut:
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


@app.get("/api/ai/catalog", response_model=CatalogOut)
def catalog(
    _session_payload: Annotated[SessionPayload, Depends(get_session)],
    db: Annotated[Session, Depends(get_db)],
    query: str = "",
) -> CatalogOut:
    normalized_query = query.strip().casefold()
    assistants = db.scalars(
        select(Assistant)
        .where(Assistant.status == "ACTIVE")
        .order_by(Assistant.sort_order, Assistant.id)
    ).all()
    result: list[CatalogAssistantOut] = []
    for assistant in assistants:
        tasks = db.scalars(
            select(Task)
            .where(
                Task.assistant_id == assistant.id,
                Task.status == "ACTIVE",
            )
            .order_by(Task.sort_order, Task.id)
        ).all()
        assistant_matches = bool(
            normalized_query
            and normalized_query
            in f"{assistant.name} {assistant.description}".casefold()
        )
        matching_tasks = [
            task
            for task in tasks
            if not normalized_query
            or assistant_matches
            or normalized_query
            in f"{task.name} {task.description}".casefold()
        ]
        if not matching_tasks:
            continue
        task_ids = [task.id for task in matching_tasks]
        fields_by_task: dict[int, list[TaskField]] = {
            task_id: []
            for task_id in task_ids
        }
        fields = db.scalars(
            select(TaskField)
            .where(TaskField.task_id.in_(task_ids))
            .order_by(
                TaskField.task_id,
                TaskField.sort_order,
                TaskField.id,
            )
        ).all()
        for field in fields:
            fields_by_task[field.task_id].append(field)
        result.append(
            CatalogAssistantOut(
                uuid=assistant.uuid,
                code=assistant.code,
                name=assistant.name,
                description=assistant.description,
                icon=assistant.icon,
                tasks=[
                    _task_out(task, fields_by_task[task.id])
                    for task in matching_tasks
                ],
            )
        )
    return CatalogOut(assistants=result)


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
    return _task_out(task, list(fields))


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
    write_request_audit(
        db,
        session_payload,
        request,
        current_settings,
        action="generation.feedback",
        entity_type="generation",
        entity_uuid=generation_uuid,
        metadata={
            "generation_uuid": generation_uuid,
            "feedback_type": body.feedback_type.value,
        },
    )
    db.commit()
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
    prepared, record = await prepare_generation(
        db,
        session_payload,
        body,
        prompt_client,
        cipher,
        current_settings.content_encryption_key_version,
        sensitive_detector,
        knowledge_retriever,
    )
    write_request_audit(
        db,
        session_payload,
        request,
        current_settings,
        action="generation.prepare",
        entity_type="generation",
        entity_uuid=record.uuid,
        metadata={
            "task_uuid": body.task_uuid,
            "generation_uuid": record.uuid,
            "prompt_external_id": record.prompt_external_id,
            "prompt_version": record.prompt_version,
            "status": record.status,
        },
    )
    db.commit()
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


@app.get("/api/ai/generations/{generation_uuid}/export.docx")
async def export_generation_word(
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
    payload = load_generation_export_payload(
        db,
        str(session_payload.user.id),
        generation_uuid,
        cipher,
    )
    try:
        document = render_generation_docx(
            title=str(payload["task_name"]),
            task_name=str(payload["task_name"]),
            department=str(payload["department"]),
            author=str(payload["author"]),
            output=str(payload["output"]),
            version=str(payload["version"]),
        )
    except Exception as exc:
        write_request_audit(
            db,
            session_payload,
            request,
            current_settings,
            action="generation.export_word",
            entity_type="generation",
            entity_uuid=generation_uuid,
            metadata={
                "generation_uuid": generation_uuid,
                "task_uuid": str(payload["task_uuid"]),
                "status": "FAILED",
            },
        )
        db.commit()
        raise HTTPException(
            status_code=500,
            detail="Word 生成失败，请稍后重试",
        ) from exc
    write_request_audit(
        db,
        session_payload,
        request,
        current_settings,
        action="generation.export_word",
        entity_type="generation",
        entity_uuid=generation_uuid,
        metadata={
            "generation_uuid": generation_uuid,
            "task_uuid": str(payload["task_uuid"]),
            "status": "COMPLETED",
        },
    )
    db.commit()
    return Response(
        content=document,
        media_type=(
            "application/vnd.openxmlformats-officedocument."
            "wordprocessingml.document"
        ),
        headers={
            "Content-Disposition": _content_disposition_for_download(
                str(payload["file_name"])
            ),
        },
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
    write_request_audit(
        db,
        session_payload,
        request,
        current_settings,
        action="generation.delete",
        entity_type="generation",
        entity_uuid=generation_uuid,
        metadata={
            "generation_uuid": generation_uuid,
            "status": "DELETED",
        },
    )
    db.commit()
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
    prepared, child = await prepare_generation(
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
    child.parent_generation_id = parent.id
    write_request_audit(
        db,
        session_payload,
        request,
        current_settings,
        action="generation.regenerate",
        entity_type="generation",
        entity_uuid=child.uuid,
        metadata={
            "task_uuid": task.uuid,
            "generation_uuid": child.uuid,
            "prompt_external_id": child.prompt_external_id,
            "prompt_version": child.prompt_version,
            "status": child.status,
        },
    )
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
    write_request_audit(
        db,
        session_payload,
        request,
        current_settings,
        action="generation.complete",
        entity_type="generation",
        entity_uuid=generation_uuid,
        metadata={
            "generation_uuid": generation_uuid,
            "status": record.status,
        },
    )
    db.commit()
    return CompleteGenerationOut(
        generation_uuid=record.uuid,
        status=record.status,
    )


@app.post(
    "/api/ai/generations/{generation_uuid}/fail",
    response_model=CompleteGenerationOut,
)
async def fail_generation_route(
    generation_uuid: str,
    body: GenerationFailureIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> CompleteGenerationOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    record = fail_generation(
        db,
        session_payload,
        generation_uuid,
        body,
    )
    write_request_audit(
        db,
        session_payload,
        request,
        current_settings,
        action="generation.fail",
        entity_type="generation",
        entity_uuid=generation_uuid,
        metadata={
            "generation_uuid": generation_uuid,
            "status": record.status,
            "error_code": record.error_code,
        },
    )
    db.commit()
    return CompleteGenerationOut(
        generation_uuid=record.uuid,
        status=record.status,
    )



@app.post("/api/ai/audit/local-model-events", status_code=204)
async def record_local_model_audit_event(
    body: LocalModelAuditEventIn,
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
    write_request_audit(
        db,
        session_payload,
        request,
        current_settings,
        action="generation.local_model_event",
        entity_type="generation",
        entity_uuid=body.generation_uuid,
        metadata={
            "generation_uuid": body.generation_uuid,
            "event": body.event,
            "model_id": body.model_id,
            "provider": body.provider,
            "latency_ms": body.latency_ms,
            "error_code": body.error_code,
        },
    )
    db.commit()
    return Response(status_code=204)


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


app.include_router(
    create_governance_router(
        get_prompt_client,
        get_content_cipher,
    )
)

app.include_router(
    create_desktop_update_public_router(),
    prefix="/api/ai",
)
