from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ProfessionalRunStartIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_version: int = Field(ge=1)
    source_version_uuid: str = Field(min_length=1, max_length=36)
    inputs: dict[str, Any] = Field(default_factory=dict)
    resource_refs: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    model_profile_uuid: str = Field(min_length=1, max_length=64)
    max_steps: int = Field(default=16, ge=1, le=64)
    max_model_calls: int = Field(default=2, ge=1, le=2)

    @field_validator("source_version_uuid", "model_profile_uuid", mode="before")
    @classmethod
    def strip_identifiers(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ProfessionalRunInputIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inputs: dict[str, Any]


class ProfessionalModelResultIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    one_time_token: str = Field(min_length=1, max_length=512)
    request_hash: str = Field(min_length=64, max_length=64)
    content: dict[str, Any]
    content_hash: str = Field(min_length=64, max_length=64)
    summary: str = Field(min_length=1, max_length=4000)
    model_metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator(
        "one_time_token",
        "request_hash",
        "content_hash",
        "summary",
        mode="before",
    )
    @classmethod
    def strip_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class PendingModelRequestOut(BaseModel):
    step_uuid: str
    request_hash: str
    one_time_token: str | None = None
    model_profile_uuid: str
    system_prompt: str
    instructions: list[str] = Field(default_factory=list)
    inputs: dict[str, Any]
    output_schema: dict[str, Any]
    context: dict[str, Any]


class ProfessionalRunOut(BaseModel):
    run_uuid: str
    deliverable_uuid: str
    status: Literal[
        "pending",
        "running",
        "waiting_for_input",
        "waiting_for_model",
        "completed",
        "failed",
        "cancelled",
    ]
    phase: str
    source_version_uuid: str
    skill_version_uuid: str
    template_version_uuid: str
    context_hash: str
    missing_fields: list[str] = Field(default_factory=list)
    pending_model_request: PendingModelRequestOut | None = None
    created_version: dict[str, Any] | None = None
    quality_review: dict[str, Any] | None = None
    replayed: bool = False


class ProfessionalAgentRunSummaryOut(BaseModel):
    run_id: str
    title: str
    run_type: str
    status: str
    stage: str
    progress: int = Field(ge=0, le=100)
    artifact: dict[str, Any] | None = None
    citations: list[dict[str, Any]] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ProfessionalAgentRunStepOut(BaseModel):
    step_id: str
    run_id: str
    sequence: int = Field(ge=1)
    step_type: str
    status: str
    role: str
    summary: str


class ProfessionalAgentRunEventOut(BaseModel):
    event_id: str
    run_id: str
    sequence: int = Field(ge=1)
    event_type: Literal[
        "stage",
        "delta",
        "source",
        "review",
        "completed",
        "failed",
        "cancelled",
    ]
    stage: str | None = None
    label: str
    progress: int | None = Field(default=None, ge=0, le=100)
    content: str
    source: dict[str, Any] | None = None
    artifact_id: str
    quality: dict[str, Any] | None = None


class ProfessionalRunStageOut(BaseModel):
    key: str
    label: str
    status: Literal[
        "pending",
        "running",
        "waiting",
        "succeeded",
        "failed",
        "cancelled",
    ]
    duration_ms: int = Field(ge=0)
    summary: str
    recover_action: Literal[
        "supply_input",
        "resume",
        "open_deliverable",
    ] | None = None


class ProfessionalRunProjectionOut(BaseModel):
    run_uuid: str
    deliverable_uuid: str
    status: str
    phase: str
    source_version_uuid: str
    skill_version_uuid: str
    template_version_uuid: str
    context_hash: str
    missing_fields: list[str] = Field(default_factory=list)
    pending_model_request: PendingModelRequestOut | None = None
    created_version_uuid: str | None = None
    quality_review: dict[str, Any] | None = None
    allowed_actions: list[str] = Field(default_factory=list)
    stages: list[ProfessionalRunStageOut] = Field(default_factory=list)


class ProfessionalRunDetailOut(BaseModel):
    run: ProfessionalAgentRunSummaryOut
    steps: list[ProfessionalAgentRunStepOut] = Field(default_factory=list)
    events: list[ProfessionalAgentRunEventOut] = Field(default_factory=list)
    result: dict[str, Any] = Field(default_factory=dict)
    professional: ProfessionalRunProjectionOut
