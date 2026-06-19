from pydantic import BaseModel, ConfigDict, Field


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
