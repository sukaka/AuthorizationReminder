"""Phase 6 ops metrics / health snapshot for 6.0 GA readiness."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .agent_contracts import AgentEventContract, AgentRunContract, AgentRunStatus, AgentStepContract
from .agent_run_service import AgentRunService
from .agent_runtime.langgraph_runtime import select_runtime
from .agent_runtime.protocol import RunRequest
from .auth import get_session, is_platform_admin_role, require_action
from .config import Settings, get_settings
from .crypto import ContentCipher
from .database import get_db
from .direct_action_inventory import normalize_direct_action_response
from .harness_spec_registry import HarnessSpecRegistry, HarnessSpecRegistryError
from .admin.route_common import write_request_audit
from .models import (
    AgentArtifact,
    AgentRun,
    AgentRunEvent,
    AgentRunStep,
    AgentToolInvocation,
    ChannelMessageBinding,
    DirectActionInvocation,
    HarnessSpecVersion,
    LearningCandidate,
    SharedFaq,
)
from .ops_slo import build_slo_audit
from .schemas import SessionPayload

router = APIRouter(prefix="/api/ai/ops", tags=["ops"])


class OpsSnapshotOut(BaseModel):
    runs_total: int = 0
    runs_succeeded: int = 0
    runs_failed: int = 0
    runs_running: int = 0
    artifacts_total: int = 0
    tool_invocations_in_progress: int = 0
    tool_invocations_reconciliation_required: int = 0
    direct_actions_reconciliation_required: int = 0
    faqs_published: int = 0
    faqs_draft: int = 0
    learning_candidates_draft: int = 0
    learning_candidates_published: int = 0
    run_reconciliation_overall: Literal["pass", "fail", "unavailable"] = "unavailable"
    run_reconciliation_scanned_runs: int = 0
    run_reconciliation_issue_count: int = 0
    run_reconciliation_issue_counts: dict[str, int] = Field(default_factory=dict)
    success_rate: float = 0.0
    slo_audit: dict[str, Any] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)


class RunReconciliationIssueOut(BaseModel):
    run_id: str
    code: str
    entity: Literal["run", "step", "event"]
    detail: str


class RunReconciliationOut(BaseModel):
    overall: Literal["pass", "fail"]
    scanned_runs: int
    issue_count: int
    issue_counts: dict[str, int] = Field(default_factory=dict)
    issues: list[RunReconciliationIssueOut] = Field(default_factory=list)
    limit: int


class OpsRunDetailOut(BaseModel):
    run: AgentRunContract
    steps: list[AgentStepContract] = Field(default_factory=list)
    events: list[AgentEventContract] = Field(default_factory=list)
    result: dict[str, Any] = Field(default_factory=dict)
    reconciliation: RunReconciliationOut


class OpsRunActionOut(BaseModel):
    run: AgentRunContract
    snapshot: dict[str, Any] = Field(default_factory=dict)
    checkpoint: dict[str, Any] | None = None
    side_effects_reversed: bool = False


class ToolInvocationReconciliationOut(BaseModel):
    uuid: str
    run_id: str
    user_id: str
    tool_name: str
    tool_version: str
    idempotency_key: str
    effect: str
    status: str
    error_code: str
    error_message_safe: str
    output_summary: dict[str, Any] = Field(default_factory=dict)
    source_count: int = 0
    started_at: datetime | None = None
    finished_at: datetime | None = None
    reconciliation_resolution: str = ""
    reconciled_by_user_id: str = ""
    reconciled_at: datetime | None = None


class ToolInvocationReconciliationListOut(BaseModel):
    items: list[ToolInvocationReconciliationOut]
    total: int


class ReconcileToolInvocationIn(BaseModel):
    action: Literal["confirm_succeeded", "confirm_not_applied"]
    result_payload: dict[str, Any] | None = None
    output_summary: dict[str, Any] = Field(default_factory=dict)
    source_count: int = Field(default=0, ge=0)


class DirectActionReconciliationOut(BaseModel):
    uuid: str
    user_id: str
    action_name: str
    idempotency_key: str
    status: str
    response_status: int | None = None
    error_code: str
    error_message_safe: str
    started_at: datetime | None = None
    finished_at: datetime | None = None
    reconciliation_resolution: str = ""
    reconciled_by_user_id: str = ""
    reconciled_at: datetime | None = None


class DirectActionReconciliationListOut(BaseModel):
    items: list[DirectActionReconciliationOut]
    total: int


class ReconcileDirectActionIn(BaseModel):
    action: Literal["confirm_succeeded", "confirm_not_applied"]
    response_status: int | None = Field(default=None, ge=200, lt=300)
    response_payload: dict[str, Any] | None = None


class ChannelOutboundReconciliationOut(BaseModel):
    uuid: str
    channel: str
    external_message_id: str
    thread_id: str
    run_id: str
    related_message_id: str
    idempotency_key: str
    state: str
    error: str
    reconciliation_resolution: str = ""
    reconciled_by_user_id: str = ""
    reconciled_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ChannelOutboundReconciliationListOut(BaseModel):
    items: list[ChannelOutboundReconciliationOut]
    total: int


class ReconcileChannelOutboundIn(BaseModel):
    action: Literal["confirm_succeeded", "confirm_not_applied"]
    external_receipt: dict[str, Any] | None = None
    evidence_ref: str = Field(default="", max_length=256)


class HarnessSpecOut(BaseModel):
    uuid: str
    semantic_version: str
    content_hash: str
    status: str
    created_by_user_id: str
    approved_by_user_id: str
    activated_by_user_id: str
    content: dict[str, Any]


class HarnessSpecListOut(BaseModel):
    items: list[HarnessSpecOut]


class RegisterHarnessSpecIn(BaseModel):
    payload: dict[str, Any]


def _harness_spec_out(row: HarnessSpecVersion) -> HarnessSpecOut:
    return HarnessSpecOut(
        uuid=row.uuid,
        semantic_version=row.semantic_version,
        content_hash=row.content_hash,
        status=row.status,
        created_by_user_id=row.created_by_user_id,
        approved_by_user_id=row.approved_by_user_id,
        activated_by_user_id=row.activated_by_user_id,
        content=dict(row.content_json or {}),
    )


def _harness_spec_error(exc: HarnessSpecRegistryError) -> HTTPException:
    if str(exc) == "spec_not_found":
        return HTTPException(status_code=404, detail="HarnessSpec 版本不存在")
    if str(exc) in {"spec_version_already_exists", "spec_content_already_exists"}:
        return HTTPException(status_code=409, detail="HarnessSpec 版本或内容已存在")
    return HTTPException(status_code=409, detail=f"HarnessSpec 状态不允许此操作：{exc}")


def _tool_invocation_out(row: AgentToolInvocation) -> ToolInvocationReconciliationOut:
    return ToolInvocationReconciliationOut(
        uuid=row.uuid,
        run_id=row.run_id,
        user_id=row.user_id,
        tool_name=row.tool_name,
        tool_version=row.tool_version,
        idempotency_key=row.idempotency_key,
        effect=row.effect,
        status=row.status,
        error_code=row.error_code,
        error_message_safe=row.error_message_safe,
        output_summary=dict(row.output_summary_json or {}),
        source_count=int(row.source_count or 0),
        started_at=row.started_at,
        finished_at=row.finished_at,
        reconciliation_resolution=row.reconciliation_resolution,
        reconciled_by_user_id=row.reconciled_by_user_id,
        reconciled_at=row.reconciled_at,
    )


def _direct_action_out(row: DirectActionInvocation) -> DirectActionReconciliationOut:
    return DirectActionReconciliationOut(
        uuid=row.uuid,
        user_id=row.user_id,
        action_name=row.action_name,
        idempotency_key=row.idempotency_key,
        status=row.status,
        response_status=row.response_status,
        error_code=row.error_code,
        error_message_safe=row.error_message_safe,
        started_at=row.started_at,
        finished_at=row.finished_at,
        reconciliation_resolution=row.reconciliation_resolution,
        reconciled_by_user_id=row.reconciled_by_user_id,
        reconciled_at=row.reconciled_at,
    )


def _channel_outbound_metadata(row: ChannelMessageBinding) -> dict[str, Any]:
    raw = row.metadata_json
    return dict(raw) if isinstance(raw, dict) else {}


def _parse_metadata_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        return parsed.astimezone(UTC).replace(tzinfo=None)
    return parsed


def _channel_outbound_out(row: ChannelMessageBinding) -> ChannelOutboundReconciliationOut:
    metadata = _channel_outbound_metadata(row)
    return ChannelOutboundReconciliationOut(
        uuid=row.uuid,
        channel=row.channel,
        external_message_id=row.external_message_id,
        thread_id=row.thread_id,
        run_id=row.run_id,
        related_message_id=row.related_message_id,
        idempotency_key=str(metadata.get("idempotency_key") or ""),
        state=str(metadata.get("state") or ""),
        error=str(metadata.get("error") or "")[:500],
        reconciliation_resolution=str(metadata.get("reconciliation_resolution") or ""),
        reconciled_by_user_id=str(metadata.get("reconciled_by_user_id") or ""),
        reconciled_at=_parse_metadata_datetime(metadata.get("reconciled_at")),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _require_admin(
    request: Request,
    session: SessionPayload,
    settings: Settings,
) -> None:
    if not is_platform_admin_role(session.user.role):
        raise HTTPException(status_code=403, detail="仅管理员可查看运营看板")
    await require_action("ai_assistant:admin", request, session, settings)


def _count(db: Session, model, *where) -> int:
    stmt = select(func.count()).select_from(model)
    for clause in where:
        stmt = stmt.where(clause)
    return int(db.scalar(stmt) or 0)


def _validate_reconciliation_payload(payload: dict[str, Any]) -> None:
    try:
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail="对账结果必须是可持久化的 JSON 对象") from exc
    if len(encoded.encode("utf-8")) > 100_000:
        raise HTTPException(status_code=422, detail="对账结果不能超过 100KB")


def _run_reconciliation(
    db: Session,
    *,
    limit: int,
    run_id: str | None = None,
) -> RunReconciliationOut:
    statement = select(AgentRun).order_by(AgentRun.updated_at.desc(), AgentRun.id.desc()).limit(limit)
    if run_id:
        statement = statement.where(AgentRun.uuid == run_id)
    runs = list(db.scalars(statement))
    if not runs:
        return RunReconciliationOut(
            overall="pass",
            scanned_runs=0,
            issue_count=0,
            issue_counts={},
            issues=[],
            limit=limit,
        )

    run_ids = [run.uuid for run in runs]
    steps_by_run: dict[str, list[AgentRunStep]] = {run_id: [] for run_id in run_ids}
    events_by_run: dict[str, list[AgentRunEvent]] = {run_id: [] for run_id in run_ids}
    for step in db.scalars(
        select(AgentRunStep)
        .where(AgentRunStep.run_id.in_(run_ids))
        .order_by(AgentRunStep.run_id.asc(), AgentRunStep.sequence.asc())
    ):
        steps_by_run.setdefault(step.run_id, []).append(step)
    for event in db.scalars(
        select(AgentRunEvent)
        .where(AgentRunEvent.run_id.in_(run_ids))
        .order_by(AgentRunEvent.run_id.asc(), AgentRunEvent.sequence.asc())
    ):
        events_by_run.setdefault(event.run_id, []).append(event)

    terminal_statuses = {"succeeded", "completed", "failed", "cancelled"}
    known_statuses = {
        "created",
        "queued",
        "running",
        "waiting_confirmation",
        "paused",
        "retrying",
        *terminal_statuses,
    }
    terminal_event_for_status = {
        "succeeded": "completed",
        "completed": "completed",
        "failed": "failed",
        "cancelled": "cancelled",
    }
    known_event_types = {"stage", "delta", "source", "review", "completed", "failed", "cancelled"}
    terminal_step_statuses = terminal_statuses
    issues: list[RunReconciliationIssueOut] = []
    issue_counts: dict[str, int] = {}

    def add_issue(run_id: str, code: str, entity: Literal["run", "step", "event"], detail: str) -> None:
        issue_counts[code] = issue_counts.get(code, 0) + 1
        issues.append(RunReconciliationIssueOut(run_id=run_id, code=code, entity=entity, detail=detail))

    for run in runs:
        status = str(run.status or "")
        if status not in known_statuses:
            add_issue(run.uuid, "unknown_run_status", "run", f"status={status or '<empty>'}")

        if status in terminal_statuses and run.finished_at is None:
            add_issue(run.uuid, "terminal_run_missing_finished_at", "run", f"status={status}")
        elif status not in terminal_statuses and run.finished_at is not None:
            add_issue(
                run.uuid,
                "non_terminal_run_has_finished_at",
                "run",
                f"status={status}; finished_at={run.finished_at.isoformat()}",
            )

        steps = steps_by_run.get(run.uuid, [])
        step_sequences = [int(step.sequence) for step in steps]
        expected_step_sequences = list(range(1, len(step_sequences) + 1))
        if step_sequences != expected_step_sequences:
            add_issue(
                run.uuid,
                "step_sequence_gap",
                "step",
                f"observed={step_sequences}; expected={expected_step_sequences}",
            )
        for step in steps:
            if str(step.status or "") in terminal_step_statuses and step.finished_at is None:
                add_issue(
                    run.uuid,
                    "terminal_step_missing_finished_at",
                    "step",
                    f"sequence={step.sequence}; status={step.status}",
                )

        events = events_by_run.get(run.uuid, [])
        event_sequences = [int(event.sequence) for event in events]
        expected_event_sequences = list(range(1, len(event_sequences) + 1))
        if event_sequences != expected_event_sequences:
            add_issue(
                run.uuid,
                "event_sequence_gap",
                "event",
                f"observed={event_sequences}; expected={expected_event_sequences}",
            )
        for event in events:
            if str(event.event_type or "") not in known_event_types:
                add_issue(
                    run.uuid,
                    "unknown_event_type",
                    "event",
                    f"sequence={event.sequence}; event_type={event.event_type or '<empty>'}",
                )

        expected_terminal_event = terminal_event_for_status.get(status)
        if expected_terminal_event and not any(
            str(event.event_type or "") == expected_terminal_event for event in events
        ):
            add_issue(
                run.uuid,
                "terminal_event_missing",
                "event",
                f"status={status}; expected_event_type={expected_terminal_event}",
            )

    return RunReconciliationOut(
        overall="fail" if issues else "pass",
        scanned_runs=len(runs),
        issue_count=len(issues),
        issue_counts=issue_counts,
        issues=issues,
        limit=limit,
    )


@router.get("/harness-specs", response_model=HarnessSpecListOut)
async def list_harness_specs(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> HarnessSpecListOut:
    await _require_admin(request, session, settings)
    registry = HarnessSpecRegistry(db)
    registry.get_or_bootstrap_active()
    rows = list(db.scalars(select(HarnessSpecVersion).order_by(HarnessSpecVersion.created_at.desc())))
    return HarnessSpecListOut(items=[_harness_spec_out(row) for row in rows])


@router.post("/harness-specs", response_model=HarnessSpecOut, status_code=201)
async def register_harness_spec(
    body: RegisterHarnessSpecIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> HarnessSpecOut:
    await _require_admin(request, session, settings)
    try:
        row = HarnessSpecRegistry(db).register(payload=body.payload, actor_id=str(session.user.id))
        db.commit()
    except (HarnessSpecRegistryError, ValueError) as exc:
        db.rollback()
        if isinstance(exc, HarnessSpecRegistryError):
            raise _harness_spec_error(exc) from exc
        raise HTTPException(status_code=422, detail=f"HarnessSpec 契约无效：{exc}") from exc
    return _harness_spec_out(row)


async def _transition_harness_spec(
    *,
    action: str,
    spec_uuid: str,
    request: Request,
    session: SessionPayload,
    settings: Settings,
    db: Session,
) -> HarnessSpecOut:
    await _require_admin(request, session, settings)
    registry = HarnessSpecRegistry(db)
    try:
        if action == "submit":
            row = registry.submit_for_approval(spec_uuid, actor_id=str(session.user.id))
        elif action == "approve":
            row = registry.approve(spec_uuid, actor_id=str(session.user.id))
        elif action == "activate":
            row = registry.activate(spec_uuid, actor_id=str(session.user.id))
        else:
            row = registry.rollback(spec_uuid, actor_id=str(session.user.id))
        db.commit()
    except HarnessSpecRegistryError as exc:
        db.rollback()
        raise _harness_spec_error(exc) from exc
    return _harness_spec_out(row)


@router.post("/harness-specs/{spec_uuid}/submit", response_model=HarnessSpecOut)
async def submit_harness_spec(
    spec_uuid: str, request: Request, session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)], db: Annotated[Session, Depends(get_db)],
) -> HarnessSpecOut:
    return await _transition_harness_spec(action="submit", spec_uuid=spec_uuid, request=request, session=session, settings=settings, db=db)


@router.post("/harness-specs/{spec_uuid}/approve", response_model=HarnessSpecOut)
async def approve_harness_spec(
    spec_uuid: str, request: Request, session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)], db: Annotated[Session, Depends(get_db)],
) -> HarnessSpecOut:
    return await _transition_harness_spec(action="approve", spec_uuid=spec_uuid, request=request, session=session, settings=settings, db=db)


@router.post("/harness-specs/{spec_uuid}/activate", response_model=HarnessSpecOut)
async def activate_harness_spec(
    spec_uuid: str, request: Request, session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)], db: Annotated[Session, Depends(get_db)],
) -> HarnessSpecOut:
    return await _transition_harness_spec(action="activate", spec_uuid=spec_uuid, request=request, session=session, settings=settings, db=db)


@router.post("/harness-specs/{spec_uuid}/rollback", response_model=HarnessSpecOut)
async def rollback_harness_spec(
    spec_uuid: str, request: Request, session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)], db: Annotated[Session, Depends(get_db)],
) -> HarnessSpecOut:
    return await _transition_harness_spec(action="rollback", spec_uuid=spec_uuid, request=request, session=session, settings=settings, db=db)


@router.get("/tool-invocations/reconciliation", response_model=ToolInvocationReconciliationListOut)
async def list_tool_invocations_requiring_reconciliation(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> ToolInvocationReconciliationListOut:
    await _require_admin(request, session, settings)
    rows = list(
        db.scalars(
            select(AgentToolInvocation)
            .where(AgentToolInvocation.status == "reconciliation_required")
            .order_by(AgentToolInvocation.updated_at.asc(), AgentToolInvocation.id.asc())
            .limit(limit)
        )
    )
    return ToolInvocationReconciliationListOut(
        items=[_tool_invocation_out(row) for row in rows],
        total=len(rows),
    )


@router.post(
    "/tool-invocations/{invocation_uuid}/reconcile",
    response_model=ToolInvocationReconciliationOut,
)
async def reconcile_tool_invocation(
    invocation_uuid: str,
    body: ReconcileToolInvocationIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ToolInvocationReconciliationOut:
    await _require_admin(request, session, settings)
    if body.action == "confirm_succeeded":
        if body.result_payload is None:
            raise HTTPException(status_code=422, detail="确认成功必须提供可回放结果")
        _validate_reconciliation_payload(body.result_payload)
        _validate_reconciliation_payload(body.output_summary)

    now = datetime.now(UTC).replace(tzinfo=None)
    if body.action == "confirm_succeeded":
        values = {
            "status": "succeeded",
            "result_payload_json": body.result_payload,
            "output_summary_json": body.output_summary,
            "source_count": body.source_count,
            "error_code": "",
            "error_message_safe": "",
            "finished_at": now,
            "reconciliation_resolution": "operator_confirmed_succeeded",
            "reconciled_by_user_id": str(session.user.id),
            "reconciled_at": now,
        }
    else:
        values = {
            "status": "failed",
            "error_code": "TOOL_RECONCILED_NOT_APPLIED",
            "error_message_safe": "管理员确认该调用未产生副作用；如需重试必须使用新的幂等键",
            "finished_at": now,
            "reconciliation_resolution": "operator_confirmed_not_applied",
            "reconciled_by_user_id": str(session.user.id),
            "reconciled_at": now,
        }

    result = db.execute(
        update(AgentToolInvocation)
        .where(
            AgentToolInvocation.uuid == invocation_uuid,
            AgentToolInvocation.status == "reconciliation_required",
        )
        .values(**values)
    )
    if not result.rowcount:
        row = db.scalar(
            select(AgentToolInvocation).where(AgentToolInvocation.uuid == invocation_uuid)
        )
        if row is None:
            raise HTTPException(status_code=404, detail="工具调用不存在")
        raise HTTPException(status_code=409, detail="该工具调用当前不需要对账或已被其他管理员处置")
    db.commit()
    row = db.scalar(select(AgentToolInvocation).where(AgentToolInvocation.uuid == invocation_uuid))
    assert row is not None
    return _tool_invocation_out(row)


@router.get("/direct-actions/reconciliation", response_model=DirectActionReconciliationListOut)
async def list_direct_actions_requiring_reconciliation(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> DirectActionReconciliationListOut:
    await _require_admin(request, session, settings)
    rows = list(
        db.scalars(
            select(DirectActionInvocation)
            .where(DirectActionInvocation.status == "reconciliation_required")
            .order_by(DirectActionInvocation.updated_at.asc(), DirectActionInvocation.id.asc())
            .limit(limit)
        )
    )
    return DirectActionReconciliationListOut(
        items=[_direct_action_out(row) for row in rows],
        total=len(rows),
    )


@router.post(
    "/direct-actions/{invocation_uuid}/reconcile",
    response_model=DirectActionReconciliationOut,
)
async def reconcile_direct_action(
    invocation_uuid: str,
    body: ReconcileDirectActionIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> DirectActionReconciliationOut:
    await _require_admin(request, session, settings)
    invocation = db.scalar(
        select(DirectActionInvocation).where(DirectActionInvocation.uuid == invocation_uuid)
    )
    if invocation is None:
        raise HTTPException(status_code=404, detail="直连操作不存在")
    if invocation.status != "reconciliation_required":
        raise HTTPException(status_code=409, detail="该直连操作当前不需要对账或已被其他管理员处置")
    if body.action == "confirm_succeeded":
        if body.response_status is None or body.response_payload is None:
            raise HTTPException(status_code=422, detail="确认成功必须提供可回放 HTTP 状态和结果")
        _validate_reconciliation_payload(body.response_payload)
        try:
            replay_payload = normalize_direct_action_response(
                invocation.action_name,
                body.response_payload,
            )
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="对账结果不符合该直连操作的原始响应契约") from None

    now = datetime.now(UTC).replace(tzinfo=None)
    if body.action == "confirm_succeeded":
        values = {
            "status": "succeeded",
            "response_status": body.response_status,
            "response_payload_json": replay_payload,
            "error_code": "",
            "error_message_safe": "",
            "finished_at": now,
            "reconciliation_resolution": "operator_confirmed_succeeded",
            "reconciled_by_user_id": str(session.user.id),
            "reconciled_at": now,
        }
    else:
        values = {
            "status": "failed",
            "error_code": "DIRECT_ACTION_RECONCILED_NOT_APPLIED",
            "error_message_safe": "管理员确认该操作未产生副作用；如需重试必须使用新的幂等键",
            "finished_at": now,
            "reconciliation_resolution": "operator_confirmed_not_applied",
            "reconciled_by_user_id": str(session.user.id),
            "reconciled_at": now,
        }
    result = db.execute(
        update(DirectActionInvocation)
        .where(
            DirectActionInvocation.uuid == invocation_uuid,
            DirectActionInvocation.status == "reconciliation_required",
        )
        .values(**values)
    )
    if not result.rowcount:
        row = db.scalar(select(DirectActionInvocation).where(DirectActionInvocation.uuid == invocation_uuid))
        if row is None:
            raise HTTPException(status_code=404, detail="直连操作不存在")
        raise HTTPException(status_code=409, detail="该直连操作当前不需要对账或已被其他管理员处置")
    db.commit()
    row = db.scalar(select(DirectActionInvocation).where(DirectActionInvocation.uuid == invocation_uuid))
    assert row is not None
    return _direct_action_out(row)


@router.get(
    "/channel-outbound/reconciliation",
    response_model=ChannelOutboundReconciliationListOut,
)
async def list_channel_outbound_requiring_reconciliation(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> ChannelOutboundReconciliationListOut:
    """List outbound messages whose provider outcome is unknown.

    The binding table predates the reconciliation workflow, so its JSON metadata
    remains the source of truth and no schema migration is needed here.
    """
    await _require_admin(request, session, settings)
    rows = list(
        db.scalars(
            select(ChannelMessageBinding)
            .where(ChannelMessageBinding.direction == "outbound")
            .order_by(ChannelMessageBinding.updated_at.asc(), ChannelMessageBinding.id.asc())
        )
    )
    pending = [
        row
        for row in rows
        if _channel_outbound_metadata(row).get("state") == "reconciliation_required"
    ]
    return ChannelOutboundReconciliationListOut(
        items=[_channel_outbound_out(row) for row in pending[:limit]],
        total=len(pending),
    )


@router.post(
    "/channel-outbound/{binding_uuid}/reconcile",
    response_model=ChannelOutboundReconciliationOut,
)
async def reconcile_channel_outbound(
    binding_uuid: str,
    body: ReconcileChannelOutboundIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ChannelOutboundReconciliationOut:
    """Resolve an unknown provider outcome without re-sending the message."""
    await _require_admin(request, session, settings)
    binding = db.scalar(
        select(ChannelMessageBinding)
        .where(
            ChannelMessageBinding.uuid == binding_uuid,
            ChannelMessageBinding.direction == "outbound",
        )
        .with_for_update()
    )
    if binding is None:
        raise HTTPException(status_code=404, detail="渠道出站消息不存在")

    metadata = _channel_outbound_metadata(binding)
    if metadata.get("state") != "reconciliation_required":
        raise HTTPException(status_code=409, detail="该渠道出站消息当前不需要对账或已被其他管理员处置")

    if body.action == "confirm_succeeded":
        if body.external_receipt is None:
            raise HTTPException(status_code=422, detail="确认成功必须提供外部平台回执")
        _validate_reconciliation_payload(body.external_receipt)
        metadata.update(
            {
                "state": "sent",
                "outbound_ok": True,
                "error": "",
                "reconciliation_resolution": "operator_confirmed_succeeded",
                "external_receipt": body.external_receipt,
            }
        )
    else:
        metadata.pop("external_receipt", None)
        metadata.update(
            {
                "state": "not_applied",
                "outbound_ok": False,
                "error": "管理员确认外部平台未生效；如需重试必须使用新的幂等键",
                "reconciliation_resolution": "operator_confirmed_not_applied",
            }
        )

    now = datetime.now(UTC).replace(tzinfo=None)
    metadata["reconciled_by_user_id"] = str(session.user.id)
    metadata["reconciled_at"] = now.isoformat()
    if body.evidence_ref.strip():
        metadata["evidence_ref"] = body.evidence_ref.strip()
    else:
        metadata.pop("evidence_ref", None)
    _validate_reconciliation_payload(metadata)

    binding.metadata_json = metadata
    db.commit()
    row = db.scalar(select(ChannelMessageBinding).where(ChannelMessageBinding.uuid == binding_uuid))
    assert row is not None
    return _channel_outbound_out(row)


@router.get("/snapshot", response_model=OpsSnapshotOut)
async def ops_snapshot(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> OpsSnapshotOut:
    await _require_admin(request, session, settings)
    notes: list[str] = []
    run_reconciliation: RunReconciliationOut | None = None
    try:
        runs_total = _count(db, AgentRun)
        runs_succeeded = _count(db, AgentRun, AgentRun.status == "succeeded")
        runs_failed = _count(db, AgentRun, AgentRun.status == "failed")
        runs_running = _count(
            db,
            AgentRun,
            AgentRun.status.in_(("queued", "running", "waiting_user")),
        )
    except Exception:
        runs_total = runs_succeeded = runs_failed = runs_running = 0
        notes.append("runs_table_unavailable")

    try:
        run_reconciliation = _run_reconciliation(db, limit=200)
        run_reconciliation_overall = run_reconciliation.overall
        run_reconciliation_scanned_runs = run_reconciliation.scanned_runs
        run_reconciliation_issue_count = run_reconciliation.issue_count
        run_reconciliation_issue_counts = dict(run_reconciliation.issue_counts)
    except Exception:
        run_reconciliation_overall = "unavailable"
        run_reconciliation_scanned_runs = 0
        run_reconciliation_issue_count = 0
        run_reconciliation_issue_counts = {}
        notes.append("run_reconciliation_unavailable")

    try:
        artifacts_total = _count(db, AgentArtifact)
    except Exception:
        artifacts_total = 0
        notes.append("artifacts_table_unavailable")

    try:
        tool_invocations_in_progress = _count(
            db,
            AgentToolInvocation,
            AgentToolInvocation.status == "in_progress",
        )
        tool_invocations_reconciliation_required = _count(
            db,
            AgentToolInvocation,
            AgentToolInvocation.status == "reconciliation_required",
        )
    except Exception:
        tool_invocations_in_progress = 0
        tool_invocations_reconciliation_required = 0
        notes.append("agent_tool_invocations_table_unavailable")

    try:
        direct_actions_reconciliation_required = _count(
            db,
            DirectActionInvocation,
            DirectActionInvocation.status == "reconciliation_required",
        )
    except Exception:
        direct_actions_reconciliation_required = 0
        notes.append("direct_action_invocations_table_unavailable")

    try:
        faqs_published = _count(
            db, SharedFaq, SharedFaq.status.in_(("published", "active"))
        )
        faqs_draft = _count(db, SharedFaq, SharedFaq.status == "draft")
    except Exception:
        faqs_published = faqs_draft = 0
        notes.append("faq_table_unavailable")

    try:
        learning_candidates_draft = _count(
            db, LearningCandidate, LearningCandidate.status == "draft"
        )
        learning_candidates_published = _count(
            db, LearningCandidate, LearningCandidate.status == "published"
        )
    except Exception:
        learning_candidates_draft = learning_candidates_published = 0
        notes.append("learning_table_unavailable")

    try:
        slo_audit = build_slo_audit(db, run_reconciliation=run_reconciliation)
    except Exception as exc:
        slo_audit = {
            "overall": "unavailable",
            "checks": [],
            "metrics": {},
            "fail_count": 0,
            "gap_count": 0,
            "notes": ["slo_audit_unavailable", str(exc)[:160]],
        }
        notes.append("slo_audit_unavailable")

    finished = runs_succeeded + runs_failed
    success_rate = (runs_succeeded / finished) if finished else 0.0
    return OpsSnapshotOut(
        runs_total=runs_total,
        runs_succeeded=runs_succeeded,
        runs_failed=runs_failed,
        runs_running=runs_running,
        artifacts_total=artifacts_total,
        tool_invocations_in_progress=tool_invocations_in_progress,
        tool_invocations_reconciliation_required=tool_invocations_reconciliation_required,
        direct_actions_reconciliation_required=direct_actions_reconciliation_required,
        faqs_published=faqs_published,
        faqs_draft=faqs_draft,
        learning_candidates_draft=learning_candidates_draft,
        learning_candidates_published=learning_candidates_published,
        run_reconciliation_overall=run_reconciliation_overall,
        run_reconciliation_scanned_runs=run_reconciliation_scanned_runs,
        run_reconciliation_issue_count=run_reconciliation_issue_count,
        run_reconciliation_issue_counts=run_reconciliation_issue_counts,
        success_rate=round(success_rate, 4),
        slo_audit=slo_audit,
        notes=notes,
    )


def _ops_service(db: Session, settings: Settings) -> AgentRunService:
    return AgentRunService(
        db,
        ContentCipher(settings.content_encryption_key),
        key_version=settings.content_encryption_key_version,
    )


def _ops_run_or_404(db: Session, run_id: str) -> AgentRun:
    row = db.scalar(select(AgentRun).where(AgentRun.uuid == run_id))
    if row is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return row


@router.get("/runs/{run_id}", response_model=OpsRunDetailOut)
async def ops_run_detail(
    run_id: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> OpsRunDetailOut:
    """Admin view of one Run with its Step/Event lineage and scoped reconciliation."""
    await _require_admin(request, session, settings)
    row = _ops_run_or_404(db, run_id)
    service = _ops_service(db, settings)
    return OpsRunDetailOut(
        run=service.to_public_run(row),
        steps=[service.to_public_step(step) for step in service.list_steps(run_id)],
        events=[service.to_public_event(event) for event in service.list_events(run_id)],
        result=row.result_json if isinstance(row.result_json, dict) else {},
        reconciliation=_run_reconciliation(db, limit=1, run_id=run_id),
    )


@router.post("/runs/{run_id}/pause", response_model=OpsRunActionOut)
async def ops_pause_run(
    run_id: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> OpsRunActionOut:
    await _require_admin(request, session, settings)
    row = _ops_run_or_404(db, run_id)
    service = _ops_service(db, settings)
    try:
        service.pause(row)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=f"任务当前不能暂停：{exc}") from exc
    row.metadata_json = {
        **(row.metadata_json if isinstance(row.metadata_json, dict) else {}),
        "ops_control": {
            "action": "pause",
            "actor_user_id": str(session.user.id),
            "at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        },
    }
    write_request_audit(
        db,
        session,
        request,
        settings,
        action="agent_run.ops_pause",
        entity_type="agent_run",
        entity_uuid=row.uuid,
        metadata={"status": row.status},
    )
    db.commit()
    db.refresh(row)
    return OpsRunActionOut(run=service.to_public_run(row))


@router.post("/runs/{run_id}/resume", response_model=OpsRunActionOut)
async def ops_resume_run(
    run_id: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> OpsRunActionOut:
    await _require_admin(request, session, settings)
    row = _ops_run_or_404(db, run_id)
    service = _ops_service(db, settings)
    was_paused = row.status == AgentRunStatus.PAUSED.value
    try:
        request_payload = service.decrypt_request(row) if was_paused else {}
        service.resume_paused(row)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=f"任务当前不能恢复：{exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail="任务请求无法解密，不能恢复") from exc
    row.metadata_json = {
        **(row.metadata_json if isinstance(row.metadata_json, dict) else {}),
        "ops_control": {
            "action": "resume",
            "actor_user_id": str(session.user.id),
            "at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        },
    }
    write_request_audit(
        db,
        session,
        request,
        settings,
        action="agent_run.ops_resume",
        entity_type="agent_run",
        entity_uuid=row.uuid,
        metadata={"status": row.status},
    )
    db.commit()
    if not was_paused:
        db.refresh(row)
        return OpsRunActionOut(
            run=service.to_public_run(row),
            snapshot={
                "run_id": row.uuid,
                "status": row.status,
                "stage": row.stage,
                "progress": int(row.progress or 0),
            },
        )
    if row.run_type == "workflow":
        from .workflow_run_service import WorkflowRunService

        try:
            _result, row = WorkflowRunService(db, settings).resume(
                row.uuid, str(row.owner_user_id)
            )
        except (LookupError, ValueError) as exc:
            raise HTTPException(status_code=409, detail=f"工作流恢复失败：{exc}") from exc
        db.commit()
        db.refresh(row)
        return OpsRunActionOut(
            run=service.to_public_run(row),
            snapshot=WorkflowRunService.snapshot(row),
        )
    runtime = select_runtime(
        db,
        ContentCipher(settings.content_encryption_key),
        settings=settings,
        key_version=settings.content_encryption_key_version,
    )
    snapshot = await runtime.start(
        RunRequest(
            run_id=row.uuid,
            owner_user_id=row.owner_user_id,
            input_text=str(request_payload.get("input_text") or ""),
            conversation_id=row.conversation_id,
            message_id=row.message_id,
            run_type=row.run_type,
        )
    )
    db.refresh(row)
    return OpsRunActionOut(run=service.to_public_run(row), snapshot=snapshot.model_dump())


@router.post("/runs/{run_id}/rollback", response_model=OpsRunActionOut)
async def ops_rollback_run(
    run_id: str,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> OpsRunActionOut:
    await _require_admin(request, session, settings)
    row = _ops_run_or_404(db, run_id)
    service = _ops_service(db, settings)
    try:
        checkpoint = service.rollback_to_checkpoint(row)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=f"任务当前不能回滚：{exc}") from exc
    row.metadata_json = {
        **(row.metadata_json if isinstance(row.metadata_json, dict) else {}),
        "ops_control": {
            "action": "rollback",
            "actor_user_id": str(session.user.id),
            "at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        },
    }
    write_request_audit(
        db,
        session,
        request,
        settings,
        action="agent_run.ops_rollback",
        entity_type="agent_run",
        entity_uuid=row.uuid,
        metadata={"status": row.status, "checkpoint_source": checkpoint["source"]},
    )
    db.commit()
    db.refresh(row)
    return OpsRunActionOut(
        run=service.to_public_run(row),
        checkpoint=checkpoint,
        side_effects_reversed=False,
    )


@router.get("/run-reconciliation", response_model=RunReconciliationOut)
async def ops_run_reconciliation(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    limit: int = Query(default=200, ge=1, le=200),
) -> RunReconciliationOut:
    """Read-only Run / Step / Event consistency report for the ops dashboard."""
    await _require_admin(request, session, settings)
    return _run_reconciliation(db, limit=limit)


@router.get("/ga-report")
async def ops_ga_report(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """6.0 GA 发布门禁对照表（主方案 §8.1）。"""
    await _require_admin(request, session, settings)
    from .ops_ga import build_ga_report

    return build_ga_report(db, sample_limit=200)


@router.get("/cost-summary")
async def ops_cost_summary(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """7.0 Agent 调用量 / 成本 / 出域拒绝摘要。"""
    await _require_admin(request, session, settings)
    from .agent_audit_service import cost_summary

    return cost_summary(db)


@router.get("/readiness")
async def ops_readiness(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """一键就绪检查：DB / 安全开关 / 离线评测 / GA 代理 / Hub。"""
    await _require_admin(request, session, settings)
    from .ops_readiness import run_readiness_probe

    return run_readiness_probe(db, settings)


@router.get("/security-audit")
async def ops_security_audit(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """特权 / 出域 / checkpoint / 凭证 / Connector SDK 专项审计。"""
    await _require_admin(request, session, settings)
    from .ops_security_audit import run_security_audit

    return run_security_audit(db, settings)


@router.post("/checkpoint-suite")
async def ops_checkpoint_suite(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cases: int = 20,
) -> dict[str, Any]:
    """离线 checkpoint 恢复压测套件（写入后保留样本，便于排查）。"""
    await _require_admin(request, session, settings)
    from .agent_run_service import AgentRunService
    from .checkpoint_recovery import simulate_checkpoint_recovery
    from .crypto import ContentCipher

    key = (settings.content_encryption_key or "").strip()
    if not key:
        import base64

        key = base64.urlsafe_b64encode(b"ops-checkpoint-suite-key-32byt").decode("ascii")
    service = AgentRunService(db, ContentCipher(key), key_version=settings.content_encryption_key_version)
    result = simulate_checkpoint_recovery(
        service,
        owner_user_id=f"checkpoint-suite:{session.user.id}",
        cases=max(1, min(int(cases or 20), 100)),
    )
    db.commit()
    return result


@router.get("/feature-flags")
async def feature_flags(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    """Gray-release flags (file store + runtime capability hints)."""
    await require_action("ai_assistant:use", request, session, settings)
    from .feature_flags import load_feature_flags
    from .agent_runtime.langgraph_runtime import langgraph_backend_status

    stored = load_feature_flags(settings)
    return {
        **stored,
        "qdrant_enabled": bool(getattr(settings, "qdrant_enabled", False)),
        "server_model_configured": bool(
            getattr(settings, "server_model_base_url", "")
            and getattr(settings, "server_model_api_key", "")
        ),
        "langgraph_runtime_env": bool(
            getattr(settings, "ai_langgraph_runtime_enabled", False)
        ),
        "langgraph_backend": langgraph_backend_status(),
    }


@router.get("/runtime-shadow")
async def runtime_shadow_report(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    """Return the last local shadow report without exposing request or answer content."""
    await _require_admin(request, session, settings)
    from .agent_runtime.runtime_shadow import load_report
    from .feature_flags import load_feature_flags

    flags = load_feature_flags(settings)
    return {
        "config": {
            "enabled": bool(flags.get("runtime_shadow_enabled", False)),
            "sample_percent": int(flags.get("runtime_shadow_sample_percent", 0)),
            "max_mismatch_percent": float(flags.get("runtime_shadow_max_mismatch_percent", 0)),
        },
        "report": load_report(settings),
    }


@router.put("/feature-flags")
async def update_feature_flags(
    body: dict[str, Any],
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Admin write path for gray-release flags."""
    await _require_admin(request, session, settings)
    from .admin.route_common import write_request_audit
    from .feature_flags import save_feature_flags

    # Never allow learning_auto_publish=true via this API (safety gate)
    if body.get("learning_auto_publish") is True:
        raise HTTPException(status_code=400, detail="learning_auto_publish_forbidden")
    try:
        result = save_feature_flags(body, settings)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    write_request_audit(
        db,
        session,
        request,
        settings,
        action="feature_flags.update",
        entity_type="feature_flags",
        entity_uuid="runtime",
        metadata={"setting_key": "feature_flags", "event": "runtime_shadow", "status": "updated"},
    )
    db.commit()
    return result
