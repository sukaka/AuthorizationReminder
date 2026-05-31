from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class UserPayload(BaseModel):
    id: int | str | None = None
    username: str = "demo"
    role: str = "admin"
    app_access: list[str] = ["sca"]


class ComponentOut(BaseModel):
    id: int
    project_id: int
    package_name: str
    package_version: str
    ecosystem: str = "unknown"
    scope: str = "runtime"
    source_path: str = ""
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


class UploadSessionCreate(BaseModel):
    project_name: str
    scan_note: str = ""
    filename: str
    total_size: int
    total_chunks: int


class UploadFileOut(BaseModel):
    id: int
    upload_id: str
    project_id: int
    project_name: str
    original_filename: str
    file_size: int
    received_bytes: int
    total_chunks: int
    status: str
    scan_note: str
    created_by: str
    created_at: datetime


class UploadListOut(BaseModel):
    total: int
    items: list[UploadFileOut]


class ProjectListItem(BaseModel):
    id: int
    name: str
    scan_note: str
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ScanTaskOut(BaseModel):
    id: int
    project_id: int
    upload_file_id: int
    celery_task_id: str
    status: str
    summary: str
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class ScanLogOut(BaseModel):
    id: int
    scan_task_id: int
    level: str
    message: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DependencyTreeNode(BaseModel):
    id: str
    label: str
    ecosystem: str = ""
    version: str = ""
    children: list["DependencyTreeNode"] = Field(default_factory=list)
