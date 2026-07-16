"""User-facing Run APIs for 6.0 task base."""

from __future__ import annotations

import asyncio
import json
from typing import Annotated, Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from .admin.route_common import write_request_audit
from .agent_contracts import AgentEventContract, AgentRunContract, AgentStepContract
from .agent_run_service import AgentRunService
from .agent_runtime.langgraph_runtime import select_runtime
from .agent_runtime.protocol import ResumeCommand, RunRequest
from .auth import get_session, require_action
from .config import Settings, get_settings
from .crypto import ContentCipher
from .database import get_db
from .schemas import SessionPayload

router = APIRouter(prefix="/api/ai/runs", tags=["agent-runs"])


class CreateRunIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_text: str = Field(min_length=1, max_length=20_000)
    conversation_id: str = Field(default="", max_length=64)
    message_id: str = Field(default="", max_length=64)
    run_type: str = Field(default="chat", max_length=48)
    title: str = Field(default="AI 任务", max_length=255)
    max_steps: int = Field(default=32, ge=1, le=200)
    max_model_calls: int = Field(default=20, ge=0, le=200)
    max_cost_micros: int = Field(default=0, ge=0)
    max_step_tool_calls: int = Field(default=0, ge=0, le=1000)
    max_step_tokens: int = Field(default=0, ge=0, le=2_000_000)
    max_step_latency_ms: int = Field(default=0, ge=0, le=3_600_000)


class CreateRunOut(BaseModel):
    run: AgentRunContract
    snapshot: dict[str, Any]


class RunDetailOut(BaseModel):
    run: AgentRunContract
    steps: list[AgentStepContract] = Field(default_factory=list)
    events: list[AgentEventContract] = Field(default_factory=list)
    result: dict[str, Any] = Field(default_factory=dict)
    professional: dict[str, Any] | None = None


class FeedbackIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    feedback_type: str = Field(min_length=1, max_length=32)
    comment: str = Field(default="", max_length=4000)


class WorkflowConfirmIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Optional so existing approval steps without a token remain compatible;
    # tokenized workflow approval nodes validate it in WorkflowRunService.
    approval_token: str = Field(default="", max_length=512)


async def _require_use(
    request: Request,
    session_payload: SessionPayload,
    settings: Settings,
) -> None:
    await require_action("ai_assistant:use", request, session_payload, settings)


def _service(db: Session, settings: Settings) -> AgentRunService:
    return AgentRunService(
        db,
        ContentCipher(settings.content_encryption_key),
        key_version=settings.content_encryption_key_version,
    )


def _runtime(db: Session, settings: Settings):
    return select_runtime(
        db,
        ContentCipher(settings.content_encryption_key),
        settings=settings,
        key_version=settings.content_encryption_key_version,
    )


@router.post("", response_model=CreateRunOut, status_code=202)
async def create_run(
    body: CreateRunIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> CreateRunOut:
    await _require_use(request, session_payload, settings)
    service = _service(db, settings)
    runtime = _runtime(db, settings)
    owner_id = str(session_payload.user.id)
    row = service.create_run(
        owner_user_id=owner_id,
        input_text=body.input_text,
        conversation_id=body.conversation_id,
        message_id=body.message_id,
        run_type=body.run_type,
        title=body.title,
        max_steps=body.max_steps,
        max_model_calls=body.max_model_calls,
        max_cost_micros=body.max_cost_micros,
        max_step_tool_calls=body.max_step_tool_calls,
        max_step_tokens=body.max_step_tokens,
        max_step_latency_ms=body.max_step_latency_ms,
    )
    snapshot = await runtime.start(
        RunRequest(
            run_id=row.uuid,
            owner_user_id=owner_id,
            input_text=body.input_text,
            conversation_id=body.conversation_id,
            message_id=body.message_id,
            run_type=body.run_type,
        )
    )
    db.commit()
    db.refresh(row)
    return CreateRunOut(run=service.to_public_run(row), snapshot=snapshot.model_dump())


class RunListOut(BaseModel):
    items: list[AgentRunContract]
    total: int


@router.get("", response_model=RunListOut)
async def list_runs(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    status: Annotated[str, Query()] = "",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> RunListOut:
    """任务中心：当前用户的 Run 列表（产品语言=任务）。"""
    await _require_use(request, session_payload, settings)
    service = _service(db, settings)
    rows = service.list_owned(str(session_payload.user.id), limit=limit, status=status)
    items = [service.to_public_run(r) for r in rows]
    return RunListOut(items=items, total=len(items))


@router.get("/{run_id}", response_model=RunDetailOut)
async def get_run(
    run_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> RunDetailOut:
    await _require_use(request, session_payload, settings)
    service = _service(db, settings)
    row = service.get_owned_run(run_id, str(session_payload.user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if row.run_type == "professional_delivery":
        from .professional_delivery.runner_service import ProfessionalRunnerService
        from .professional_delivery.service import ProfessionalDeliveryError

        try:
            payload = ProfessionalRunnerService(
                db,
                ContentCipher(settings.content_encryption_key),
                key_version=settings.content_encryption_key_version,
            ).detail(
                run_uuid=run_id,
                owner_user_id=str(session_payload.user.id),
            )
        except ProfessionalDeliveryError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail={
                    **exc.details,
                    "code": exc.code,
                    "message": exc.message,
                },
            ) from exc
        return RunDetailOut.model_validate(payload)
    events = [service.to_public_event(e) for e in service.list_events(run_id)]
    steps = [service.to_public_step(s) for s in service.list_steps(run_id)]
    from .professional_delivery.runner_service import ProfessionalRunnerService

    professional = ProfessionalRunnerService(
        db,
        ContentCipher(settings.content_encryption_key),
        key_version=settings.content_encryption_key_version,
    ).detail_summary(
        run_uuid=run_id,
        owner_user_id=str(session_payload.user.id),
    )
    return RunDetailOut(
        run=service.to_public_run(row),
        steps=steps,
        events=events,
        result=row.result_json or {},
        professional=professional,
    )


@router.get("/{run_id}/events")
async def stream_run_events(
    run_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    after: Annotated[int, Query(ge=0)] = 0,
) -> StreamingResponse:
    await _require_use(request, session_payload, settings)
    service = _service(db, settings)
    row = service.get_owned_run(run_id, str(session_payload.user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="任务不存在")

    owner_user_id = str(session_payload.user.id)
    professional_service = None
    if row.run_type == "professional_delivery":
        from .professional_delivery.runner_service import ProfessionalRunnerService
        from .professional_delivery.service import ProfessionalDeliveryError

        professional_service = ProfessionalRunnerService(
            db,
            ContentCipher(settings.content_encryption_key),
            key_version=settings.content_encryption_key_version,
        )
        try:
            # The generic route is registered before the professional router to
            # keep ordinary task detail/events/cancel semantics stable. Validate
            # the professional binding here so the shared event endpoint cannot
            # bypass its ownership contract.
            professional_service.public_run(
                run_uuid=run_id,
                owner_user_id=owner_user_id,
            )
        except ProfessionalDeliveryError as exc:
            raise HTTPException(
                status_code=exc.status_code,
                detail={
                    **exc.details,
                    "code": exc.code,
                    "message": exc.message,
                },
            ) from exc

    async def event_generator() -> AsyncIterator[str]:
        cursor = after
        idle_rounds = 0
        while idle_rounds < 120:
            if await request.is_disconnected():
                break
            if professional_service is not None:
                batch_payloads = professional_service.event_payloads(
                    run_uuid=run_id,
                    owner_user_id=owner_user_id,
                    after_sequence=cursor,
                )
            else:
                batch_payloads = [
                    service.to_public_event(event).model_dump(mode="json")
                    for event in service.list_events(
                        run_id,
                        after_sequence=cursor,
                    )
                ]
            if batch_payloads:
                idle_rounds = 0
                for payload in batch_payloads:
                    cursor = int(payload["sequence"])
                    yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                    if payload["event_type"] in {"completed", "failed", "cancelled"}:
                        return
            else:
                idle_rounds += 1
                yield ": keepalive\n\n"
                await asyncio.sleep(0.5)
                # refresh row terminal state
                if professional_service is not None:
                    latest_status = professional_service.public_run(
                        run_uuid=run_id,
                        owner_user_id=owner_user_id,
                    )["status"]
                else:
                    latest = service.get_owned_run(run_id, owner_user_id)
                    latest_status = latest.status if latest else None
                if latest_status in {"succeeded", "completed", "failed", "cancelled"}:
                    # one more drain
                    if professional_service is not None:
                        trailing_payloads = professional_service.event_payloads(
                            run_uuid=run_id,
                            owner_user_id=owner_user_id,
                            after_sequence=cursor,
                        )
                    else:
                        trailing_payloads = [
                            service.to_public_event(event).model_dump(mode="json")
                            for event in service.list_events(
                                run_id,
                                after_sequence=cursor,
                            )
                        ]
                    for payload in trailing_payloads:
                        cursor = int(payload["sequence"])
                        yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
                    return

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/{run_id}/cancel", response_model=AgentRunContract)
async def cancel_run(
    run_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> AgentRunContract:
    await _require_use(request, session_payload, settings)
    service = _service(db, settings)
    runtime = _runtime(db, settings)
    row = service.get_owned_run(run_id, str(session_payload.user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    try:
        await runtime.cancel(run_id)
        if row.run_type == "professional_delivery":
            from .professional_delivery.runner_service import ProfessionalRunnerService
            from .professional_delivery import runner_routes as professional_runner_routes

            ProfessionalRunnerService(
                db,
                ContentCipher(settings.content_encryption_key),
                key_version=settings.content_encryption_key_version,
            ).cancel(
                run_uuid=run_id,
                owner_user_id=str(session_payload.user.id),
            )
            professional_runner_routes.write_request_audit(
                db,
                session_payload,
                request,
                settings,
                action="professional_run.cancel",
                entity_type="professional_run",
                entity_uuid=run_id,
                metadata={
                    "event": "professional_run_cancelled",
                    "status": "cancelled",
                },
            )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(row)
    return service.to_public_run(row)


@router.post("/{run_id}/retry", response_model=CreateRunOut)
async def retry_run(
    run_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> CreateRunOut:
    await _require_use(request, session_payload, settings)
    service = _service(db, settings)
    runtime = _runtime(db, settings)
    row = service.get_owned_run(run_id, str(session_payload.user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if row.run_type == "workflow":
        from .workflow_run_service import WorkflowRunService

        try:
            _result, row = WorkflowRunService(db, settings).retry(
                run_id, str(session_payload.user.id)
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        db.commit()
        db.refresh(row)
        return CreateRunOut(
            run=service.to_public_run(row),
            snapshot=WorkflowRunService.snapshot(row),
        )
    try:
        snapshot = await runtime.resume(run_id, ResumeCommand(action="retry"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    db.refresh(row)
    return CreateRunOut(run=service.to_public_run(row), snapshot=snapshot.model_dump())


@router.post("/{run_id}/confirm", response_model=AgentRunContract)
async def confirm_run(
    run_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    body: WorkflowConfirmIn | None = None,
) -> AgentRunContract:
    await _require_use(request, session_payload, settings)
    service = _service(db, settings)
    runtime = _runtime(db, settings)
    row = service.get_owned_run(run_id, str(session_payload.user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if row.run_type == "workflow":
        from .workflow_run_service import WorkflowRunService

        try:
            _result, row = WorkflowRunService(db, settings).confirm(
                run_id,
                str(session_payload.user.id),
                approval_token=body.approval_token if body else "",
            )
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        db.commit()
        db.refresh(row)
        return service.to_public_run(row)
    await runtime.resume(run_id, ResumeCommand(action="confirm"))
    db.commit()
    db.refresh(row)
    return service.to_public_run(row)


@router.post("/{run_id}/feedback", status_code=204)
async def feedback_run(
    run_id: str,
    body: FeedbackIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    await _require_use(request, session_payload, settings)
    service = _service(db, settings)
    row = service.get_owned_run(run_id, str(session_payload.user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    meta = dict(row.metadata_json or {})
    feedbacks = list(meta.get("feedback") or [])
    entry = {
        "type": body.feedback_type,
        "comment": body.comment,
        "user_id": str(session_payload.user.id),
    }
    feedbacks.append(entry)
    meta["feedback"] = feedbacks[-50:]
    row.metadata_json = meta
    db.add(row)
    # Controlled learning: corrections become draft candidates, never auto-publish
    if body.feedback_type in {"correction", "thumbs_down", "dislike"}:
        from .learning_candidate_service import LearningCandidateService

        LearningCandidateService(db).create(
            owner_user_id=str(session_payload.user.id),
            source_run_id=row.uuid,
            candidate_type="correction" if body.feedback_type == "correction" else "feedback",
            title=f"来自任务反馈：{(row.title or '')[:40]}",
            payload={
                "feedback": entry,
                "run_result_kind": (row.result_json or {}).get("kind"),
            },
            actor=str(session_payload.user.id),
        )
    db.commit()
