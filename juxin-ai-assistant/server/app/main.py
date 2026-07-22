from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager, suppress
from datetime import datetime
import asyncio
import logging
import re
from typing import Annotated
from urllib.parse import quote

import httpx
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from .attachments import create_attachment
from .auth import get_session, is_platform_admin_role, require_action
from .admin.errors import GovernanceError
from .agent_loop import QualityChecker
from .admin.route_common import write_request_audit
from .admin.router import create_governance_router
from .chat_routes import conversations_router, router as chat_router
from .desktop_update_public import create_desktop_update_public_router
from .export_routes import router as export_router
from .config import Settings, get_settings
from .crypto import ContentCipher
from .database import SessionLocal, get_db
from .desktop_bootstrap import DesktopBootstrap, build_desktop_bootstrap
from .document_templates.base import DocumentRenderPayload
from .document_templates.registry import get_document_template
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
from .hot_questions import hot_question_scheduler
from .intent_router import route_intent
from .knowledge import KnowledgeRetriever
from .knowledge_embedding import build_embedding_service
from .knowledge_search import search_knowledge_chunks
from .knowledge_files import (
    MAX_KNOWLEDGE_FILE_BYTES,
    create_knowledge_file_from_bytes,
    invalidate_knowledge_search,
)
from .knowledge_routes import router as knowledge_router
from .learning_routes import router as learning_router
from .local_binding import (
    LocalBindingTokenError,
    issue_local_binding_token,
    verify_local_binding_token,
)
from .long_task_routes import dispatcher as long_task_dispatcher, router as long_task_router
from .agent_run_routes import router as agent_run_router
from .artifact_routes import router as artifact_router
from .ops_routes import router as ops_router
from .learning_candidate_routes import router as learning_candidate_router
from .channel_routes import router as channel_router
from .template_routes import router as template_router
from .knowledge_version_routes import router as knowledge_version_router
from .channel_webhook_routes import router as channel_webhook_router
from .learning_eval_routes import router as learning_eval_router
from .agent_hub_routes import router as agent_hub_router
from .role_assistant_routes import router as role_assistant_router
from .channel_job_routes import router as channel_job_router
from .data_egress_routes import router as data_egress_router
from .enterprise_intelligence.routes import router as enterprise_intelligence_router
from .workflow_routes import router as workflow_router
from .wechat_external_routes import router as wechat_external_router
from .model_profile_routes import router as model_profile_router
from .models import Assistant, GenerationRecord, Task, TaskField, UserFavorite
from .models import KnowledgeBase
from .models import KnowledgeChunk, KnowledgeFile
from .models import KnowledgeTaskLink, TaskPromptBinding
from .personal_reference_routes import router as personal_reference_router
from .prompt_client import PromptCenterClient
from .project_routes import router as project_router
from .project_initialization_routes import router as project_initialization_router
from .project_context_routes import router as project_context_router
from .project_task_routes import router as project_task_router
from .skill_routes import router as skill_router
from .skill_registry import SkillRegistry
from .static_web import mount_static_web
from .web_routes import router as web_router
from .work_artifact_routes import router as work_artifact_router
from .professional_delivery.routes import (
    comment_router as professional_comment_router,
    export_router as professional_export_router,
    review_issue_router as professional_review_issue_router,
    router as professional_delivery_router,
)
from .professional_delivery.fact_routes import (
    deliverable_fact_router as professional_deliverable_fact_router,
    evidence_router as professional_evidence_router,
    fact_router as professional_fact_router,
)
from .professional_delivery.catalog_routes import (
    approval_flow_catalog_router as professional_approval_flow_catalog_router,
    skill_catalog_router as professional_skill_catalog_router,
    template_catalog_router as professional_template_catalog_router,
)
from .professional_delivery.runner_routes import (
    deliverable_run_router as professional_deliverable_run_router,
    professional_run_router,
)
from .schemas import (
    AttachmentOut,
    CatalogAssistantOut,
    CapabilityListOut,
    CapabilityOut,
    CatalogOut,
    CompleteGenerationIn,
    CompleteGenerationOut,
    FeedbackIn,
    FeedbackOut,
    GenerationFailureIn,
    HistoryDetailOut,
    HistoryItemOut,
    HistoryListOut,
    IntentCandidateOut,
    IntentSkillCandidateOut,
    IntentRouteIn,
    IntentRouteOut,
    KnowledgeFileListOut,
    KnowledgeFileOut,
    LoopQualityCheckIn,
    LoopQualityCheckOut,
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
    MessageOut,
)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    from .channel_job_worker import channel_job_scheduler
    from .harness_spec import load_harness_spec
    from .workflow_control_worker import workflow_control_scheduler

    load_harness_spec()
    long_task_dispatcher.recover()
    await asyncio.to_thread(_prewarm_knowledge_search)
    hot_question_task = asyncio.create_task(hot_question_scheduler(settings))
    channel_job_task = asyncio.create_task(channel_job_scheduler(settings))
    workflow_control_task = asyncio.create_task(workflow_control_scheduler(settings))
    try:
        yield
    finally:
        hot_question_task.cancel()
        channel_job_task.cancel()
        workflow_control_task.cancel()
        with suppress(asyncio.CancelledError):
            await hot_question_task
        with suppress(asyncio.CancelledError):
            await channel_job_task
        with suppress(asyncio.CancelledError):
            await workflow_control_task


def _prewarm_knowledge_search() -> None:
    if settings.database_url.startswith("sqlite"):
        return
    try:
        with SessionLocal() as db:
            cipher = ContentCipher(settings.content_encryption_key)
            search_knowledge_chunks(
                db,
                sso_user_id="system-prewarm",
                query="知识库检索预热",
                cipher=cipher,
                top_k=12,
                embedding_service=build_embedding_service(db, settings),
                track_usage=False,
            )
            db.commit()
    except Exception:
        logging.getLogger(__name__).exception("knowledge search prewarm failed")


settings = get_settings()
app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Idempotency-Key",
        "X-CSRF-Token",
        "X-Workflow-Event-Credential",
        "X-Workflow-Event-Signature",
        "X-Workflow-Event-Timestamp",
        "X-Workflow-Owner-Id",
    ],
)


def _set_security_headers(response: Response) -> Response:
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=()",
    )
    return response


@app.middleware("http")
async def enforce_write_origin(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    verify_path = "/api/ai/local-binding/verify"
    machine_ingress_paths = {
        "/api/ai/channels/webhooks/feishu",
        "/api/ai/channels/webhooks/wecom",
        "/api/ai/channels/webhooks/wecom-kf",
        "/api/ai/workflows/events/signed",
    }
    current_settings = get_settings()
    if (
        request.method not in {"GET", "HEAD", "OPTIONS"}
        and request.url.path != verify_path
        and not current_settings.auth_dev_bypass
    ):
        origin = request.headers.get("origin", "")
        has_bearer = request.headers.get("authorization", "").lower().startswith("bearer ")
        # Desktop/native clients commonly have no Origin header.  Keep that
        # machine-to-machine case working, but never let a cross-origin browser
        # request bypass the allowlist merely by attaching a bearer token.
        machine_request = request.url.path in machine_ingress_paths or (
            has_bearer and not origin
        )
        if not machine_request and origin not in current_settings.allowed_origins:
            return _set_security_headers(JSONResponse(
                status_code=403,
                content={
                    "success": False,
                    "code": "ORIGIN_FORBIDDEN",
                    "message": "请求来源不受信任",
                    "data": None,
                },
            ))
    return _set_security_headers(await call_next(request))


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
@app.get("/api/ai/health")
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
        document_template_code=task.document_template_code,
        attachment_policy=task.attachment_policy_json,
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
        if not matching_tasks and (
            tasks or (normalized_query and not assistant_matches)
        ):
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


@app.get("/api/ai/capabilities", response_model=CapabilityListOut)
async def capabilities(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> CapabilityListOut:
    await require_action(
        "ai_assistant:admin",
        request,
        session_payload,
        current_settings,
    )
    rows = db.execute(
        select(Task, Assistant)
        .join(Assistant, Assistant.id == Task.assistant_id)
        .order_by(Assistant.sort_order, Task.sort_order, Task.id)
    ).all()
    task_ids = [task.id for task, _assistant in rows]
    fields_by_task: dict[int, list[TaskField]] = {task_id: [] for task_id in task_ids}
    bindings_by_task: dict[int, TaskPromptBinding] = {}
    knowledge_counts: dict[int, int] = {task_id: 0 for task_id in task_ids}

    if task_ids:
        fields = db.scalars(
            select(TaskField)
            .where(TaskField.task_id.in_(task_ids))
            .order_by(TaskField.task_id, TaskField.sort_order, TaskField.id)
        ).all()
        for field in fields:
            fields_by_task[field.task_id].append(field)

        bindings = db.scalars(
            select(TaskPromptBinding)
            .where(TaskPromptBinding.task_id.in_(task_ids))
        ).all()
        bindings_by_task = {binding.task_id: binding for binding in bindings}

        count_rows = db.execute(
            select(KnowledgeTaskLink.task_id, func.count(KnowledgeTaskLink.id))
            .where(KnowledgeTaskLink.task_id.in_(task_ids))
            .group_by(KnowledgeTaskLink.task_id)
        ).all()
        knowledge_counts.update({task_id: count for task_id, count in count_rows})

    items: list[CapabilityOut] = []
    for task, assistant in rows:
        binding = bindings_by_task.get(task.id)
        if binding is None:
            prompt_binding_status = "missing"
        elif binding.status == "ACTIVE":
            prompt_binding_status = "configured"
        else:
            prompt_binding_status = "stale"
        items.append(
            CapabilityOut(
                task_uuid=task.uuid,
                task_code=task.code,
                task_name=task.name,
                assistant_name=assistant.name,
                task_status=task.status,
                input_fields=[
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
                    for field in fields_by_task.get(task.id, [])
                ],
                output_format=task.output_format,
                document_type=task.document_type,
                prompt_binding_status=prompt_binding_status,
                knowledge_link_count=knowledge_counts.get(task.id, 0),
            )
        )
    return CapabilityListOut(items=items)


@app.post("/api/ai/intent/route", response_model=IntentRouteOut)
def route_task_intent(
    body: IntentRouteIn,
    _session_payload: Annotated[SessionPayload, Depends(get_session)],
    db: Annotated[Session, Depends(get_db)],
) -> IntentRouteOut:
    rows = db.execute(
        select(Task, Assistant)
        .join(Assistant, Assistant.id == Task.assistant_id)
        .where(Task.status == "ACTIVE", Assistant.status == "ACTIVE")
        .order_by(Assistant.sort_order, Task.sort_order, Task.id)
    ).all()
    task_ids = [task.id for task, _assistant in rows]
    fields_by_task: dict[int, list[str]] = {task_id: [] for task_id in task_ids}
    if task_ids:
        fields = db.scalars(
            select(TaskField)
            .where(TaskField.task_id.in_(task_ids))
            .order_by(TaskField.task_id, TaskField.sort_order, TaskField.id)
        ).all()
        for field in fields:
            fields_by_task[field.task_id].extend(
                item
                for item in (
                    field.label,
                    field.placeholder,
                    field.example,
                    field.field_key,
                )
                if item
            )

    candidates = route_intent(
        body.query,
        [
            {
                "uuid": task.uuid,
                "code": task.code,
                "name": task.name,
                "description": task.description,
                "assistant_name": assistant.name,
                "field_keywords": fields_by_task.get(task.id, []),
            }
            for task, assistant in rows
        ],
    )
    skill_matches = SkillRegistry.default().match(body.query)
    return IntentRouteOut(
        candidates=[
            IntentCandidateOut(
                task_uuid=item["uuid"],
                task_code=item["code"],
                task_name=item["name"],
                assistant_name=item["assistant_name"],
                score=item["score"],
                reasons=item["reasons"],
            )
            for item in candidates
        ],
        skill_candidates=[
            IntentSkillCandidateOut(
                skill_id=skill.id,
                skill_name=skill.name,
                description=skill.manifest.description,
                score=8,
                reasons=[f"匹配能力：{tag}" for tag in skill.manifest.tags[:2]] or ["匹配业务能力"],
            )
            for skill in skill_matches[:5]
        ],
    )


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
    "/api/ai/attachments",
    response_model=AttachmentOut,
    status_code=201,
)
async def upload_attachment(
    task_uuid: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_content_cipher)],
) -> AttachmentOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    try:
        attachment, extracted_characters = await create_attachment(
            db,
            str(session_payload.user.id),
            task_uuid,
            file,
            cipher,
            current_settings.content_encryption_key_version,
        )
        write_request_audit(
            db,
            session_payload,
            request,
            current_settings,
            action="generation_attachment.upload",
            entity_type="generation_attachment",
            entity_uuid=attachment.uuid,
            metadata={
                "attachment_uuid": attachment.uuid,
                "task_uuid": task_uuid,
                "file_type": attachment.file_type,
                "file_size": attachment.file_size,
                "status": attachment.status,
            },
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return AttachmentOut(
        uuid=attachment.uuid,
        name=attachment.file_name,
        type=attachment.file_type,
        size=attachment.file_size,
        created_at=attachment.created_at,
        attachment_uuid=attachment.uuid,
        file_name=attachment.file_name,
        file_type=attachment.file_type,
        file_size=attachment.file_size,
        status=attachment.status,
        extracted_characters=extracted_characters,
    )


def _knowledge_file_out(
    db: Session,
    file_record: KnowledgeFile,
) -> KnowledgeFileOut:
    knowledge_base_uuid = ""
    if file_record.knowledge_base_id is not None:
        knowledge_base_uuid = db.scalar(
            select(KnowledgeBase.uuid).where(KnowledgeBase.id == file_record.knowledge_base_id)
        ) or ""
    chunk_count = db.scalar(
        select(func.count(KnowledgeChunk.id)).where(
            KnowledgeChunk.file_id == file_record.id,
            KnowledgeChunk.status == "READY",
        )
    ) or 0
    return KnowledgeFileOut(
        file_uuid=file_record.uuid,
        knowledge_base_id=knowledge_base_uuid,
        file_name=file_record.file_name,
        file_type=file_record.file_type,
        file_size=file_record.file_size,
        visibility=file_record.visibility,
        status=file_record.status,
        chunk_count=int(chunk_count),
        created_at=file_record.created_at,
        source_type=file_record.source_type,
        usage_type=file_record.usage_type,
        review_status=file_record.review_status,
        rag_enabled=file_record.rag_enabled,
        reference_enabled=file_record.reference_enabled,
        rag_scope=file_record.rag_scope,
        permission_scope=file_record.permission_scope,
        category=file_record.category,
        document_type=file_record.document_type,
        tags=list(file_record.tags_json or []),
        parse_status=file_record.parse_status,
        index_status=file_record.index_status,
        external_public=file_record.external_public,
        external_download_allowed=file_record.external_download_allowed,
    )


_KNOWLEDGE_USAGE_TYPES = {
    "session_attachment",
    "personal_reference",
    "official_knowledge",
}
_KNOWLEDGE_REVIEW_STATUSES = {
    "draft",
    "pending",
    "approved",
    "rejected",
    "official",
    "deprecated",
}
_KNOWLEDGE_RAG_SCOPES = {
    "none",
    "session",
    "personal",
    "company",
    "department",
    "project",
}
_KNOWLEDGE_PERMISSION_SCOPES = {
    "private",
    "company",
    "department",
    "project",
    "admin",
}


def _is_admin_session(session_payload: SessionPayload) -> bool:
    return is_platform_admin_role(session_payload.user.role)


def _split_tags(raw_tags: str) -> list[str]:
    tags: list[str] = []
    for tag in re.split(r"[,，\n]", raw_tags or ""):
        normalized = tag.strip()
        if normalized:
            tags.append(normalized[:64])
    return tags[:20]


@app.post(
    "/api/ai/knowledge/files",
    response_model=KnowledgeFileOut,
    status_code=201,
)
async def upload_knowledge_file(
    file: Annotated[UploadFile, File()],
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_content_cipher)],
    visibility: Annotated[str, Form()] = "PRIVATE",
    usage_type: Annotated[str, Form()] = "personal_reference",
    review_status: Annotated[str, Form()] = "draft",
    rag_enabled: Annotated[bool, Form()] = False,
    reference_enabled: Annotated[bool, Form()] = True,
    rag_scope: Annotated[str, Form()] = "personal",
    permission_scope: Annotated[str, Form()] = "private",
    conversation_id: Annotated[str, Form()] = "",
    category: Annotated[str, Form()] = "个人素材",
    document_type: Annotated[str, Form()] = "其他",
    tags: Annotated[str, Form()] = "",
) -> KnowledgeFileOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    normalized_visibility = visibility.strip().upper() or "PRIVATE"
    if normalized_visibility not in {"PRIVATE", "PUBLIC"}:
        raise HTTPException(status_code=422, detail="知识文件可见性无效")
    normalized_usage_type = usage_type.strip().lower() or "personal_reference"
    normalized_review_status = review_status.strip().lower() or "draft"
    normalized_rag_scope = rag_scope.strip().lower() or "personal"
    normalized_permission_scope = permission_scope.strip().lower() or "private"
    if normalized_usage_type not in _KNOWLEDGE_USAGE_TYPES:
        raise HTTPException(status_code=422, detail="知识文件用途无效")
    if normalized_review_status not in _KNOWLEDGE_REVIEW_STATUSES:
        raise HTTPException(status_code=422, detail="知识文件审核状态无效")
    if normalized_rag_scope not in _KNOWLEDGE_RAG_SCOPES:
        raise HTTPException(status_code=422, detail="知识文件 RAG 作用域无效")
    if normalized_permission_scope not in _KNOWLEDGE_PERMISSION_SCOPES:
        raise HTTPException(status_code=422, detail="知识文件权限范围无效")

    is_admin = _is_admin_session(session_payload)
    source_type = "admin_upload" if is_admin and normalized_usage_type == "official_knowledge" else "user_upload"
    owner_user_id = str(session_payload.user.id)
    if not is_admin:
        unsafe_official_flags = (
            normalized_usage_type == "official_knowledge"
            or normalized_visibility == "PUBLIC"
            or rag_enabled
            or normalized_review_status in {"approved", "official", "deprecated"}
            or normalized_rag_scope not in {"session", "personal", "none"}
            or normalized_permission_scope != "private"
        )
        if unsafe_official_flags:
            raise HTTPException(
                status_code=403,
                detail="普通用户不能直接上传正式知识库文档或启用公司级 RAG",
            )
        if normalized_usage_type == "session_attachment":
            if not conversation_id.strip():
                raise HTTPException(status_code=422, detail="当前会话附件必须提供会话 ID")
            normalized_rag_scope = "session"
            category = category if category.strip() else "当前附件"
        else:
            normalized_usage_type = "personal_reference"
            normalized_rag_scope = "personal"
            category = category if category.strip() else "个人素材"
        normalized_visibility = "PRIVATE"
        rag_enabled = False
        reference_enabled = True
        normalized_permission_scope = "private"
        if normalized_review_status not in {"draft", "pending"}:
            normalized_review_status = "draft"
    elif normalized_usage_type == "official_knowledge":
        normalized_visibility = "PUBLIC"
        normalized_review_status = "official"
        normalized_rag_scope = normalized_rag_scope if normalized_rag_scope != "personal" else "company"
        normalized_permission_scope = (
            normalized_permission_scope
            if normalized_permission_scope != "private"
            else "company"
        )
        rag_enabled = True
        reference_enabled = True

    try:
        content = await file.read(MAX_KNOWLEDGE_FILE_BYTES + 1)
        if len(content) > MAX_KNOWLEDGE_FILE_BYTES:
            raise HTTPException(status_code=413, detail="知识文件不能超过 100MB")
        file_record, _chunks = create_knowledge_file_from_bytes(
            db,
            sso_user_id=str(session_payload.user.id),
            file_name=file.filename or "",
            content=content,
            content_type=file.content_type or "application/octet-stream",
            cipher=cipher,
            key_version=current_settings.content_encryption_key_version,
            visibility=normalized_visibility,
            source_type=source_type,
            usage_type=normalized_usage_type,
            review_status=normalized_review_status,
            rag_enabled=rag_enabled,
            reference_enabled=reference_enabled,
            rag_scope=normalized_rag_scope,
            permission_scope=normalized_permission_scope,
            owner_user_id=owner_user_id,
            conversation_id=conversation_id.strip(),
            category=(category.strip() or "其他")[:64],
            document_type=(document_type.strip() or "其他")[:64],
            tags=_split_tags(tags),
            uploaded_by=str(session_payload.user.id),
            storage_root=current_settings.knowledge_storage_dir,
            embedding_service=build_embedding_service(db, current_settings),
        )
        write_request_audit(
            db,
            session_payload,
            request,
            current_settings,
            action="knowledge_file.upload",
            entity_type="knowledge_file",
            entity_uuid=file_record.uuid,
            metadata={
                "file_uuid": file_record.uuid,
                "file_name": file_record.file_name,
                "visibility": file_record.visibility,
                "usage_type": file_record.usage_type,
                "review_status": file_record.review_status,
                "rag_enabled": file_record.rag_enabled,
            },
        )
        db.commit()
        db.refresh(file_record)
    except Exception:
        db.rollback()
        raise
    return _knowledge_file_out(db, file_record)


@app.get("/api/ai/knowledge/files", response_model=KnowledgeFileListOut)
async def list_knowledge_files(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeFileListOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    rows = list(db.scalars(
        select(KnowledgeFile)
        .where(
            KnowledgeFile.sso_user_id == str(session_payload.user.id),
            KnowledgeFile.status != "DELETED",
        )
        .order_by(KnowledgeFile.created_at.desc(), KnowledgeFile.id.desc())
    ))
    items = [_knowledge_file_out(db, row) for row in rows]
    return KnowledgeFileListOut(items=items, total=len(items))


@app.delete("/api/ai/knowledge/files/{file_uuid}", status_code=204)
async def delete_knowledge_file(
    file_uuid: str,
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
    file_record = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_uuid,
            KnowledgeFile.sso_user_id == str(session_payload.user.id),
            KnowledgeFile.status != "DELETED",
        )
    )
    if file_record is None:
        raise HTTPException(status_code=404, detail="知识文件不存在或无权访问")
    file_record.status = "DELETED"
    for chunk in db.scalars(
        select(KnowledgeChunk).where(KnowledgeChunk.file_id == file_record.id)
    ):
        chunk.status = "DELETED"
    write_request_audit(
        db,
        session_payload,
        request,
        current_settings,
        action="knowledge_file.delete",
        entity_type="knowledge_file",
        entity_uuid=file_record.uuid,
        metadata={"file_uuid": file_record.uuid},
    )
    db.commit()
    invalidate_knowledge_search(file_uuid=file_record.uuid, remove_vector_points=True)
    return Response(status_code=204)


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
            "risk_confirmation": False,
        },
    )
    db.commit()
    return PrepareGenerationOut(**prepared.__dict__)


@app.post(
    "/api/ai/agent-loop/quality-check",
    response_model=LoopQualityCheckOut,
)
async def agent_loop_quality_check(
    body: LoopQualityCheckIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
) -> LoopQualityCheckOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    checker = QualityChecker()
    result = checker.check(
        answer=body.answer,
        mode=body.mode,
        used_knowledge=body.used_knowledge,
    )
    retry_allowed = (not result.passed) and body.retry_count < checker.max_retry
    return LoopQualityCheckOut(
        passed=result.passed,
        issues=result.issues,
        retry_allowed=retry_allowed,
        revision_messages=(
            checker.revision_messages(
                messages=body.messages,
                answer=body.answer,
                issues=result.issues,
                retry_count=body.retry_count,
            )
            if retry_allowed
            else []
        ),
    )


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
        template = get_document_template(
            str(payload.get("document_template_code") or "")
        )
        document = template.render_docx(
            DocumentRenderPayload(
                title=str(payload["task_name"]),
                task_name=str(payload["task_name"]),
                department=str(payload["department"]),
                author=str(payload["author"]),
                output=str(payload["output"]),
                version=str(payload["version"]),
                inputs=dict(payload.get("input") or {}),
            )
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
    prepared, child = await prepare_generation(
        db,
        session_payload,
        PrepareGenerationIn(
            task_uuid=task.uuid,
            inputs=inputs,
        ),
        prompt_client,
        cipher,
        current_settings.content_encryption_key_version,
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

app.include_router(chat_router)
app.include_router(conversations_router)
app.include_router(export_router)
app.include_router(knowledge_router)
app.include_router(learning_router)
app.include_router(personal_reference_router)
app.include_router(model_profile_router)
app.include_router(skill_router)
app.include_router(web_router)
app.include_router(work_artifact_router)
app.include_router(professional_delivery_router)
app.include_router(professional_comment_router)
app.include_router(professional_review_issue_router)
app.include_router(professional_export_router)
app.include_router(professional_deliverable_fact_router)
app.include_router(professional_fact_router)
app.include_router(professional_evidence_router)
app.include_router(professional_skill_catalog_router)
app.include_router(professional_template_catalog_router)
app.include_router(professional_approval_flow_catalog_router)
app.include_router(professional_deliverable_run_router)
app.include_router(long_task_router)
app.include_router(agent_run_router)
app.include_router(professional_run_router)
app.include_router(artifact_router)
app.include_router(ops_router)
app.include_router(learning_candidate_router)
app.include_router(channel_router)
app.include_router(channel_webhook_router)
app.include_router(template_router)
app.include_router(knowledge_version_router)
app.include_router(learning_eval_router)
app.include_router(agent_hub_router)
app.include_router(role_assistant_router)
app.include_router(channel_job_router)
app.include_router(data_egress_router)
app.include_router(enterprise_intelligence_router)
app.include_router(workflow_router)
app.include_router(wechat_external_router)
app.include_router(project_router)
app.include_router(project_initialization_router)
app.include_router(project_context_router)
app.include_router(project_task_router)

if settings.web_spa_enabled:
    mount_static_web(app, static_dir=settings.web_static_dir, enabled=True)
else:

    @app.get("/{full_path:path}")
    async def proxy_spa(
        full_path: str,
        request: Request,
        current_settings: Annotated[Settings, Depends(get_settings)],
    ):
        """Dev mode: proxy SPA requests to Vite dev server."""
        if not current_settings.auth_dev_bypass:
            raise HTTPException(404)

        vite_url = f"http://localhost:18093/{full_path}"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                upstream = await client.get(
                    vite_url,
                    headers={
                        k: v
                        for k, v in request.headers.items()
                        if k.lower() not in ("host",)
                    },
                )
            return Response(
                content=upstream.content,
                status_code=upstream.status_code,
                headers=dict(upstream.headers),
            )
        except httpx.HTTPError:
            return Response(content="Dev proxy unavailable", status_code=502)
