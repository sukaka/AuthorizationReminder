from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .admin.route_common import write_request_audit
from .auth import get_session, require_action
from .config import Settings, get_settings
from .database import get_db
from .project_access import (
    PROJECT_MEMBER_ROLES,
    require_project_access,
    require_project_manager,
)
from .project_workspace_models import Project, ProjectMember
from .schemas import SessionPayload


router = APIRouter(prefix="/api/ai/projects", tags=["projects"])


class ProjectCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2000)

    @field_validator("name", "description", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ProjectMemberCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str = Field(min_length=1, max_length=64)
    role: Literal[
        "project_admin",
        "member",
        "reviewer",
        "read_only",
        "external_customer",
    ]

    @field_validator("user_id", mode="before")
    @classmethod
    def strip_user_id(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ProjectMemberUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal[
        "project_admin",
        "member",
        "reviewer",
        "read_only",
        "external_customer",
    ]


class ProjectMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    member_uuid: str
    user_id: str
    role: str
    status: str
    invited_by: str
    created_at: datetime


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    project_uuid: str
    name: str
    description: str
    status: str
    owner_user_id: str
    created_at: datetime
    updated_at: datetime


class ProjectDetailOut(ProjectOut):
    members: list[ProjectMemberOut]


def _project_out(project: Project) -> ProjectOut:
    return ProjectOut(
        project_uuid=project.uuid,
        name=project.name,
        description=project.description,
        status=project.status,
        owner_user_id=project.owner_user_id,
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def _member_out(member: ProjectMember) -> ProjectMemberOut:
    return ProjectMemberOut(
        member_uuid=member.uuid,
        user_id=member.user_id,
        role=member.role,
        status=member.status,
        invited_by=member.invited_by,
        created_at=member.created_at,
    )


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


@router.get("", response_model=list[ProjectOut])
async def list_projects(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ProjectOut]:
    await _require_ai_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    projects = db.scalars(
        select(Project)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(
            ProjectMember.user_id == user_id,
            ProjectMember.status == "active",
            Project.status == "active",
        )
        .order_by(Project.updated_at.desc(), Project.id.desc())
    ).all()
    return [_project_out(project) for project in projects]


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(
    body: ProjectCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ProjectOut:
    await _require_ai_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    project = Project(
        name=body.name,
        description=body.description,
        owner_user_id=user_id,
        created_by=user_id,
    )
    db.add(project)
    db.flush()
    db.add(
        ProjectMember(
            project_id=project.id,
            user_id=user_id,
            role="project_lead",
            invited_by=user_id,
        )
    )
    write_request_audit(
        db,
        session_payload,
        request,
        current_settings,
        action="project.create",
        entity_type="project",
        entity_uuid=project.uuid,
        metadata={"event": "project_created"},
    )
    db.commit()
    db.refresh(project)
    return _project_out(project)


@router.get("/{project_uuid}", response_model=ProjectDetailOut)
async def get_project(
    project_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ProjectDetailOut:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = require_project_access(
        db,
        project_uuid,
        str(session_payload.user.id),
    )
    members = db.scalars(
        select(ProjectMember)
        .where(
            ProjectMember.project_id == project.id,
            ProjectMember.status == "active",
        )
        .order_by(ProjectMember.id)
    ).all()
    return ProjectDetailOut(
        **_project_out(project).model_dump(),
        members=[_member_out(member) for member in members],
    )


@router.get("/{project_uuid}/members", response_model=list[ProjectMemberOut])
async def list_project_members(
    project_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ProjectMemberOut]:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = require_project_access(
        db,
        project_uuid,
        str(session_payload.user.id),
    )
    members = db.scalars(
        select(ProjectMember)
        .where(
            ProjectMember.project_id == project.id,
            ProjectMember.status == "active",
        )
        .order_by(ProjectMember.id)
    ).all()
    return [_member_out(member) for member in members]


@router.post(
    "/{project_uuid}/members",
    response_model=ProjectMemberOut,
    status_code=201,
)
async def add_project_member(
    project_uuid: str,
    body: ProjectMemberCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ProjectMemberOut:
    await _require_ai_use(request, session_payload, current_settings)
    project, current_member = require_project_access(
        db,
        project_uuid,
        str(session_payload.user.id),
    )
    require_project_manager(current_member)
    if body.role not in PROJECT_MEMBER_ROLES:
        raise HTTPException(status_code=422, detail="项目成员角色无效")
    existing = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == body.user_id,
        )
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="该用户已是项目成员")
    member = ProjectMember(
        project_id=project.id,
        user_id=body.user_id,
        role=body.role,
        invited_by=str(session_payload.user.id),
    )
    db.add(member)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="该用户已是项目成员") from exc
    write_request_audit(
        db,
        session_payload,
        request,
        current_settings,
        action="project.member.add",
        entity_type="project",
        entity_uuid=project.uuid,
        metadata={"event": "project_member_added"},
    )
    db.commit()
    db.refresh(member)
    return _member_out(member)


@router.patch(
    "/{project_uuid}/members/{member_uuid}",
    response_model=ProjectMemberOut,
)
async def update_project_member(
    project_uuid: str,
    member_uuid: str,
    body: ProjectMemberUpdateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ProjectMemberOut:
    await _require_ai_use(request, session_payload, current_settings)
    project, current_member = require_project_access(
        db,
        project_uuid,
        str(session_payload.user.id),
    )
    require_project_manager(current_member)
    member = db.scalar(
        select(ProjectMember).where(
            ProjectMember.uuid == member_uuid,
            ProjectMember.project_id == project.id,
            ProjectMember.status == "active",
        )
    )
    if member is None:
        raise HTTPException(status_code=404, detail="项目成员不存在")
    if member.user_id == project.owner_user_id or member.role == "project_lead":
        raise HTTPException(status_code=409, detail="不能修改项目负责人")
    if member.role in {"project_lead", "project_admin"} and body.role not in {
        "project_lead",
        "project_admin",
    }:
        manager_count = db.scalar(
            select(func.count()).select_from(ProjectMember).where(
                ProjectMember.project_id == project.id,
                ProjectMember.status == "active",
                ProjectMember.role.in_(PROJECT_MANAGER_ROLES),
            )
        ) or 0
        if manager_count <= 1:
            raise HTTPException(status_code=409, detail="项目至少需要一名项目管理员")
    previous_role = member.role
    member.role = body.role
    write_request_audit(
        db,
        session_payload,
        request,
        current_settings,
        action="project.member.update",
        entity_type="project",
        entity_uuid=project.uuid,
        metadata={
            "event": "project_member_role_updated",
            "member_uuid": member.uuid,
            "previous_role": previous_role,
            "role": member.role,
        },
    )
    db.commit()
    db.refresh(member)
    return _member_out(member)


@router.delete(
    "/{project_uuid}/members/{member_uuid}",
    status_code=204,
)
async def remove_project_member(
    project_uuid: str,
    member_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    await _require_ai_use(request, session_payload, current_settings)
    project, current_member = require_project_access(
        db,
        project_uuid,
        str(session_payload.user.id),
    )
    require_project_manager(current_member)
    member = db.scalar(
        select(ProjectMember).where(
            ProjectMember.uuid == member_uuid,
            ProjectMember.project_id == project.id,
            ProjectMember.status == "active",
        )
    )
    if member is None:
        raise HTTPException(status_code=404, detail="项目成员不存在")
    if member.user_id == project.owner_user_id or member.role == "project_lead":
        raise HTTPException(status_code=409, detail="不能移除项目负责人")
    member.status = "inactive"
    write_request_audit(
        db,
        session_payload,
        request,
        current_settings,
        action="project.member.remove",
        entity_type="project",
        entity_uuid=project.uuid,
        metadata={
            "event": "project_member_removed",
            "member_uuid": member.uuid,
            "user_id": member.user_id,
        },
    )
    db.commit()
