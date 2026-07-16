"""APIs for agent routing + low-code workflow runner."""

from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import json
from typing import Annotated, Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from sqlalchemy import select

from .agent_audit_service import record_agent_call
from .agent_router import route_agents, route_result_to_dict
from .agent_run_service import AgentRunService
from .agent_contracts import AgentRunStatus
from .auth import get_session, require_action
from .config import Settings, get_settings
from .crypto import ContentCipher
from .database import get_db
from .schemas import SessionPayload
from .workflow_engine import (
    WorkflowEngine,
    delete_versioned_workflow,
    delete_custom_workflow,
    get_owned_versioned_workflow,
    get_workflow_definition,
    list_versioned_workflows,
    list_workflow_definitions,
    publish_versioned_workflow,
    rollback_versioned_workflow,
    save_versioned_workflow,
    save_custom_workflow,
)
from .workflow_static import validate_workflow_definition
from .workflow_run_service import WorkflowRunService
from .workflow_event_security import (
    CREDENTIAL_HEADER,
    LEGACY_CREDENTIAL_ID,
    OWNER_HEADER,
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
    WorkflowEventCredential,
    WorkflowEventSignatureError,
    resolve_workflow_event_credential,
    verify_workflow_event_signature,
    workflow_event_project_id,
)
from .models import (
    AgentRun,
    WorkflowNotificationOutbox,
    WorkflowSchedule,
    WorkflowTriggerInbox,
    WorkflowWait,
)
from .project_workspace_models import Project
from .workflow_control import (
    ack_notification,
    claim_trigger_event,
    claim_due_schedules,
    claim_notifications,
    create_schedule,
    enqueue_trigger_event,
    fail_notification,
    mark_trigger_processed,
    next_schedule_fire_at,
    release_schedule_claim,
    resume_wait,
    set_schedule_enabled,
    update_schedule,
    resolve_notification_reconciliation,
)

router = APIRouter(prefix="/api/ai/workflows", tags=["workflows"])


class RouteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_text: str = Field(min_length=1, max_length=20_000)
    preferred_agent_id: str = Field(default="", max_length=96)
    required_capabilities: list[str] = Field(default_factory=list)
    max_cost_micros: int | None = Field(default=None, ge=0)
    max_latency_ms: float | None = Field(default=None, ge=0)
    allow_external: bool = True
    # when true, create a lightweight AgentRun with routing in result/metadata
    create_run_audit: bool = True


class WorkflowRunIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_text: str = Field(min_length=1, max_length=20_000)
    preferred_agent_id: str = Field(default="", max_length=96)
    context: dict[str, Any] = Field(default_factory=dict)
    egress_confirmed: bool = False
    create_run_audit: bool = True


class WorkflowStepIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=48)
    type: str = Field(min_length=1, max_length=32)
    params: dict[str, Any] = Field(default_factory=dict)


class WorkflowSaveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=2, max_length=48)
    name: str = Field(default="", max_length=128)
    description: str = Field(default="", max_length=500)
    steps: list[WorkflowStepIn] = Field(min_length=1, max_length=30)


def _owned_project_ids(db: Session, user_id: str) -> set[str]:
    """Return only project UUIDs the current user owns for static checking."""
    return {
        str(value)
        for value in db.scalars(select(Project.uuid).where(Project.owner_user_id == user_id)).all()
        if value
    }


def _workflow_payload(body: WorkflowSaveIn) -> dict[str, Any]:
    return {
        "id": body.id,
        "name": body.name,
        "description": body.description,
        "steps": [s.model_dump() for s in body.steps],
    }


class WorkflowRollbackIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: int = Field(ge=1)


class WorkflowScheduleIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_id: str = Field(min_length=2, max_length=48)
    name: str = Field(min_length=1, max_length=128)
    cron_expression: str = Field(min_length=1, max_length=128)
    timezone: str = Field(default="UTC", max_length=64)
    next_fire_at: datetime | None = None
    misfire_policy: str = Field(default="skip", max_length=24)
    catch_up: bool = False
    concurrency_policy: str = Field(default="forbid", max_length=24)
    idempotency_prefix: str = Field(default="", max_length=128)
    metadata: dict[str, Any] = Field(default_factory=dict)


class WorkflowScheduleClaimIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    worker_id: str = Field(min_length=1, max_length=128)
    limit: int = Field(default=50, ge=1, le=100)
    lease_ttl_seconds: int = Field(default=30, ge=5, le=300)


class WorkflowSchedulePatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=128)
    cron_expression: str | None = Field(default=None, min_length=1, max_length=128)
    timezone: str | None = Field(default=None, max_length=64)
    next_fire_at: datetime | None = None
    misfire_policy: str | None = Field(default=None, max_length=24)
    catch_up: bool | None = None
    concurrency_policy: str | None = Field(default=None, max_length=24)
    idempotency_prefix: str | None = Field(default=None, max_length=128)
    metadata: dict[str, Any] | None = None


class WorkflowScheduleDispatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    worker_id: str = Field(default="", max_length=128)
    # Optional for backwards compatibility with pre-fencing workers.  New
    # workers should echo the token returned by /schedules/claim.
    lease_token: int | None = Field(default=None, ge=0)


class WorkflowTriggerIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_id: str = Field(min_length=2, max_length=48)
    event_type: str = Field(min_length=1, max_length=96)
    event_key: str = Field(min_length=1, max_length=128)
    # Optional explicit scope for external adapters.  It is included in the
    # signed body and persisted with the Inbox payload when present.
    project_id: str | None = Field(default=None, min_length=1, max_length=128)
    payload: dict[str, Any] = Field(default_factory=dict)


def _trigger_payload(body: WorkflowTriggerIn) -> dict[str, Any]:
    payload = dict(body.payload)
    if body.project_id:
        payload.setdefault("project_id", body.project_id)
    return payload


class WorkflowNotificationClaimIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    worker_id: str = Field(min_length=1, max_length=128)
    limit: int = Field(default=50, ge=1, le=100)
    lease_token: int | None = Field(default=None, ge=0)


class WorkflowNotificationFailIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    worker_id: str = Field(min_length=1, max_length=128)
    lease_token: int | None = Field(default=None, ge=0)
    error: str = Field(default="notification_failed", max_length=500)
    max_attempts: int = Field(default=3, ge=1, le=10)


class WorkflowNotificationResolveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outcome: str = Field(min_length=1, max_length=24)
    provider_metadata: dict[str, Any] = Field(default_factory=dict)
    error: str = Field(default="", max_length=500)


class WorkflowWaitResumeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    payload: dict[str, Any] = Field(default_factory=dict)
    # Optional for rollout compatibility; newly issued waits return this
    # one-time token and clients should always send it.
    resume_token: str = Field(default="", max_length=512)


def _cipher(settings: Settings) -> ContentCipher:
    return ContentCipher(settings.content_encryption_key)


def _manual_run_fingerprint(body: WorkflowRunIn) -> str:
    """Return a stable request fingerprint for Idempotency-Key replay checks."""

    payload = {
        "workflow_input": body.input_text,
        "preferred_agent_id": body.preferred_agent_id,
        "context": body.context,
        "egress_confirmed": bool(body.egress_confirmed),
        "create_run_audit": bool(body.create_run_audit),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _manual_idempotency_key(request: Request) -> str:
    """Read an optional manual-run key while keeping legacy callers working."""

    key = request.headers.get("Idempotency-Key", "").strip()
    if len(key) > 128:
        raise HTTPException(status_code=400, detail="Idempotency-Key 不能超过 128 个字符")
    return key


def _schedule_payload(row: WorkflowSchedule) -> dict[str, Any]:
    return {
        "schedule_uuid": row.uuid,
        "owner_user_id": row.owner_user_id,
        "workflow_id": row.workflow_id,
        "name": row.name,
        "cron_expression": row.cron_expression,
        "timezone": row.timezone,
        "enabled": bool(row.enabled),
        "next_fire_at": row.next_fire_at.isoformat() if row.next_fire_at else None,
        "last_fire_at": row.last_fire_at.isoformat() if row.last_fire_at else None,
        "lease_owner": row.lease_owner,
        "lease_token": int(row.lease_token or 0),
        "misfire_policy": row.misfire_policy,
        "catch_up": bool(row.catch_up),
        "concurrency_policy": row.concurrency_policy,
        "idempotency_prefix": row.idempotency_prefix,
        "metadata": row.metadata_json if isinstance(row.metadata_json, dict) else {},
    }


def _notification_payload(row: WorkflowNotificationOutbox) -> dict[str, Any]:
    return {
        "notification_uuid": row.uuid,
        "run_id": row.run_id,
        "node_id": row.node_id,
        "channel": row.channel,
        "recipient": row.recipient,
        "payload": row.payload_json if isinstance(row.payload_json, dict) else {},
        "status": row.status,
        "attempts": int(row.attempts or 0),
        "lease_owner": row.lease_owner,
        "lease_token": int(row.lease_token or 0),
        "last_error": row.last_error,
    }


def _wait_payload(row: WorkflowWait) -> dict[str, Any]:
    return {
        "wait_uuid": row.uuid,
        "run_id": row.run_id,
        "node_id": row.node_id,
        "wait_key": row.wait_key,
        "signal_key": row.signal_key,
        "status": row.status,
        "resume_at": row.resume_at.isoformat() if row.resume_at else None,
        "resume_expires_at": row.resume_expires_at.isoformat() if row.resume_expires_at else None,
        "resume_token": str(getattr(row, "_resume_token_plain", "") or ""),
        "payload": row.payload_json if isinstance(row.payload_json, dict) else {},
        "resumed_by": row.resumed_by,
    }


def _persist_routing_run(
    db: Session,
    settings: Settings,
    *,
    owner_user_id: str,
    input_text: str,
    route_data: dict[str, Any],
    workflow_id: str = "",
) -> str:
    """Create AgentRun storing routing decision for task-center / audit."""
    service = AgentRunService(db, _cipher(settings), key_version=settings.content_encryption_key_version)
    title = "智能路由" if not workflow_id else f"工作流 · {workflow_id}"
    row = service.create_run(
        owner_user_id=owner_user_id,
        input_text=input_text,
        run_type="workflow" if workflow_id else "routing",
        title=title[:255],
        metadata={
            "source": "workflow_route" if not workflow_id else "workflow_run",
            "workflow_id": workflow_id,
            "selected_agent_id": route_data.get("selected_agent_id"),
            "routing_reasons": route_data.get("routing_reasons") or [],
            "data_level": route_data.get("data_level"),
        },
    )
    service.mark_running(row)
    service.add_step(
        row,
        step_type="agent_route",
        status="succeeded",
        role="router",
        output_summary={
            "summary": f"路由选中 {route_data.get('selected_agent_id') or '无'}",
            "selected_agent_id": route_data.get("selected_agent_id"),
            "candidates": (route_data.get("candidates") or [])[:5],
        },
    )
    service.mark_succeeded(
        row,
        result={
            "kind": "agent_route" if not workflow_id else "workflow",
            "workflow_id": workflow_id,
            "routing": route_data,
            "selected_agent_id": route_data.get("selected_agent_id"),
            "answer": (
                f"已路由至 {route_data.get('selected_agent_id') or '（无可用 Agent）'}。"
                f" 原因：{';；'.join(route_data.get('routing_reasons') or [])}"
            ),
        },
    )
    record_agent_call(
        db,
        user_id=owner_user_id,
        agent_id=str(route_data.get("selected_agent_id") or "router"),
        status="succeeded",
        destination="router",
        run_id=row.uuid,
        data_level=int(route_data.get("data_level") or 0),
        request_summary=input_text[:200],
        result_summary=str(route_data.get("selected_agent_id") or ""),
        detail={"routing_reasons": route_data.get("routing_reasons"), "workflow_id": workflow_id},
        cost_micros=0,
        latency_ms=0,
    )
    db.flush()
    return row.uuid


@router.post("/route")
async def route_agent(
    body: RouteIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    result = route_agents(
        db,
        input_text=body.input_text,
        preferred_agent_id=body.preferred_agent_id,
        required_capabilities=body.required_capabilities or None,
        max_cost_micros=body.max_cost_micros,
        max_latency_ms=body.max_latency_ms,
        allow_external=body.allow_external,
    )
    data = route_result_to_dict(result)
    data["user_id"] = str(session.user.id)
    if body.create_run_audit:
        try:
            run_id = _persist_routing_run(
                db,
                settings,
                owner_user_id=str(session.user.id),
                input_text=body.input_text,
                route_data=data,
            )
            db.commit()
            data["agent_run_id"] = run_id
        except Exception as exc:
            db.rollback()
            data["agent_run_id"] = ""
            data["audit_error"] = str(exc)[:200]
    return data


@router.get("")
async def list_workflows(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    items = list_workflow_definitions(settings)
    items.extend(list_versioned_workflows(db, owner_user_id=str(session.user.id)))
    return {"items": items, "total": len(items)}


@router.post("/validate")
async def validate_workflow(
    body: WorkflowSaveIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Validate an unsaved workflow draft and return a deterministic preview."""
    await require_action("ai_assistant:use", request, session, settings)
    return validate_workflow_definition(
        _workflow_payload(body),
        allowed_project_ids=_owned_project_ids(db, str(session.user.id)),
        strict_project_scope=True,
    )


@router.post("/custom", status_code=201)
async def save_workflow(
    body: WorkflowSaveIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Save a draft version of a custom workflow."""
    await require_action("ai_assistant:use", request, session, settings)
    definition = _workflow_payload(body)
    static_result = validate_workflow_definition(
        definition,
        allowed_project_ids=_owned_project_ids(db, str(session.user.id)),
        strict_project_scope=True,
    )
    if not static_result["valid"]:
        raise HTTPException(status_code=400, detail=static_result)
    try:
        row = save_versioned_workflow(
            db,
            definition,
            owner_user_id=str(session.user.id),
            allowed_project_ids=_owned_project_ids(db, str(session.user.id)),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    db.commit()
    return row


@router.post("/custom/{workflow_id}/validate")
async def validate_saved_workflow(
    workflow_id: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    body: WorkflowSaveIn | None = None,
) -> dict[str, Any]:
    """Validate an owner's current draft; an optional body previews edits."""
    await require_action("ai_assistant:use", request, session, settings)
    definition = _workflow_payload(body) if body is not None else get_owned_versioned_workflow(
        db, workflow_id, owner_user_id=str(session.user.id)
    )
    if definition is None:
        raise HTTPException(status_code=404, detail="workflow_not_found")
    if body is not None and body.id != workflow_id:
        raise HTTPException(status_code=400, detail="workflow_id_mismatch")
    return validate_workflow_definition(
        definition,
        allowed_project_ids=_owned_project_ids(db, str(session.user.id)),
        strict_project_scope=True,
    )


@router.post("/custom/{workflow_id}/publish")
async def publish_workflow(
    workflow_id: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    allowed_project_ids = _owned_project_ids(db, str(session.user.id))
    draft = get_owned_versioned_workflow(
        db, workflow_id, owner_user_id=str(session.user.id)
    )
    if draft is None:
        raise HTTPException(status_code=404, detail="workflow_not_found")
    static_result = validate_workflow_definition(
        draft,
        allowed_project_ids=allowed_project_ids,
        strict_project_scope=True,
    )
    if not static_result["valid"]:
        raise HTTPException(status_code=409, detail=static_result)
    try:
        row = publish_versioned_workflow(
            db,
            workflow_id,
            owner_user_id=str(session.user.id),
            allowed_project_ids=allowed_project_ids,
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=404, detail="workflow_not_found")
    db.commit()
    return row


@router.post("/custom/{workflow_id}/rollback")
async def rollback_workflow(
    workflow_id: str,
    body: WorkflowRollbackIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    row = rollback_versioned_workflow(
        db, workflow_id, body.version, owner_user_id=str(session.user.id)
    )
    if row is None:
        raise HTTPException(status_code=404, detail="workflow_version_not_found")
    db.commit()
    return row


@router.delete("/custom/{workflow_id}", status_code=204)
async def remove_custom_workflow(
    workflow_id: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    await require_action("ai_assistant:use", request, session, settings)
    try:
        ok = delete_versioned_workflow(db, workflow_id, owner_user_id=str(session.user.id))
        if ok:
            db.commit()
        else:
            ok = delete_custom_workflow(workflow_id, settings)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(status_code=404, detail="workflow_not_found")


@router.post("/schedules", status_code=201)
async def create_workflow_schedule(
    body: WorkflowScheduleIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    try:
        row = create_schedule(
            db,
            owner_user_id=str(session.user.id),
            workflow_id=body.workflow_id,
            name=body.name,
            cron_expression=body.cron_expression,
            timezone=body.timezone,
            next_fire_at=body.next_fire_at,
            misfire_policy=body.misfire_policy,
            catch_up=body.catch_up,
            concurrency_policy=body.concurrency_policy,
            idempotency_prefix=body.idempotency_prefix,
            metadata=body.metadata,
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _schedule_payload(row)


@router.get("/schedules")
async def list_workflow_schedules(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    rows = list(db.scalars(select(WorkflowSchedule).where(
        WorkflowSchedule.owner_user_id == str(session.user.id),
    ).order_by(WorkflowSchedule.created_at.desc())))
    return {"items": [_schedule_payload(row) for row in rows], "total": len(rows)}


@router.patch("/schedules/{schedule_uuid}")
async def patch_workflow_schedule(
    schedule_uuid: str,
    body: WorkflowSchedulePatchIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Update an owned schedule while preserving its durable cursor/lease."""

    await require_action("ai_assistant:use", request, session, settings)
    try:
        row = update_schedule(
            db,
            schedule_uuid,
            owner_user_id=str(session.user.id),
            changes=body.model_dump(exclude_unset=True),
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=404, detail="schedule_not_found")
    db.commit()
    return _schedule_payload(row)


@router.post("/schedules/{schedule_uuid}/enable")
async def enable_workflow_schedule(
    schedule_uuid: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    try:
        row = set_schedule_enabled(
            db,
            schedule_uuid,
            owner_user_id=str(session.user.id),
            enabled=True,
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=404, detail="schedule_not_found")
    db.commit()
    return _schedule_payload(row)


@router.post("/schedules/{schedule_uuid}/disable")
async def disable_workflow_schedule(
    schedule_uuid: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    row = set_schedule_enabled(
        db,
        schedule_uuid,
        owner_user_id=str(session.user.id),
        enabled=False,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="schedule_not_found")
    db.commit()
    return _schedule_payload(row)


@router.post("/schedules/claim")
async def claim_workflow_schedules(
    body: WorkflowScheduleClaimIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    rows = claim_due_schedules(
        db,
        worker_id=body.worker_id,
        owner_user_id=str(session.user.id),
        limit=body.limit,
        lease_ttl_seconds=body.lease_ttl_seconds,
    )
    db.commit()
    return {"items": [_schedule_payload(row) for row in rows], "total": len(rows)}


@router.post("/schedules/{schedule_uuid}/dispatch")
async def dispatch_workflow_schedule(
    schedule_uuid: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    body: WorkflowScheduleDispatchIn | None = None,
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    row = db.scalar(select(WorkflowSchedule).where(
        WorkflowSchedule.uuid == schedule_uuid,
        WorkflowSchedule.owner_user_id == str(session.user.id),
    ))
    if row is None or not row.lease_owner:
        raise HTTPException(status_code=409, detail="schedule_not_claimed")
    worker_id = str((body.worker_id if body else "") or row.lease_owner)
    if worker_id != row.lease_owner:
        raise HTTPException(status_code=409, detail="schedule_lease_owner_mismatch")
    lease_token = body.lease_token if body else None
    if lease_token is not None and int(lease_token) != int(row.lease_token or 0):
        raise HTTPException(status_code=409, detail="schedule_lease_token_mismatch")
    now = datetime.now(UTC).replace(tzinfo=None)
    if row.lease_expires_at is not None and row.lease_expires_at <= now:
        raise HTTPException(status_code=409, detail="schedule_lease_expired")
    # The claimed fire time is the stable identity of this dispatch.  It must
    # be captured before advancing next_fire_at, otherwise a retry can create
    # a second run for the same scheduled occurrence.
    scheduled_fire_at = row.next_fire_at or now
    idempotency_key = f"{row.idempotency_prefix or f'schedule:{row.uuid}'}:{scheduled_fire_at.isoformat()}"
    next_fire_at = next_schedule_fire_at(
        row.cron_expression, row.timezone, after=scheduled_fire_at
    )
    runtime_service = WorkflowRunService(db, settings, worker_id=worker_id)
    existing = runtime_service.find_idempotent_run(
        db,
        owner_user_id=str(session.user.id),
        workflow_id=row.workflow_id,
        idempotency_key=idempotency_key,
    )
    if existing is not None:
        released = release_schedule_claim(
            db,
            row.uuid,
            worker_id=worker_id,
            lease_token=lease_token,
            fired_at=now,
            next_fire_at=next_fire_at,
        )
        if released is None:
            db.rollback()
            raise HTTPException(status_code=409, detail="schedule_lease_lost")
        db.commit()
        return {
            "schedule_uuid": row.uuid,
            "agent_run_id": existing.uuid,
            "status": existing.status,
            "idempotency_key": idempotency_key,
            "scheduled_fire_at": scheduled_fire_at.isoformat(),
            "replayed": True,
        }

    # Concurrency is evaluated against the same durable routing metadata used
    # for idempotency.  A bounded scan avoids coupling the control plane to a
    # vendor-specific JSON query while keeping the decision auditable.
    active_statuses = {
        AgentRunStatus.CREATED.value,
        AgentRunStatus.QUEUED.value,
        AgentRunStatus.RUNNING.value,
        AgentRunStatus.WAITING_CONFIRMATION.value,
        AgentRunStatus.PAUSED.value,
        AgentRunStatus.RETRYING.value,
    }
    active_rows: list[AgentRun] = []
    for candidate in db.scalars(
        select(AgentRun)
        .where(
            AgentRun.owner_user_id == str(session.user.id),
            AgentRun.run_type == "workflow",
            AgentRun.status.in_(active_statuses),
        )
        .order_by(AgentRun.created_at.desc())
        .limit(200)
    ):
        metadata_candidate = candidate.metadata_json if isinstance(candidate.metadata_json, dict) else {}
        runtime_candidate = metadata_candidate.get("workflow_runtime")
        routing_candidate = runtime_candidate.get("routing") if isinstance(runtime_candidate, dict) else {}
        if isinstance(routing_candidate, dict) and str(routing_candidate.get("schedule_uuid") or "") == row.uuid:
            active_rows.append(candidate)
    if active_rows and row.concurrency_policy == "forbid":
        released = release_schedule_claim(
            db,
            row.uuid,
            worker_id=worker_id,
            lease_token=lease_token,
            fired_at=now,
            next_fire_at=next_fire_at,
        )
        if released is None:
            db.rollback()
            raise HTTPException(status_code=409, detail="schedule_lease_lost")
        db.commit()
        return {
            "schedule_uuid": row.uuid,
            "agent_run_id": active_rows[0].uuid,
            "status": "skipped_concurrency",
            "idempotency_key": idempotency_key,
            "scheduled_fire_at": scheduled_fire_at.isoformat(),
            "replayed": False,
        }
    if active_rows and row.concurrency_policy == "replace":
        cancel_service = AgentRunService(
            db,
            _cipher(settings),
            key_version=settings.content_encryption_key_version,
        )
        for active in active_rows:
            cancel_service.request_cancel(active)

    metadata = row.metadata_json if isinstance(row.metadata_json, dict) else {}
    try:
        result, run = runtime_service.start_and_run(
            workflow_id=row.workflow_id,
            owner_user_id=str(session.user.id),
            input_text=str(metadata.get("input_text") or f"定时执行：{row.name}"),
            context=metadata.get("context") if isinstance(metadata.get("context"), dict) else {},
            routing_summary={
                "source": "schedule",
                "schedule_uuid": row.uuid,
                "scheduled_fire_at": scheduled_fire_at.isoformat(),
                "idempotency_key": idempotency_key,
                "concurrency_policy": row.concurrency_policy,
            },
        )
        released = release_schedule_claim(
            db,
            row.uuid,
            worker_id=worker_id,
            lease_token=lease_token,
            fired_at=now,
            next_fire_at=next_fire_at,
        )
        if released is None:
            raise RuntimeError("schedule_lease_lost")
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)[:200]) from exc
    return {
        "schedule_uuid": row.uuid,
        "agent_run_id": run.uuid,
        "status": result.status,
        "idempotency_key": idempotency_key,
        "scheduled_fire_at": scheduled_fire_at.isoformat(),
        "replayed": False,
    }


@router.post("/events", status_code=202)
async def enqueue_workflow_event(
    body: WorkflowTriggerIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    try:
        row, replayed = enqueue_trigger_event(
            db,
            owner_user_id=str(session.user.id),
            workflow_id=body.workflow_id,
            event_type=body.event_type,
            event_key=body.event_key,
            payload=_trigger_payload(body),
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"event_uuid": row.uuid, "status": row.status, "replayed": replayed}


def _verify_signed_workflow_event(
    body: WorkflowTriggerIn,
    request: Request,
    settings: Settings,
) -> str:
    """Verify the controlled adapter contract and return its owner scope."""

    mode = settings.workflow_event_signature_mode.strip().lower()
    if mode != "required":
        raise HTTPException(status_code=503, detail="workflow_event_signature_disabled")
    owner_user_id = request.headers.get(OWNER_HEADER, "").strip()
    credential_id = request.headers.get(CREDENTIAL_HEADER, "").strip()
    project_id = ""
    signed_body = body.model_dump(mode="json", exclude_none=True)
    try:
        try:
            project_id = workflow_event_project_id(signed_body)
        except WorkflowEventSignatureError as exc:
            raise HTTPException(
                status_code=401,
                detail=f"workflow_event_{exc.code}",
            ) from exc
        credentials_raw = settings.workflow_event_signature_credentials
        if credentials_raw.strip():
            credential = resolve_workflow_event_credential(
                credentials_raw,
                credential_id=credential_id,
                owner_user_id=owner_user_id,
                project_id=project_id,
            )
        elif settings.auth_dev_bypass and len(settings.workflow_event_signature_secret) >= 32:
            # Compatibility for existing local tests/adapters while the new
            # credential map is rolled out.  Production settings reject this
            # fallback in ``Settings.validate_production_secrets``.
            credential = WorkflowEventCredential(
                credential_id=LEGACY_CREDENTIAL_ID,
                secret=settings.workflow_event_signature_secret,
                owner_user_ids=frozenset({owner_user_id}),
                project_ids=frozenset(),
                legacy_dev_only=True,
            )
        else:
            raise WorkflowEventSignatureError("credentials_not_configured")
        verify_workflow_event_signature(
            signed_body,
            owner_user_id=owner_user_id,
            timestamp_header=request.headers.get(TIMESTAMP_HEADER),
            signature_header=request.headers.get(SIGNATURE_HEADER),
            secret=credential.secret,
            tolerance_seconds=settings.workflow_event_signature_tolerance_seconds,
        )
    except WorkflowEventSignatureError as exc:
        status_code = 503 if exc.code in {
            "signing_secret_not_configured",
            "credentials_not_configured",
            "credentials_config_invalid",
        } else 401
        raise HTTPException(
            status_code=status_code,
            detail=f"workflow_event_{exc.code}",
        ) from exc
    return owner_user_id


@router.post("/events/signed", status_code=202)
async def enqueue_signed_workflow_event(
    body: WorkflowTriggerIn,
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Accept an HMAC-authenticated event from a controlled adapter."""

    owner_user_id = _verify_signed_workflow_event(body, request, settings)
    try:
        row, replayed = enqueue_trigger_event(
            db,
            owner_user_id=owner_user_id,
            workflow_id=body.workflow_id,
            event_type=body.event_type,
            event_key=body.event_key,
            payload=_trigger_payload(body),
        )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "event_uuid": row.uuid,
        "status": row.status,
        "replayed": replayed,
        "signature_version": "v1",
    }


@router.post("/events/{event_uuid}/dispatch", status_code=202)
async def dispatch_workflow_event(
    event_uuid: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    event = db.scalar(select(WorkflowTriggerInbox).where(
        WorkflowTriggerInbox.uuid == event_uuid,
        WorkflowTriggerInbox.owner_user_id == str(session.user.id),
    ))
    if event is None:
        raise HTTPException(status_code=404, detail="event_not_found")
    if event.status == "processed":
        return {"event_uuid": event.uuid, "status": event.status, "agent_run_id": event.run_id}
    worker_id = f"event-dispatch-{uuid4().hex}"
    claimed = claim_trigger_event(
        db,
        event.uuid,
        owner_user_id=str(session.user.id),
        worker_id=worker_id,
    )
    if claimed is None:
        db.refresh(event)
        if event.status == "processed":
            return {"event_uuid": event.uuid, "status": event.status, "agent_run_id": event.run_id}
        raise HTTPException(status_code=409, detail="event_already_dispatching")
    event, lease_token = claimed
    payload = event.payload_json if isinstance(event.payload_json, dict) else {}
    try:
        runtime_service = WorkflowRunService(db, settings, worker_id=worker_id)
        idempotency_key = f"trigger:{event.uuid}"
        existing = runtime_service.find_idempotent_run(
            db,
            owner_user_id=str(session.user.id),
            workflow_id=event.workflow_id,
            idempotency_key=idempotency_key,
            source="trigger_inbox",
        )
        if existing is not None:
            result, run = runtime_service._existing_result(existing, event.workflow_id), existing
        else:
            result, run = runtime_service.start_and_run(
                workflow_id=event.workflow_id,
                owner_user_id=str(session.user.id),
                input_text=str(payload.get("input_text") or event.event_type),
                context=payload.get("context") if isinstance(payload.get("context"), dict) else payload,
                routing_summary={
                    "source": "trigger_inbox",
                    "event_uuid": event.uuid,
                    "idempotency_key": idempotency_key,
                },
            )
        from .enterprise_intelligence.insight_service import bind_recommendation_workflow_run

        bind_recommendation_workflow_run(db, payload, run.uuid)
        if mark_trigger_processed(
            db,
            event.uuid,
            run_id=run.uuid,
            worker_id=worker_id,
            lease_token=lease_token,
        ) is None:
            raise RuntimeError("event_lease_lost")
        db.commit()
    except Exception as exc:
        mark_trigger_processed(
            db,
            event.uuid,
            error=str(exc),
            worker_id=worker_id,
            lease_token=lease_token,
        )
        db.commit()
        raise HTTPException(status_code=409, detail=str(exc)[:200]) from exc
    return {"event_uuid": event.uuid, "status": result.status, "agent_run_id": run.uuid}


@router.post("/outbox/claim")
async def claim_workflow_notifications(
    body: WorkflowNotificationClaimIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    rows = claim_notifications(
        db,
        worker_id=body.worker_id,
        owner_user_id=str(session.user.id),
        limit=body.limit,
    )
    db.commit()
    return {"items": [_notification_payload(row) for row in rows], "total": len(rows)}


@router.post("/outbox/{notification_uuid}/ack")
async def acknowledge_workflow_notification(
    notification_uuid: str,
    body: WorkflowNotificationClaimIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    owned = db.scalar(select(WorkflowNotificationOutbox).where(
        WorkflowNotificationOutbox.uuid == notification_uuid,
        WorkflowNotificationOutbox.owner_user_id == str(session.user.id),
    ))
    if owned is None:
        raise HTTPException(status_code=404, detail="notification_not_found")
    ok = ack_notification(
        db,
        notification_uuid,
        worker_id=body.worker_id,
        lease_token=body.lease_token,
    )
    if not ok:
        raise HTTPException(status_code=409, detail="notification_not_claimed")
    db.commit()
    return {"notification_uuid": notification_uuid, "status": "sent"}


@router.post("/outbox/{notification_uuid}/fail")
async def fail_workflow_notification(
    notification_uuid: str,
    body: WorkflowNotificationFailIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    owned = db.scalar(select(WorkflowNotificationOutbox).where(
        WorkflowNotificationOutbox.uuid == notification_uuid,
        WorkflowNotificationOutbox.owner_user_id == str(session.user.id),
    ))
    if owned is None:
        raise HTTPException(status_code=404, detail="notification_not_found")
    ok = fail_notification(
        db,
        notification_uuid,
        worker_id=body.worker_id,
        lease_token=body.lease_token,
        error=body.error,
        max_attempts=body.max_attempts,
    )
    if not ok:
        raise HTTPException(status_code=409, detail="notification_not_claimed")
    db.commit()
    row = db.scalar(select(WorkflowNotificationOutbox).where(
        WorkflowNotificationOutbox.uuid == notification_uuid,
    ))
    return _notification_payload(row) if row else {"notification_uuid": notification_uuid}


@router.get("/outbox/reconciliation")
async def list_workflow_reconciliation(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """List only the current user's provider-unknown notification effects."""

    await require_action("ai_assistant:use", request, session, settings)
    rows = list(db.scalars(select(WorkflowNotificationOutbox).where(
        WorkflowNotificationOutbox.owner_user_id == str(session.user.id),
        WorkflowNotificationOutbox.status == "reconciliation_required",
    ).order_by(WorkflowNotificationOutbox.created_at.asc())))
    return {"items": [_notification_payload(row) for row in rows], "total": len(rows)}


@router.post("/outbox/{notification_uuid}/reconcile")
async def resolve_workflow_reconciliation(
    notification_uuid: str,
    body: WorkflowNotificationResolveIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    owned = db.scalar(select(WorkflowNotificationOutbox).where(
        WorkflowNotificationOutbox.uuid == notification_uuid,
        WorkflowNotificationOutbox.owner_user_id == str(session.user.id),
    ))
    if owned is None:
        raise HTTPException(status_code=404, detail="notification_not_found")
    try:
        ok = resolve_notification_reconciliation(
            db,
            notification_uuid,
            outcome=body.outcome,
            provider_metadata=body.provider_metadata,
            error=body.error,
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(status_code=409, detail="notification_not_reconciliation_required")
    db.commit()
    refreshed = db.scalar(select(WorkflowNotificationOutbox).where(
        WorkflowNotificationOutbox.uuid == notification_uuid,
    ))
    return _notification_payload(refreshed) if refreshed else {"notification_uuid": notification_uuid}


@router.get("/waits")
async def list_workflow_waits(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    rows = list(db.scalars(select(WorkflowWait).where(
        WorkflowWait.owner_user_id == str(session.user.id),
        WorkflowWait.status == "waiting",
    ).order_by(WorkflowWait.created_at.desc())))
    return {"items": [_wait_payload(row) for row in rows], "total": len(rows)}


@router.post("/waits/{wait_uuid}/resume")
async def resume_workflow_wait(
    wait_uuid: str,
    body: WorkflowWaitResumeIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    row = resume_wait(
        db,
        wait_uuid,
        owner_user_id=str(session.user.id),
        resumed_by=str(session.user.id),
        payload=body.payload,
        resume_token=body.resume_token,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="wait_not_found_or_already_resumed")
    try:
        result, run = WorkflowRunService(db, settings).resume_wait(
            row,
            owner_user_id=str(session.user.id),
            payload=body.payload,
        )
        db.commit()
    except (LookupError, ValueError) as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {
        **_wait_payload(row),
        "run": WorkflowRunService.snapshot(run),
        "status": result.status,
    }


@router.get("/{workflow_id}")
async def get_workflow(
    workflow_id: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    definition = get_owned_versioned_workflow(
        db, workflow_id, owner_user_id=str(session.user.id)
    ) or get_workflow_definition(workflow_id, settings)
    if definition is None:
        raise HTTPException(status_code=404, detail="workflow_not_found")
    return definition


@router.post("/{workflow_id}/run")
async def run_workflow(
    workflow_id: str,
    body: WorkflowRunIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    # pre-route for audit trail
    route_data = route_result_to_dict(
        route_agents(
            db,
            input_text=body.input_text,
            preferred_agent_id=body.preferred_agent_id,
        )
    )
    agent_run_id = ""
    replayed = False
    if body.create_run_audit:
        idempotency_key = _manual_idempotency_key(request)
        request_fingerprint = _manual_run_fingerprint(body) if idempotency_key else ""
        try:
            runtime_service = WorkflowRunService(db, settings)
            existing = (
                runtime_service.find_idempotent_run(
                    db,
                    owner_user_id=str(session.user.id),
                    workflow_id=workflow_id,
                    idempotency_key=idempotency_key,
                    source="manual",
                )
                if idempotency_key
                else None
            )
            if existing is not None:
                runtime = existing.metadata_json.get("workflow_runtime") if isinstance(existing.metadata_json, dict) else {}
                routing = runtime.get("routing") if isinstance(runtime, dict) else {}
                if (
                    isinstance(routing, dict)
                    and routing.get("request_fingerprint")
                    and str(routing.get("request_fingerprint")) != request_fingerprint
                ):
                    raise HTTPException(
                        status_code=409,
                        detail="idempotency_key_reused_with_different_request",
                    )
                result = runtime_service._existing_result(existing, workflow_id)
                row = existing
                replayed = True
            else:
                result, row = runtime_service.start_and_run(
                    workflow_id=workflow_id,
                    owner_user_id=str(session.user.id),
                    input_text=body.input_text,
                    context={**body.context, "user_id": str(session.user.id)},
                    preferred_agent_id=body.preferred_agent_id,
                    egress_confirmed=body.egress_confirmed,
                    routing_summary={
                        **route_data,
                        "source": "manual",
                        "idempotency_key": idempotency_key,
                        "request_fingerprint": request_fingerprint,
                    },
                )
            agent_run_id = row.uuid
            db.commit()
        except HTTPException:
            db.rollback()
            raise
        except LookupError as exc:
            db.rollback()
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            db.rollback()
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=500, detail="工作流执行失败，未创建可审计任务") from exc
    else:
        # Keep the old lightweight runner available for callers that explicitly
        # opt out of durable task-center auditing.
        result = WorkflowEngine(db).run(
            workflow_id,
            input_text=body.input_text,
            context={**body.context, "user_id": str(session.user.id)},
            preferred_agent_id=body.preferred_agent_id,
            egress_confirmed=body.egress_confirmed,
            owner_user_id=str(session.user.id),
        )

    outputs = dict(result.outputs or {})
    if agent_run_id:
        outputs["agent_run_id"] = agent_run_id
    return {
        "workflow_id": result.workflow_id,
        "status": result.status,
        "steps": result.steps,
        "outputs": outputs,
        "error": result.error,
        "agent_run_id": agent_run_id,
        "replayed": replayed,
        "routing": {
            "selected_agent_id": route_data.get("selected_agent_id"),
            "routing_reasons": route_data.get("routing_reasons"),
        },
    }
