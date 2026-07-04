from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, RootModel, model_validator

CODE_PATTERN = r"^[a-z][a-z0-9_-]{1,95}$"


class TaskStatus(StrEnum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    DISABLED = "DISABLED"


class FieldType(StrEnum):
    TEXT = "TEXT"
    TEXTAREA = "TEXTAREA"
    SELECT = "SELECT"
    MULTISELECT = "MULTISELECT"
    NUMBER = "NUMBER"
    DATE = "DATE"
    SWITCH = "SWITCH"
    FILE_RESERVED = "FILE_RESERVED"


class TaskCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    assistant_uuid: str = Field(min_length=1, max_length=36)
    code: str = Field(pattern=CODE_PATTERN)
    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=20_000)
    output_format: str = Field(default="Markdown", max_length=2_000)
    safety_notice: str = Field(default="生成内容需人工复核", max_length=2_000)
    sort_order: int = Field(default=0, ge=-100_000, le=100_000)


class TaskUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=20_000)
    output_format: str | None = Field(default=None, max_length=2_000)
    safety_notice: str | None = Field(default=None, max_length=2_000)
    sort_order: int | None = Field(default=None, ge=-100_000, le=100_000)
    status: TaskStatus | None = None


class TaskFieldIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    field_key: str = Field(pattern=CODE_PATTERN)
    label: str = Field(min_length=1, max_length=128)
    field_type: FieldType
    required: bool = False
    placeholder: str = Field(default="", max_length=512)
    example: str = Field(default="", max_length=20_000)
    options: list[str] = Field(default_factory=list, max_length=200)
    validation: dict[str, str | int | float | bool] = Field(default_factory=dict)
    sort_order: int = Field(default=0, ge=-100_000, le=100_000)


class TaskFieldsReplaceIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    fields: list[TaskFieldIn] = Field(max_length=200)

    @model_validator(mode="after")
    def validate_unique_keys(self) -> "TaskFieldsReplaceIn":
        keys = [item.field_key for item in self.fields]
        if len(keys) != len(set(keys)):
            raise ValueError("字段键不能重复")
        return self


class VersionPolicy(StrEnum):
    PUBLISHED = "PUBLISHED"
    PINNED = "PINNED"


class PromptBindingIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    prompt_external_id: int = Field(gt=0)
    version_policy: VersionPolicy = VersionPolicy.PUBLISHED
    pinned_version: int | None = Field(default=None, gt=0)
    status: str = Field(default="ACTIVE", pattern=r"^(ACTIVE|DISABLED)$")

    @model_validator(mode="after")
    def validate_pinned_version(self) -> "PromptBindingIn":
        if self.version_policy is VersionPolicy.PINNED and self.pinned_version is None:
            raise ValueError("PINNED 策略必须指定版本")
        if self.version_policy is VersionPolicy.PUBLISHED and self.pinned_version is not None:
            raise ValueError("PUBLISHED 策略不能指定固定版本")
        return self


class TaskConfigurationIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    task: TaskUpdateIn
    fields: list[TaskFieldIn] = Field(max_length=200)
    prompt_binding: PromptBindingIn

    @model_validator(mode="after")
    def validate_unique_field_keys(self) -> "TaskConfigurationIn":
        TaskFieldsReplaceIn(fields=self.fields)
        return self


class TaskFieldAdminOut(BaseModel):
    field_key: str
    label: str
    field_type: str
    required: bool
    placeholder: str
    example: str
    options: list[str]
    validation: dict[str, str | int | float | bool]
    sort_order: int


class PromptBindingOut(BaseModel):
    prompt_external_id: int
    version_policy: str
    pinned_version: int | None
    status: str


class TaskAdminOut(BaseModel):
    uuid: str
    assistant_uuid: str
    code: str
    name: str
    description: str
    output_format: str
    safety_notice: str
    sort_order: int
    status: str
    fields: list[TaskFieldAdminOut]
    prompt_binding: PromptBindingOut | None


class TaskAdminListOut(BaseModel):
    items: list[TaskAdminOut]
    total: int


JsonScalar = str | int | float | bool | None


class KnowledgeCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    title: str = Field(min_length=1, max_length=255)
    category: str
    tags: list[str] = Field(default_factory=list, max_length=100)
    keywords: list[str] = Field(default_factory=list, max_length=100)
    content: str = Field(min_length=1, max_length=2_000_000)
    task_uuids: list[str] = Field(default_factory=list, max_length=200)
    priority: int = Field(default=0, ge=-100_000, le=100_000)


class KnowledgeUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    title: str | None = Field(default=None, min_length=1, max_length=255)
    category: str | None = None
    tags: list[str] | None = Field(default=None, max_length=100)
    keywords: list[str] | None = Field(default=None, max_length=100)
    content: str | None = Field(default=None, min_length=1, max_length=2_000_000)
    task_uuids: list[str] | None = Field(default=None, max_length=200)
    priority: int | None = Field(default=None, ge=-100_000, le=100_000)
    status: str | None = Field(default=None, pattern=r"^(ACTIVE|DISABLED)$")


class KnowledgeOut(BaseModel):
    uuid: str
    title: str
    category: str
    tags: list[str]
    keywords: list[str]
    priority: int
    status: str
    task_uuids: list[str]
    content: str | None = None


class KnowledgeListOut(BaseModel):
    items: list[KnowledgeOut]
    total: int


class SettingsUpdateIn(RootModel[dict[str, JsonScalar]]):
    model_config = ConfigDict(frozen=True)


class SuggestionType(StrEnum):
    COMMON_TASK_CHANGE = "COMMON_TASK_CHANGE"
    PROMPT_CHANGE = "PROMPT_CHANGE"


class SuggestionCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    department_code: str = Field(min_length=1, max_length=128)
    suggestion_type: SuggestionType
    task_uuid: str | None = Field(default=None, max_length=36)
    content: str = Field(min_length=1, max_length=100_000)


class ReviewDecision(StrEnum):
    APPROVE = "APPROVE"
    REJECT = "REJECT"


class SuggestionReviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    decision: ReviewDecision
    comment: str | None = Field(default=None, max_length=20_000)


class SuggestionOut(BaseModel):
    uuid: str
    sso_user_id: str
    department_code: str
    suggestion_type: str
    task_uuid: str | None
    status: str
    reviewed_by: str | None
    reviewed_at: datetime | None
    content: str | None = None
    review_comment: str | None = None


class SuggestionListOut(BaseModel):
    items: list[SuggestionOut]
    total: int


class CountByName(BaseModel):
    name: str
    count: int


class DailyCount(BaseModel):
    date: str
    count: int


class StatsOut(BaseModel):
    departments: list[str]
    total: int
    completed: int
    failed: int
    completion_rate: float
    failure_rate: float
    by_department: dict[str, int]
    task_ranking: list[CountByName]
    daily_trend: list[DailyCount]
    feedback_distribution: dict[str, int]
    tool_call_total: int = 0
    tool_call_success: int = 0
    tool_call_success_rate: float = 0.0
    knowledge_search_total: int = 0
    knowledge_search_hit: int = 0
    knowledge_search_hit_rate: float = 0.0
    assistant_answer_total: int = 0
    assistant_answer_with_sources: int = 0
    citation_coverage_rate: float = 0.0
    answer_without_source_rate: float = 0.0
    word_export_total: int = 0
    tool_error_distribution: dict[str, int] = {}


class AuditLogOut(BaseModel):
    id: int
    sso_user_id: str
    username_snapshot: str
    action: str
    entity_type: str
    entity_uuid: str
    result: str
    metadata_json: dict[
        str,
        JsonScalar
        | list[JsonScalar]
        | dict[str, JsonScalar | dict[str, JsonScalar]],
    ]
    created_at: datetime


class AuditLogListOut(BaseModel):
    items: list[AuditLogOut]
    total: int


# Desktop Update Publishing schemas

class DesktopUpdateCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    agent_version: str = Field(min_length=1, max_length=32)
    channel: str = Field(min_length=1, max_length=16)
    release_notes: str = Field(default="", max_length=20_000)


class DesktopUpdateReleaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    uuid: str
    agent_version: str
    channel: str
    status: str
    release_notes: str
    created_by: str
    created_at: datetime
    published_at: datetime | None = None
    withdrawn_at: datetime | None = None


class DesktopUpdateArtifactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    target: str
    file_name: str
    content_type: str
    size_bytes: int
    sha256: str
    created_at: datetime


class DesktopUpdateReleaseDetailOut(DesktopUpdateReleaseOut):
    artifacts: list[DesktopUpdateArtifactOut] = Field(default_factory=list)
