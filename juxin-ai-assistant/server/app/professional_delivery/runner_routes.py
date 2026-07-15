from __future__ import annotations

import asyncio
import json
import uuid as uuid_lib
from typing import Annotated, AsyncIterator

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..admin.route_common import write_request_audit
from ..auth import get_session, require_action
from ..config import Settings, get_settings
from ..crypto import ContentCipher
from ..database import get_db
from ..schemas import SessionPayload
from .runner_schemas import (
    ProfessionalModelResultIn,
    ProfessionalAgentRunSummaryOut,
    ProfessionalRunDetailOut,
    ProfessionalRunInputIn,
    ProfessionalRunOut,
    ProfessionalRunStartIn,
)
from .runner_service import ProfessionalRunnerService
from .service import ProfessionalDeliveryError


deliverable_run_router = APIRouter(
    prefix="/api/ai/deliverables",
    tags=["professional-deliverable-runs"],
)
professional_run_router = APIRouter(
    prefix="/api/ai/runs",
    tags=["professional-deliverable-runs"],
)


async def _require_ai_use(
    request: Request,
    session_payload: SessionPayload,
    settings: Settings,
) -> None:
    await require_action("ai_assistant:use", request, session_payload, settings)


def _service(db: Session, settings: Settings) -> ProfessionalRunnerService:
    return ProfessionalRunnerService(
        db,
        ContentCipher(settings.content_encryption_key),
        key_version=settings.content_encryption_key_version,
    )


def _idempotency_key(value: str | None) -> str:
    normalized = (value or "").strip()
    if not normalized:
        raise ProfessionalDeliveryError(
            "IDEMPOTENCY_KEY_REQUIRED",
            "写入专业任务必须提供 Idempotency-Key",
            400,
        )
    if len(normalized) > 128:
        raise ProfessionalDeliveryError(
            "IDEMPOTENCY_KEY_INVALID",
            "Idempotency-Key 长度不能超过 128 个字符",
            400,
        )
    return normalized


def _request_id(request: Request) -> str:
    supplied = request.headers.get("x-request-id", "").strip()
    return supplied[:128] if supplied else str(uuid_lib.uuid4())


def _http_error(error: ProfessionalDeliveryError) -> HTTPException:
    return HTTPException(
        status_code=error.status_code,
        detail={**error.details, "code": error.code, "message": error.message},
    )


@professional_run_router.get(
    "/{run_uuid}",
    response_model=ProfessionalRunDetailOut,
)
async def get_professional_run(
    run_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ProfessionalRunDetailOut:
    await _require_ai_use(request, session_payload, settings)
    try:
        payload = _service(db, settings).detail(
            run_uuid=run_uuid,
            owner_user_id=str(session_payload.user.id),
        )
        return ProfessionalRunDetailOut.model_validate(payload)
    except ProfessionalDeliveryError as error:
        raise _http_error(error) from error


@professional_run_router.get("/{run_uuid}/events")
async def stream_professional_run_events(
    run_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    after: Annotated[int, Query(ge=0)] = 0,
) -> StreamingResponse:
    await _require_ai_use(request, session_payload, settings)
    service = _service(db, settings)
    owner_user_id = str(session_payload.user.id)
    try:
        service.public_run(
            run_uuid=run_uuid,
            owner_user_id=owner_user_id,
        )
    except ProfessionalDeliveryError as error:
        raise _http_error(error) from error

    async def event_generator() -> AsyncIterator[str]:
        cursor = after
        idle_rounds = 0
        while idle_rounds < 120:
            if await request.is_disconnected():
                return
            batch = service.event_payloads(
                run_uuid=run_uuid,
                owner_user_id=owner_user_id,
                after_sequence=cursor,
            )
            if batch:
                idle_rounds = 0
                for event in batch:
                    cursor = int(event["sequence"])
                    yield f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
                    if event["event_type"] in {"completed", "failed", "cancelled"}:
                        return
                continue
            latest = service.public_run(
                run_uuid=run_uuid,
                owner_user_id=owner_user_id,
            )
            if latest["status"] in {"succeeded", "completed", "failed", "cancelled"}:
                return
            idle_rounds += 1
            yield ": keepalive\n\n"
            await asyncio.sleep(0.5)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@professional_run_router.post(
    "/{run_uuid}/cancel",
    response_model=ProfessionalAgentRunSummaryOut,
)
async def cancel_professional_run(
    run_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ProfessionalAgentRunSummaryOut:
    await _require_ai_use(request, session_payload, settings)
    service = _service(db, settings)
    owner_user_id = str(session_payload.user.id)
    try:
        service.cancel(run_uuid=run_uuid, owner_user_id=owner_user_id)
        write_request_audit(
            db,
            session_payload,
            request,
            settings,
            action="professional_run.cancel",
            entity_type="professional_run",
            entity_uuid=run_uuid,
            metadata={
                "event": "professional_run_cancelled",
                "status": "cancelled",
            },
        )
        db.commit()
        payload = service.public_run(
            run_uuid=run_uuid,
            owner_user_id=owner_user_id,
        )
        return ProfessionalAgentRunSummaryOut.model_validate(payload)
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@deliverable_run_router.post(
    "/{deliverable_uuid}/runs",
    response_model=ProfessionalRunOut,
    status_code=202,
)
async def start_professional_run(
    deliverable_uuid: str,
    body: ProfessionalRunStartIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> ProfessionalRunOut:
    await _require_ai_use(request, session_payload, settings)
    try:
        payload = _service(db, settings).start(
            deliverable_uuid=deliverable_uuid,
            body=body,
            owner_user_id=str(session_payload.user.id),
            idempotency_key=_idempotency_key(idempotency_key_header),
        )
        if not payload["replayed"]:
            write_request_audit(
                db,
                session_payload,
                request,
                settings,
                action="professional_run.start",
                entity_type="professional_run",
                entity_uuid=payload["run_uuid"],
                metadata={
                    "event": "professional_run_started",
                    "status": payload["status"],
                },
            )
        db.commit()
        return ProfessionalRunOut.model_validate(payload)
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@professional_run_router.post(
    "/{run_uuid}/input",
    response_model=ProfessionalRunOut,
    status_code=202,
)
async def supply_professional_run_input(
    run_uuid: str,
    body: ProfessionalRunInputIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> ProfessionalRunOut:
    await _require_ai_use(request, session_payload, settings)
    try:
        payload = _service(db, settings).supply_input(
            run_uuid=run_uuid,
            body=body,
            owner_user_id=str(session_payload.user.id),
            idempotency_key=_idempotency_key(idempotency_key_header),
        )
        if not payload["replayed"]:
            write_request_audit(
                db,
                session_payload,
                request,
                settings,
                action="professional_run.input",
                entity_type="professional_run",
                entity_uuid=payload["run_uuid"],
                metadata={
                    "event": "professional_run_input_supplied",
                    "status": payload["status"],
                },
            )
        db.commit()
        return ProfessionalRunOut.model_validate(payload)
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@professional_run_router.post(
    "/{run_uuid}/resume",
    response_model=ProfessionalRunOut,
    status_code=202,
)
async def resume_professional_run(
    run_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> ProfessionalRunOut:
    await _require_ai_use(request, session_payload, settings)
    try:
        payload = _service(db, settings).resume(
            run_uuid=run_uuid,
            owner_user_id=str(session_payload.user.id),
            idempotency_key=_idempotency_key(idempotency_key_header),
        )
        if not payload["replayed"]:
            write_request_audit(
                db,
                session_payload,
                request,
                settings,
                action="professional_run.resume",
                entity_type="professional_run",
                entity_uuid=payload["run_uuid"],
                metadata={
                    "event": "professional_run_resumed",
                    "status": payload["status"],
                },
            )
        db.commit()
        return ProfessionalRunOut.model_validate(payload)
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@professional_run_router.post(
    "/{run_uuid}/steps/{step_uuid}/model-result",
    response_model=ProfessionalRunOut,
)
async def accept_professional_model_result(
    run_uuid: str,
    step_uuid: str,
    body: ProfessionalModelResultIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ProfessionalRunOut:
    await _require_ai_use(request, session_payload, settings)
    request_id = _request_id(request)
    try:
        payload = _service(db, settings).accept_model_result(
            run_uuid=run_uuid,
            step_uuid=step_uuid,
            body=body,
            owner_user_id=str(session_payload.user.id),
            request_id=request_id,
        )
        write_request_audit(
            db,
            session_payload,
            request,
            settings,
            action="professional_run.model_result",
            entity_type="professional_run",
            entity_uuid=payload["run_uuid"],
            metadata={
                "event": "professional_model_result_accepted",
                "status": payload["status"],
            },
        )
        created_version = payload.get("created_version")
        if isinstance(created_version, dict) and created_version.get("version_uuid"):
            write_request_audit(
                db,
                session_payload,
                request,
                settings,
                action="professional_deliverable.version.create",
                entity_type="professional_deliverable_version",
                entity_uuid=str(created_version["version_uuid"]),
                metadata={
                    "event": "deliverable_version_created",
                    "status": payload["status"],
                },
            )
        quality_review = payload.get("quality_review")
        if isinstance(quality_review, dict) and quality_review.get("review_uuid"):
            write_request_audit(
                db,
                session_payload,
                request,
                settings,
                action="professional_deliverable.review.create",
                entity_type="professional_deliverable",
                entity_uuid=str(payload["deliverable_uuid"]),
                metadata={
                    "event": "deliverable_review_completed",
                    "status": quality_review.get("status"),
                    "record_count": len(quality_review.get("issues") or []),
                },
            )
        db.commit()
        return ProfessionalRunOut.model_validate(payload)
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise
