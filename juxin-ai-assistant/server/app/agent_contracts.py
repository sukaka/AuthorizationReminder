from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, model_validator


class _PublicContract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AgentRunStatus(str, Enum):
    """Public run lifecycle aligned with the current 5.0 product contract.

    Product UI calls these "任务"; API/DB use run terminology.
    """

    CREATED = "created"
    QUEUED = "queued"
    RUNNING = "running"
    WAITING_USER = "waiting_user"
    WAITING_CONFIRMATION = "waiting_confirmation"
    PAUSED = "paused"
    RETRYING = "retrying"
    SUCCEEDED = "succeeded"
    # Plan synonym kept for API consumers that expect completed.
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class AgentRunStage(str, Enum):
    ACCEPTED = "accepted"
    ROUTING = "routing"
    RETRIEVING = "retrieving"
    PLANNING = "planning"
    EXECUTING = "executing"
    REVIEWING = "reviewing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class AgentEventType(str, Enum):
    STAGE = "stage"
    DELTA = "delta"
    SOURCE = "source"
    REVIEW = "review"
    WAITING_USER = "waiting_user"
    ARTIFACT = "artifact"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class AgentCitationContract(_PublicContract):
    citation_id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=255)
    location: str = Field(default="", max_length=255)
    source_type: str = Field(default="", max_length=32)
    document_version: str = Field(default="", max_length=64)
    page: int | None = Field(default=None, ge=1)
    section: str = Field(default="", max_length=255)
    is_inference: bool = False


class AgentArtifactContract(_PublicContract):
    artifact_id: str = Field(min_length=1, max_length=128)
    artifact_type: str = Field(min_length=1, max_length=48)
    title: str = Field(min_length=1, max_length=255)
    status: str = Field(min_length=1, max_length=24)
    version: int = Field(default=1, ge=1)
    format: str = Field(default="", max_length=48)
    mime_type: str = Field(default="", max_length=128)
    download_ref: str = Field(default="", max_length=1024)
    downloadable: bool = False
    editable: bool = False


class AgentQualityContract(_PublicContract):
    passed: bool
    issues: list[str] = Field(default_factory=list, max_length=20)


class AgentRunContract(_PublicContract):
    run_id: str = Field(min_length=1, max_length=64)
    conversation_id: str = Field(default="", max_length=64)
    title: str = Field(default="AI 任务", max_length=255)
    run_type: str = Field(default="chat", max_length=48)
    status: AgentRunStatus
    stage: AgentRunStage
    progress: int = Field(default=0, ge=0, le=100)
    attempt: int = Field(default=1, ge=1)
    requires_user_action: bool = False
    next_action: str = Field(default="", max_length=500)
    error_code: str = Field(default="", max_length=64)
    error_message: str = Field(default="", max_length=500)
    retry_allowed: bool = False
    cancel_allowed: bool = False
    artifact: AgentArtifactContract | None = None
    citations: list[AgentCitationContract] = Field(default_factory=list, max_length=200)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class AgentStepContract(_PublicContract):
    step_id: str = Field(min_length=1, max_length=64)
    run_id: str = Field(min_length=1, max_length=64)
    sequence: int = Field(ge=1)
    step_type: str = Field(min_length=1, max_length=64)
    status: str = Field(min_length=1, max_length=24)
    role: str = Field(default="", max_length=48)
    summary: str = Field(default="", max_length=2000)
    attempt: int = Field(default=1, ge=1)
    retryable: bool = False
    error_code: str = Field(default="", max_length=64)
    error_message: str = Field(default="", max_length=500)


class AgentEventContract(_PublicContract):
    event_id: str = Field(min_length=1, max_length=64)
    run_id: str = Field(min_length=1, max_length=64)
    sequence: int = Field(ge=1)
    event_type: AgentEventType
    stage: AgentRunStage | None = None
    label: str = Field(default="", max_length=255)
    progress: int | None = Field(default=None, ge=0, le=100)
    content: str = Field(default="", max_length=20_000)
    source: AgentCitationContract | None = None
    artifact_id: str = Field(default="", max_length=128)
    artifact: AgentArtifactContract | None = None
    next_action: str = Field(default="", max_length=500)
    quality: AgentQualityContract | None = None

    @model_validator(mode="after")
    def validate_public_payload(self) -> "AgentEventContract":
        if self.event_type is AgentEventType.SOURCE and self.source is None:
            raise ValueError("source_event_requires_source")
        if self.event_type is AgentEventType.DELTA and not self.content:
            raise ValueError("delta_event_requires_content")
        if self.event_type is AgentEventType.ARTIFACT and self.artifact is None:
            raise ValueError("artifact_event_requires_artifact")
        if self.event_type is AgentEventType.WAITING_USER and not self.next_action:
            raise ValueError("waiting_user_event_requires_next_action")
        return self
