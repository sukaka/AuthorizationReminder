from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class UserPayload(BaseModel):
    id: int | str
    username: str
    role: str


class AuthScope(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    department: str | None = None
    managed_departments: list[str] = Field(default_factory=list, alias="managedDepartments")

    @staticmethod
    def _department_key(value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, dict):
            value = value.get("code") or value.get("name")
        normalized = str(value).strip()
        return normalized or None

    @field_validator("department", mode="before")
    @classmethod
    def normalize_department(cls, value: Any) -> str | None:
        return cls._department_key(value)

    @field_validator("managed_departments", mode="before")
    @classmethod
    def normalize_managed_departments(cls, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [
            key
            for item in value
            if (key := cls._department_key(item)) is not None
        ]


class SessionPayload(BaseModel):
    user: UserPayload
    scope: AuthScope
    apps: list[str]


class SessionOut(SessionPayload):
    local_binding_token: str


class LocalBindingVerifyIn(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    token: str = Field(min_length=1, max_length=4096)


class LocalBindingVerifyOut(BaseModel):
    user_id: str


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
    document_template_code: str = ""
    attachment_policy: dict[str, Any] | None = None
    fields: list[TaskFieldOut]


class CatalogAssistantOut(BaseModel):
    uuid: str
    code: str
    name: str
    description: str
    icon: str
    tasks: list[TaskOut]


class CatalogOut(BaseModel):
    assistants: list[CatalogAssistantOut]


class CapabilityOut(BaseModel):
    task_uuid: str
    task_code: str
    task_name: str
    assistant_name: str
    task_status: str
    input_fields: list[TaskFieldOut]
    output_format: str
    document_type: str
    prompt_binding_status: Literal["configured", "missing", "stale"]
    knowledge_link_count: int


class CapabilityListOut(BaseModel):
    items: list[CapabilityOut]


class IntentRouteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=500)


class IntentCandidateOut(BaseModel):
    task_uuid: str
    task_code: str
    task_name: str
    assistant_name: str
    score: int
    reasons: list[str]


class IntentRouteOut(BaseModel):
    candidates: list[IntentCandidateOut]


class PrepareGenerationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_uuid: str = Field(min_length=1, max_length=64)
    inputs: dict[str, object]
    attachment_uuids: list[str] = Field(default_factory=list, max_length=5)
    sensitive_confirmation_digest: str | None = Field(
        default=None,
        min_length=64,
        max_length=64,
    )


class MessageOut(BaseModel):
    role: str
    content: str


class ContextUsageOut(BaseModel):
    characters: int
    estimated_tokens: int
    estimator: str


class KnowledgeRefOut(BaseModel):
    uuid: str
    title: str
    matched_keywords: list[str] = Field(default_factory=list)
    score: int = 0
    priority: int = 0
    clipped: bool = False


class PrepareGenerationOut(BaseModel):
    generation_uuid: str
    completion_token: str
    messages: list[MessageOut]
    temperature: float = 0.3
    safety_notice: str
    context_usage: ContextUsageOut
    knowledge_refs: list[KnowledgeRefOut] = Field(default_factory=list)
    loop_trace: list[dict[str, Any]] = Field(default_factory=list)


class AttachmentOut(BaseModel):
    uuid: str
    name: str
    type: str
    size: int
    created_at: datetime
    attachment_uuid: str
    file_name: str
    file_type: str
    file_size: int
    status: str
    extracted_characters: int


class KnowledgeFileOut(BaseModel):
    file_uuid: str
    knowledge_base_id: str = ""
    file_name: str
    file_type: str
    file_size: int
    visibility: str
    status: str
    chunk_count: int
    created_at: datetime
    source_type: str = "user_upload"
    usage_type: str = "personal_reference"
    review_status: str = "draft"
    rag_enabled: bool = False
    reference_enabled: bool = True
    rag_scope: str = "personal"
    permission_scope: str = "private"
    category: str = "个人素材"
    document_type: str = "其他"
    tags: list[str] = Field(default_factory=list)
    parse_status: str = "parsed"
    index_status: str = "indexed"


class KnowledgeFileListOut(BaseModel):
    items: list[KnowledgeFileOut]
    total: int


class KnowledgeBaseCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=2_000)
    scope: Literal["personal", "company", "department", "project", "customer"] = "personal"
    department_id: str = Field(default="", max_length=64)
    project_id: str = Field(default="", max_length=64)


class KnowledgeBasePatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=2_000)
    scope: Literal["personal", "company", "department", "project", "customer"] | None = None
    department_id: str | None = Field(default=None, max_length=64)
    project_id: str | None = Field(default=None, max_length=64)


class KnowledgeBaseOut(BaseModel):
    base_id: str
    name: str
    description: str
    scope: str
    owner_user_id: str
    department_id: str
    project_id: str
    created_by: str
    created_at: datetime
    updated_at: datetime


class KnowledgeBaseListOut(BaseModel):
    items: list[KnowledgeBaseOut]
    total: int


class KnowledgeReviewSubmitIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    comment: str = Field(default="", max_length=2_000)


class KnowledgeReviewDecisionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    knowledge_base_id: str = Field(default="", max_length=64)
    comment: str = Field(default="", max_length=2_000)
    permission_scope: Literal["company", "department", "project", "admin"] = "company"
    rag_scope: Literal["company", "department", "project"] = "company"
    category: str = Field(default="", max_length=64)
    document_type: str = Field(default="", max_length=64)
    tags: list[str] = Field(default_factory=list, max_length=20)


class KnowledgeReviewLogOut(BaseModel):
    file_uuid: str
    file_name: str
    user_id: str
    reviewer_id: str
    action: str
    old_status: str
    new_status: str
    comment: str
    created_at: datetime


class KnowledgeReviewHistoryOut(BaseModel):
    items: list[KnowledgeReviewLogOut]
    total: int


class KnowledgeFilePatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: str | None = Field(default=None, max_length=64)
    document_type: str | None = Field(default=None, max_length=64)
    tags: list[str] | None = Field(default=None, max_length=20)
    reference_enabled: bool | None = None


class KnowledgeFileClassifyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    apply: bool = True


class KnowledgeFileClassifyOut(BaseModel):
    file_uuid: str
    category: str
    document_type: str
    tags: list[str] = Field(default_factory=list)
    applied: bool


class KnowledgeFilePreviewChunkOut(BaseModel):
    chunk_id: str
    chunk_index: int
    page_number: int | None = None
    section_title: str = ""
    text: str


class KnowledgeFilePreviewOut(BaseModel):
    file_uuid: str
    file_name: str
    source_kind: str
    chunks: list[KnowledgeFilePreviewChunkOut] = Field(default_factory=list)
    total_chunks: int
    notice: str


class ChatCitationOut(BaseModel):
    source_type: str
    file_uuid: str = ""
    file_name: str = ""
    chunk_id: str = ""
    page_number: int | None = None
    section_title: str = ""
    chunk_index: int | None = None
    score: int = 0


class ChatPrepareIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_uuid: str | None = Field(default=None, max_length=64)
    question: str = Field(min_length=1, max_length=20_000)
    mode: Literal[
        "normal",
        "sales",
        "business",
        "hr_admin",
        "presales",
        "delivery",
        "software_test",
        "pentest",
        "security_ops",
        "risk_assessment",
        "incident_response",
        "knowledge",
    ] = "normal"
    top_k: int | None = Field(default=8, ge=1, le=100)
    attachment_file_ids: list[str] = Field(default_factory=list, max_length=20)
    include_personal_references: bool = False
    include_session_attachments: bool = False


class ChatMessageOut(BaseModel):
    message_uuid: str
    role: Literal["user", "assistant"]
    content: str
    status: str
    citations: list[ChatCitationOut] = Field(default_factory=list)
    created_at: datetime


class ChatPrepareOut(BaseModel):
    session_uuid: str
    user_message_uuid: str
    assistant_message_uuid: str
    completion_token: str
    completed: bool
    answer: str = ""
    messages: list[MessageOut]
    citations: list[ChatCitationOut] = Field(default_factory=list)
    loop_trace: list[dict[str, Any]] = Field(default_factory=list)


class PersonalReferenceGenerateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: str | None = Field(default=None, max_length=64)
    question: str = Field(min_length=1, max_length=20_000)
    file_ids: list[str] = Field(default_factory=list, max_length=20)
    mode: Literal[
        "normal",
        "sales",
        "business",
        "hr_admin",
        "presales",
        "delivery",
        "software_test",
        "pentest",
        "security_ops",
        "risk_assessment",
        "incident_response",
        "knowledge",
    ] = "normal"
    top_k: int | None = Field(default=8, ge=1, le=100)


class PersonalReferenceSourceOut(BaseModel):
    source_kind: str
    file_id: str
    file_name: str
    chunk_id: str
    page_number: int | None = None
    section_title: str = ""
    chunk_index: int | None = None
    score: int = 0
    snippet: str = ""


class PersonalReferenceGenerateOut(BaseModel):
    answer: str = ""
    messages: list[MessageOut]
    sources: list[PersonalReferenceSourceOut] = Field(default_factory=list)
    notice: str


class PersonalReferenceSearchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: str | None = Field(default=None, max_length=64)
    question: str = Field(min_length=1, max_length=20_000)
    file_ids: list[str] = Field(default_factory=list, max_length=20)
    top_k: int | None = Field(default=8, ge=1, le=100)


class PersonalReferenceSearchOut(BaseModel):
    sources: list[PersonalReferenceSourceOut] = Field(default_factory=list)
    total: int
    notice: str


class KnowledgeQueryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1, max_length=20_000)
    mode: Literal[
        "normal",
        "sales",
        "business",
        "hr_admin",
        "presales",
        "delivery",
        "software_test",
        "pentest",
        "security_ops",
        "risk_assessment",
        "incident_response",
        "knowledge",
    ] = "knowledge"
    knowledge_base_ids: list[str] = Field(default_factory=list, max_length=20)
    filters: dict[str, list[str]] = Field(default_factory=dict)
    top_k: int | None = Field(default=8, ge=1, le=100)
    include_sources: bool = True


class KnowledgeSourceOut(BaseModel):
    source_kind: str
    file_id: str
    file_name: str
    page_number: int | None = None
    section_title: str = ""
    chunk_id: str = ""
    score: int = 0
    snippet: str = ""


class KnowledgeSearchOut(BaseModel):
    sources: list[KnowledgeSourceOut] = Field(default_factory=list)
    total: int


class KnowledgeAskOut(BaseModel):
    answer: str = ""
    messages: list[MessageOut] = Field(default_factory=list)
    sources: list[KnowledgeSourceOut] = Field(default_factory=list)
    notice: str = ""


class KnowledgeFileAskIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: str = Field(default="", max_length=20_000)
    mode: Literal[
        "normal",
        "sales",
        "business",
        "hr_admin",
        "presales",
        "delivery",
        "software_test",
        "pentest",
        "security_ops",
        "risk_assessment",
        "incident_response",
        "knowledge",
    ] = "normal"
    top_k: int | None = Field(default=8, ge=1, le=100)
    include_sources: bool = True


class LoopQualityCheckIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: str = Field(default="normal", max_length=64)
    answer: str = Field(min_length=1, max_length=2_000_000)
    used_knowledge: bool = False
    retry_count: int = Field(default=0, ge=0, le=10)
    messages: list[MessageOut] = Field(default_factory=list, max_length=64)


class LoopQualityCheckOut(BaseModel):
    passed: bool
    issues: list[str] = Field(default_factory=list)
    retry_allowed: bool
    revision_messages: list[MessageOut] = Field(default_factory=list)


class ChatCompleteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    completion_token: str = Field(min_length=1, max_length=256)
    answer: str = Field(min_length=1, max_length=2_000_000)
    model_display_name: str = Field(default="", max_length=128)
    model_id: str = Field(default="", max_length=128)
    usage: dict = Field(default_factory=dict)
    latency_ms: int | None = Field(default=None, ge=0)


class ChatFailIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    completion_token: str = Field(min_length=1, max_length=256)
    error_code: str = Field(min_length=1, max_length=64)
    error_message: str | None = Field(default=None, max_length=500)


class ChatMessageStatusOut(BaseModel):
    message_uuid: str
    status: str


class ExportWordSourceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_kind: str = Field(max_length=64)
    file_id: str = Field(max_length=64)
    file_name: str = Field(max_length=255)
    page_number: int | None = None
    section_title: str = Field(default="", max_length=255)
    chunk_id: str = Field(default="", max_length=64)
    score: int | None = None
    snippet: str = Field(default="", max_length=10_000)


class ChatKnowledgeResultIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: str | None = Field(default=None, max_length=64)
    question: str = Field(min_length=1, max_length=20_000)
    answer: str = Field(min_length=1, max_length=2_000_000)
    mode: Literal[
        "normal",
        "sales",
        "business",
        "hr_admin",
        "presales",
        "delivery",
        "software_test",
        "pentest",
        "security_ops",
        "risk_assessment",
        "incident_response",
        "knowledge",
    ] = "normal"
    sources: list[ExportWordSourceIn] = Field(default_factory=list, max_length=100)


class ChatKnowledgeResultOut(BaseModel):
    session_uuid: str
    user_message_uuid: str
    assistant_message_uuid: str


class ChatSessionItemOut(BaseModel):
    session_uuid: str
    title: str
    mode: str
    status: str
    created_at: datetime
    updated_at: datetime


class ChatSessionListOut(BaseModel):
    items: list[ChatSessionItemOut]
    total: int


class ChatSessionDetailOut(ChatSessionItemOut):
    messages: list[ChatMessageOut]


class ConversationBulkIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_ids: list[str] = Field(min_length=1, max_length=100)


class ConversationRenameIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=80)


class ConversationMutationOut(BaseModel):
    session_uuid: str
    status: Literal["active", "archived", "deleted"]


class ConversationBulkOut(BaseModel):
    affected: int


class ExportWordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conversation_id: str = Field(min_length=1, max_length=64)
    message_id: str | None = Field(default=None, max_length=64)
    selected_message_ids: list[str] = Field(default_factory=list, max_length=100)
    export_type: Literal[
        "single_answer",
        "selected_messages",
        "full_conversation",
        "formal_document",
    ]
    template: str = Field(default="juxin_standard", max_length=64)
    format_before_export: bool = False
    formatted_content: str | None = Field(default=None, max_length=2_000_000)


class ExportWordOut(BaseModel):
    file_name: str
    download_url: str


class ExportContentWordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=2_000_000)
    template: str = Field(default="juxin_standard", max_length=64)
    sources: list[ExportWordSourceIn] = Field(default_factory=list, max_length=100)


class CompleteGenerationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    completion_token: str = Field(min_length=1, max_length=256)
    output: str = Field(min_length=1, max_length=2_000_000)
    model_display_name: str = Field(max_length=128)
    model_id: str = Field(max_length=128)
    latency_ms: int = Field(ge=0, le=3_600_000)
    usage: dict[str, Any] = Field(default_factory=dict)


class CompleteGenerationOut(BaseModel):
    generation_uuid: str
    status: str


class GenerationFailureIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    completion_token: str = Field(min_length=1, max_length=256)
    error_code: str = Field(min_length=1, max_length=64)
    error_message: str | None = Field(default=None, max_length=500)


class LocalModelAuditEventIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generation_uuid: str = Field(min_length=1, max_length=64)
    event: Literal[
        "MODEL_STARTED",
        "MODEL_COMPLETED",
        "MODEL_CANCELLED",
        "MODEL_FAILED",
        "MODEL_SYNC_PENDING",
    ]
    model_id: str | None = Field(default=None, max_length=128)
    provider: str | None = Field(default=None, max_length=128)
    latency_ms: int | None = Field(default=None, ge=0, le=3_600_000)
    error_code: str | None = Field(default=None, max_length=64)


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
