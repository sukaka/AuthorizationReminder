from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from .admin.route_common import write_request_audit
from .auth import get_session, require_action
from .config import Settings, get_settings
from .database import get_db
from .project_access import require_project_access, require_project_manager
from .project_task_models import (
    ProjectActivity,
    ProjectDeliverable,
    ProjectIssue,
    ProjectTask,
)
from .schemas import SessionPayload


router = APIRouter(prefix="/api/ai/projects", tags=["project-tasks"])


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProjectTaskCreateIn(StrictModel):
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=20000)
    priority: Literal["low", "normal", "high", "urgent"] = "normal"
    assignee_user_id: str = Field(default="", max_length=64)
    due_at: datetime | None = None

    @field_validator("title", "description", "assignee_user_id", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ProjectTaskStatusIn(StrictModel):
    status: Literal["todo", "in_progress", "blocked", "done", "cancelled"]


class ProjectTaskUpdateIn(StrictModel):
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=20000)
    priority: Literal["low", "normal", "high", "urgent"] = "normal"

    @field_validator("title", "description", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ProjectTaskOut(BaseModel):
    task_uuid: str
    title: str
    description: str
    status: str
    priority: str
    assignee_user_id: str
    due_at: datetime | None
    created_by: str
    created_at: datetime
    updated_at: datetime


class ProjectDeliverableCreateIn(StrictModel):
    task_uuid: str = Field(default="", max_length=36)
    title: str = Field(min_length=1, max_length=255)
    deliverable_type: str = Field(default="document", max_length=48)
    content_summary: str = Field(default="", max_length=20000)
    file_name: str = Field(default="", max_length=255)
    file_ref: str = Field(default="", max_length=1024)

    @field_validator("task_uuid", "title", "deliverable_type", "content_summary", "file_name", "file_ref", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ProjectDeliverableStatusIn(StrictModel):
    status: Literal["draft", "in_review", "approved", "rejected"]


class ProjectDeliverableOut(BaseModel):
    deliverable_uuid: str
    task_uuid: str
    title: str
    deliverable_type: str
    status: str
    content_summary: str
    file_name: str
    version: int
    submitted_by: str
    approved_by: str
    approved_at: datetime | None
    created_by: str
    created_at: datetime
    updated_at: datetime


class ProjectIssueCreateIn(StrictModel):
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=20000)
    severity: Literal["low", "medium", "high", "critical"] = "medium"
    assignee_user_id: str = Field(default="", max_length=64)

    @field_validator("title", "description", "assignee_user_id", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ProjectIssueStatusIn(StrictModel):
    status: Literal["open", "in_progress", "resolved", "closed"]
    resolution: str = Field(default="", max_length=20000)


class ProjectIssueOut(BaseModel):
    issue_uuid: str
    title: str
    description: str
    status: str
    severity: str
    assignee_user_id: str
    resolution: str
    created_by: str
    resolved_by: str
    resolved_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ProjectActivityOut(BaseModel):
    activity_uuid: str
    actor_user_id: str
    action: str
    entity_type: str
    entity_uuid: str
    summary: str
    metadata: dict | None
    created_at: datetime


async def _require_ai_use(
    request: Request,
    session_payload: SessionPayload,
    current_settings: Settings,
) -> None:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )


def _project(db: Session, project_uuid: str, session_payload: SessionPayload):
    return require_project_access(db, project_uuid, str(session_payload.user.id))


def _activity(
    db: Session,
    project_id: int,
    actor_user_id: str,
    *,
    action: str,
    entity_type: str,
    entity_uuid: str,
    summary: str,
    metadata: dict | None = None,
) -> None:
    db.add(
        ProjectActivity(
            project_id=project_id,
            actor_user_id=actor_user_id,
            action=action,
            entity_type=entity_type,
            entity_uuid=entity_uuid,
            summary=summary,
            metadata_json=metadata,
        )
    )


def _audit(
    db: Session,
    session_payload: SessionPayload,
    request: Request,
    current_settings: Settings,
    *,
    action: str,
    project_uuid: str,
    entity_uuid: str,
) -> None:
    write_request_audit(
        db,
        session_payload,
        request,
        current_settings,
        action=action,
        entity_type="project",
        entity_uuid=project_uuid,
        metadata={"resource_uuid": entity_uuid},
    )


def _task_out(row: ProjectTask) -> ProjectTaskOut:
    return ProjectTaskOut(
        task_uuid=row.uuid,
        title=row.title,
        description=row.description,
        status=row.status,
        priority=row.priority,
        assignee_user_id=row.assignee_user_id,
        due_at=row.due_at,
        created_by=row.created_by,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _deliverable_out(row: ProjectDeliverable, db: Session) -> ProjectDeliverableOut:
    task = db.get(ProjectTask, row.task_id) if row.task_id is not None else None
    return ProjectDeliverableOut(
        deliverable_uuid=row.uuid,
        task_uuid=task.uuid if task is not None else "",
        title=row.title,
        deliverable_type=row.deliverable_type,
        status=row.status,
        content_summary=row.content_summary,
        file_name=row.file_name,
        version=row.version,
        submitted_by=row.submitted_by,
        approved_by=row.approved_by,
        approved_at=row.approved_at,
        created_by=row.created_by,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _issue_out(row: ProjectIssue) -> ProjectIssueOut:
    return ProjectIssueOut(
        issue_uuid=row.uuid,
        title=row.title,
        description=row.description,
        status=row.status,
        severity=row.severity,
        assignee_user_id=row.assignee_user_id,
        resolution=row.resolution,
        created_by=row.created_by,
        resolved_by=row.resolved_by,
        resolved_at=row.resolved_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/{project_uuid}/tasks", response_model=list[ProjectTaskOut])
async def list_project_tasks(
    project_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ProjectTaskOut]:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _project(db, project_uuid, session_payload)
    rows = db.scalars(
        select(ProjectTask)
        .where(ProjectTask.project_id == project.id)
        .order_by(ProjectTask.created_at.desc())
    ).all()
    return [_task_out(row) for row in rows]


@router.post("/{project_uuid}/tasks", response_model=ProjectTaskOut, status_code=201)
async def create_project_task(
    project_uuid: str,
    body: ProjectTaskCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ProjectTaskOut:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _project(db, project_uuid, session_payload)
    row = ProjectTask(
        project_id=project.id,
        title=body.title,
        description=body.description,
        priority=body.priority,
        assignee_user_id=body.assignee_user_id,
        due_at=body.due_at,
        created_by=str(session_payload.user.id),
    )
    db.add(row)
    db.flush()
    _activity(
        db,
        project.id,
        str(session_payload.user.id),
        action="project.task.create",
        entity_type="task",
        entity_uuid=row.uuid,
        summary=f"创建任务：{row.title}",
    )
    _audit(db, session_payload, request, current_settings, action="project.task.create", project_uuid=project.uuid, entity_uuid=row.uuid)
    db.commit()
    db.refresh(row)
    return _task_out(row)


@router.post("/{project_uuid}/tasks/{task_uuid}/status", response_model=ProjectTaskOut)
async def update_project_task_status(
    project_uuid: str,
    task_uuid: str,
    body: ProjectTaskStatusIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ProjectTaskOut:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _project(db, project_uuid, session_payload)
    row = db.scalar(select(ProjectTask).where(ProjectTask.project_id == project.id, ProjectTask.uuid == task_uuid))
    if row is None:
        raise HTTPException(status_code=404, detail="项目任务不存在")
    row.status = body.status
    _activity(
        db,
        project.id,
        str(session_payload.user.id),
        action="project.task.status",
        entity_type="task",
        entity_uuid=row.uuid,
        summary=f"任务状态更新为：{row.status}",
        metadata={"status": row.status},
    )
    _audit(db, session_payload, request, current_settings, action="project.task.status", project_uuid=project.uuid, entity_uuid=row.uuid)
    db.commit()
    db.refresh(row)
    return _task_out(row)


@router.put("/{project_uuid}/tasks/{task_uuid}", response_model=ProjectTaskOut)
async def update_project_task(
    project_uuid: str,
    task_uuid: str,
    body: ProjectTaskUpdateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ProjectTaskOut:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _project(db, project_uuid, session_payload)
    row = db.scalar(select(ProjectTask).where(ProjectTask.project_id == project.id, ProjectTask.uuid == task_uuid))
    if row is None:
        raise HTTPException(status_code=404, detail="项目任务不存在")
    row.title = body.title
    row.description = body.description
    row.priority = body.priority
    _activity(
        db,
        project.id,
        str(session_payload.user.id),
        action="project.task.update",
        entity_type="task",
        entity_uuid=row.uuid,
        summary=f"更新任务：{row.title}",
        metadata={"priority": row.priority},
    )
    _audit(db, session_payload, request, current_settings, action="project.task.update", project_uuid=project.uuid, entity_uuid=row.uuid)
    db.commit()
    db.refresh(row)
    return _task_out(row)


@router.delete("/{project_uuid}/tasks/{task_uuid}", status_code=204)
async def delete_project_task(
    project_uuid: str,
    task_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _project(db, project_uuid, session_payload)
    row = db.scalar(select(ProjectTask).where(ProjectTask.project_id == project.id, ProjectTask.uuid == task_uuid))
    if row is None:
        raise HTTPException(status_code=404, detail="项目任务不存在")
    linked_deliverables = db.scalars(
        select(ProjectDeliverable).where(ProjectDeliverable.task_id == row.id)
    ).all()
    for deliverable in linked_deliverables:
        deliverable.task_id = None
    _activity(
        db,
        project.id,
        str(session_payload.user.id),
        action="project.task.delete",
        entity_type="task",
        entity_uuid=row.uuid,
        summary=f"删除任务：{row.title}",
        metadata={"unlinked_deliverables": len(linked_deliverables)},
    )
    _audit(db, session_payload, request, current_settings, action="project.task.delete", project_uuid=project.uuid, entity_uuid=row.uuid)
    db.delete(row)
    db.commit()
    return Response(status_code=204)


@router.get("/{project_uuid}/deliverables", response_model=list[ProjectDeliverableOut])
async def list_project_deliverables(
    project_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ProjectDeliverableOut]:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _project(db, project_uuid, session_payload)
    rows = db.scalars(
        select(ProjectDeliverable)
        .where(ProjectDeliverable.project_id == project.id)
        .order_by(ProjectDeliverable.created_at.desc())
    ).all()
    return [_deliverable_out(row, db) for row in rows]


@router.post("/{project_uuid}/deliverables", response_model=ProjectDeliverableOut, status_code=201)
async def create_project_deliverable(
    project_uuid: str,
    body: ProjectDeliverableCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ProjectDeliverableOut:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _project(db, project_uuid, session_payload)
    task = None
    if body.task_uuid:
        task = db.scalar(select(ProjectTask).where(ProjectTask.project_id == project.id, ProjectTask.uuid == body.task_uuid))
        if task is None:
            raise HTTPException(status_code=404, detail="项目任务不存在")
    row = ProjectDeliverable(
        project_id=project.id,
        task_id=task.id if task else None,
        title=body.title,
        deliverable_type=body.deliverable_type,
        content_summary=body.content_summary,
        file_name=body.file_name,
        file_ref=body.file_ref,
        submitted_by=str(session_payload.user.id),
        created_by=str(session_payload.user.id),
    )
    db.add(row)
    db.flush()
    _activity(
        db,
        project.id,
        str(session_payload.user.id),
        action="project.deliverable.create",
        entity_type="deliverable",
        entity_uuid=row.uuid,
        summary=f"创建交付物：{row.title}",
    )
    _audit(db, session_payload, request, current_settings, action="project.deliverable.create", project_uuid=project.uuid, entity_uuid=row.uuid)
    db.commit()
    db.refresh(row)
    return _deliverable_out(row, db)


@router.post("/{project_uuid}/deliverables/{deliverable_uuid}/status", response_model=ProjectDeliverableOut)
async def update_project_deliverable_status(
    project_uuid: str,
    deliverable_uuid: str,
    body: ProjectDeliverableStatusIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ProjectDeliverableOut:
    await _require_ai_use(request, session_payload, current_settings)
    project, member = _project(db, project_uuid, session_payload)
    row = db.scalar(select(ProjectDeliverable).where(ProjectDeliverable.project_id == project.id, ProjectDeliverable.uuid == deliverable_uuid))
    if row is None:
        raise HTTPException(status_code=404, detail="项目交付物不存在")
    if body.status in {"approved", "rejected"}:
        require_project_manager(member)
    row.status = body.status
    if body.status == "approved":
        row.approved_by = str(session_payload.user.id)
        row.approved_at = datetime.now(UTC)
    elif body.status != "approved":
        row.approved_by = ""
        row.approved_at = None
    _activity(
        db,
        project.id,
        str(session_payload.user.id),
        action="project.deliverable.status",
        entity_type="deliverable",
        entity_uuid=row.uuid,
        summary=f"交付物状态更新为：{row.status}",
        metadata={"status": row.status},
    )
    _audit(db, session_payload, request, current_settings, action="project.deliverable.status", project_uuid=project.uuid, entity_uuid=row.uuid)
    db.commit()
    db.refresh(row)
    return _deliverable_out(row, db)


@router.get("/{project_uuid}/issues", response_model=list[ProjectIssueOut])
async def list_project_issues(
    project_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ProjectIssueOut]:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _project(db, project_uuid, session_payload)
    rows = db.scalars(
        select(ProjectIssue)
        .where(ProjectIssue.project_id == project.id)
        .order_by(ProjectIssue.created_at.desc())
    ).all()
    return [_issue_out(row) for row in rows]


@router.post("/{project_uuid}/issues", response_model=ProjectIssueOut, status_code=201)
async def create_project_issue(
    project_uuid: str,
    body: ProjectIssueCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ProjectIssueOut:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _project(db, project_uuid, session_payload)
    row = ProjectIssue(
        project_id=project.id,
        title=body.title,
        description=body.description,
        severity=body.severity,
        assignee_user_id=body.assignee_user_id,
        created_by=str(session_payload.user.id),
    )
    db.add(row)
    db.flush()
    _activity(
        db,
        project.id,
        str(session_payload.user.id),
        action="project.issue.create",
        entity_type="issue",
        entity_uuid=row.uuid,
        summary=f"创建问题：{row.title}",
    )
    _audit(db, session_payload, request, current_settings, action="project.issue.create", project_uuid=project.uuid, entity_uuid=row.uuid)
    db.commit()
    db.refresh(row)
    return _issue_out(row)


@router.post("/{project_uuid}/issues/{issue_uuid}/status", response_model=ProjectIssueOut)
async def update_project_issue_status(
    project_uuid: str,
    issue_uuid: str,
    body: ProjectIssueStatusIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ProjectIssueOut:
    await _require_ai_use(request, session_payload, current_settings)
    project, member = _project(db, project_uuid, session_payload)
    row = db.scalar(select(ProjectIssue).where(ProjectIssue.project_id == project.id, ProjectIssue.uuid == issue_uuid))
    if row is None:
        raise HTTPException(status_code=404, detail="项目问题不存在")
    if body.status in {"resolved", "closed"}:
        require_project_manager(member)
    row.status = body.status
    row.resolution = body.resolution
    if body.status in {"resolved", "closed"}:
        row.resolved_by = str(session_payload.user.id)
        row.resolved_at = datetime.now(UTC)
    else:
        row.resolved_by = ""
        row.resolved_at = None
    _activity(
        db,
        project.id,
        str(session_payload.user.id),
        action="project.issue.status",
        entity_type="issue",
        entity_uuid=row.uuid,
        summary=f"问题状态更新为：{row.status}",
        metadata={"status": row.status},
    )
    _audit(db, session_payload, request, current_settings, action="project.issue.status", project_uuid=project.uuid, entity_uuid=row.uuid)
    db.commit()
    db.refresh(row)
    return _issue_out(row)


@router.get("/{project_uuid}/activities", response_model=list[ProjectActivityOut])
async def list_project_activities(
    project_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ProjectActivityOut]:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _project(db, project_uuid, session_payload)
    rows = db.scalars(
        select(ProjectActivity)
        .where(ProjectActivity.project_id == project.id)
        .order_by(ProjectActivity.created_at.desc())
    ).all()
    return [
        ProjectActivityOut(
            activity_uuid=row.uuid,
            actor_user_id=row.actor_user_id,
            action=row.action,
            entity_type=row.entity_type,
            entity_uuid=row.entity_uuid,
            summary=row.summary,
            metadata=row.metadata_json,
            created_at=row.created_at,
        )
        for row in rows
    ]
