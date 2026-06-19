from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, model_validator


class UserPayload(BaseModel):
    id: int | str
    username: str
    role: str


class AuthScope(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    department: str | None = None
    managed_departments: list[str] = Field(default_factory=list, alias="managedDepartments")


class SessionPayload(BaseModel):
    user: UserPayload
    scope: AuthScope
    apps: list[str]


class TaskFieldOut(BaseModel):
    field_key: str
    label: str
    field_type: str
    required: bool
    placeholder: str = ""
    example: str = ""
    options: list[str] = Field(default_factory=list)
    validation: dict = Field(default_factory=dict)


class TaskOut(BaseModel):
    uuid: str
    code: str
    name: str
    description: str
    output_format: str
    safety_notice: str
    fields: list[TaskFieldOut]


class PrepareGenerationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_uuid: str = Field(min_length=1, max_length=64)
    inputs: dict[str, object]
    sensitive_confirmation_digest: str | None = Field(
        default=None,
        min_length=64,
        max_length=64,
    )


class MessageOut(BaseModel):
    role: str
    content: str


class PrepareGenerationOut(BaseModel):
    generation_uuid: str
    completion_token: str
    messages: list[MessageOut]
    temperature: float = 0.3
    safety_notice: str


class CompleteGenerationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    completion_token: str = Field(min_length=1, max_length=256)
    output: str = Field(min_length=1, max_length=2_000_000)
    model_display_name: str = Field(max_length=128)
    model_id: str = Field(max_length=128)
    latency_ms: int = Field(ge=0, le=3_600_000)
    usage: dict[str, int] = Field(default_factory=dict)


class CompleteGenerationOut(BaseModel):
    generation_uuid: str
    status: str


class HistoryItemOut(BaseModel):
    uuid: str
    task_uuid: str
    task_name: str
    assistant_code: str
    assistant_name: str
    status: str
    model_display_name: str
    model_id: str
    prompt_version: int
    latency_ms: int | None = None
    usage: dict = Field(default_factory=dict)
    created_at: datetime
    finished_at: datetime | None = None


class HistoryListOut(BaseModel):
    items: list[HistoryItemOut]
    total: int
    page: int
    page_size: int


class HistoryDetailOut(HistoryItemOut):
    parent_generation_uuid: str | None = None
    input: dict[str, object]
    output: str | None = None
    knowledge_refs: list[dict] = Field(default_factory=list)


class RegenerateOut(PrepareGenerationOut):
    parent_generation_uuid: str


class TaskCardOut(BaseModel):
    task_uuid: str
    task_code: str
    task_name: str
    description: str
    assistant_code: str
    assistant_name: str
    last_used_at: datetime | None = None


class HomeOut(BaseModel):
    favorites: list[TaskCardOut]
    recent_tasks: list[TaskCardOut]
    recent_generations: list[HistoryItemOut]
    safety_reminders: list[str]


class FeedbackType(str, Enum):
    USEFUL = "USEFUL"
    INACCURATE = "INACCURATE"
    WRONG_FORMAT = "WRONG_FORMAT"
    TOO_VAGUE = "TOO_VAGUE"
    NEEDS_EXPERTISE = "NEEDS_EXPERTISE"
    NOT_CLIENT_READY = "NOT_CLIENT_READY"
    OTHER = "OTHER"


class FeedbackIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    feedback_type: FeedbackType
    content: str | None = Field(default=None, max_length=4_000)

    @model_validator(mode="after")
    def validate_other_content(self) -> "FeedbackIn":
        if (
            self.feedback_type == FeedbackType.OTHER
            and not (self.content or "").strip()
        ):
            raise ValueError("OTHER 反馈必须填写补充说明")
        return self


class FeedbackOut(BaseModel):
    uuid: str
    generation_uuid: str
    feedback_type: FeedbackType
