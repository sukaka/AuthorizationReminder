from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .project_workspace_models import Project, ProjectMember


PROJECT_MEMBER_ROLES = frozenset(
    {
        "project_lead",
        "project_admin",
        "member",
        "reviewer",
        "read_only",
        "external_customer",
    }
)
PROJECT_MANAGER_ROLES = frozenset({"project_lead", "project_admin"})


def require_project_access(
    db: Session,
    project_uuid: str,
    user_id: str,
) -> tuple[Project, ProjectMember]:
    project = db.scalar(select(Project).where(Project.uuid == project_uuid))
    if project is None:
        raise HTTPException(status_code=404, detail="项目不存在")
    member = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == user_id,
            ProjectMember.status == "active",
        )
    )
    if member is None:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project, member


def require_project_manager(member: ProjectMember) -> None:
    if member.role not in PROJECT_MANAGER_ROLES:
        raise HTTPException(status_code=403, detail="仅项目负责人或项目管理员可管理成员")
