from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserPayload(BaseModel):
    id: int | str | None = None
    username: str = "demo"
    role: str = "admin"
    app_access: list[str] = ["sca"]


class ComponentOut(BaseModel):
    id: int
    package_name: str
    package_version: str
    license_name: str
    vulnerability_status: str

    model_config = ConfigDict(from_attributes=True)


class ProjectOut(BaseModel):
    id: int
    name: str
    repository_url: str
    risk_level: str
    status: str
    owner: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class OverviewOut(BaseModel):
    project_count: int
    component_count: int
    high_risk_count: int
    pending_component_count: int
    recent_projects: list[ProjectOut]
    user: UserPayload
