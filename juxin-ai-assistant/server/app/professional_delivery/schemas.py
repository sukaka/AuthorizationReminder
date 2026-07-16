from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class DeliverableCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=255)
    deliverable_type: str = Field(min_length=1, max_length=48)
    scope_type: Literal["personal", "project"] = "personal"
    formality: Literal["working", "formal"] = "working"
    project_uuid: str | None = Field(default=None, max_length=36)
    skill_version_uuid: str = Field(min_length=1, max_length=36)
    template_version_uuid: str = Field(min_length=1, max_length=36)
    content: dict[str, Any]
    content_summary: str = Field(default="", max_length=4000)
    creation_reason: str = Field(default="manual", min_length=1, max_length=32)

    @field_validator(
        "title",
        "deliverable_type",
        "project_uuid",
        "skill_version_uuid",
        "template_version_uuid",
        "content_summary",
        "creation_reason",
        mode="before",
    )
    @classmethod
    def strip_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class DeliverableVersionCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_version: int = Field(ge=1)
    parent_version_uuid: str | None = Field(default=None, min_length=1, max_length=36)
    content: dict[str, Any]
    content_summary: str | None = Field(default=None, max_length=4000)
    change_summary: str = Field(min_length=1, max_length=4000)
    creation_reason: str = Field(default="manual_edit", min_length=1, max_length=32)

    @field_validator(
        "parent_version_uuid",
        "content_summary",
        "change_summary",
        "creation_reason",
        mode="before",
    )
    @classmethod
    def strip_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class DeliverableMetadataUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_version: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=255)

    @field_validator("title", mode="before")
    @classmethod
    def strip_title(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class DeliverableVersionOut(BaseModel):
    version_uuid: str
    version_no: int
    parent_version_uuid: str | None
    skill_version_uuid: str
    template_version_uuid: str
    title_snapshot: str
    summary_snapshot: str
    change_summary: str
    creation_reason: str
    content: dict[str, Any]
    content_hash: str
    created_at: datetime


class DeliverableVersionCreateOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    version: DeliverableVersionOut


class DeliverableDraftUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_version: int = Field(ge=1)
    base_version_uuid: str = Field(min_length=1, max_length=36)
    draft_revision: int = Field(ge=0)
    content: dict[str, Any]
    content_summary: str = Field(default="", max_length=4000)
    fencing_token: int | None = Field(default=None, ge=1)


class DeliverableDraftOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    draft_uuid: str
    base_version_uuid: str
    row_version: int
    draft_revision: int
    content: dict[str, Any]
    content_hash: str
    content_summary: str
    updated_by: str
    updated_at: datetime


class DeliverableDocxImportOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    source_file_name: str
    content: dict[str, Any]
    warnings: list[str]
    media_count: int
    import_report: dict[str, Any] | None = None


class DeliverableMediaAssetOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    asset_uuid: str
    original_file_name: str
    media_type: str
    size_bytes: int
    download_url: str
    replayed: bool


class DeliverableLeaseOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    lease_uuid: str
    owner_user_id: str
    fencing_token: int
    expires_at: datetime


class DeliverableLeaseAcquireIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_version: int = Field(ge=1)
    base_version_uuid: str = Field(min_length=1, max_length=36)


class DeliverableLeaseHeartbeatIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fencing_token: int = Field(ge=1)


class DeliverableCommitIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_version: int = Field(ge=1)
    base_version_uuid: str = Field(min_length=1, max_length=36)
    draft_revision: int = Field(ge=0)
    change_summary: str = Field(min_length=1, max_length=4000)
    creation_reason: str = Field(default="manual_edit", min_length=1, max_length=32)
    fencing_token: int | None = Field(default=None, ge=1)


class DeliverableVersionDetailOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    version: DeliverableVersionOut


class DeliverableVersionHistoryItemOut(BaseModel):
    version_uuid: str
    version_no: int
    parent_version_uuid: str | None
    skill_version_uuid: str
    template_version_uuid: str
    title_snapshot: str
    summary_snapshot: str
    change_summary: str
    creation_reason: str
    content_hash: str
    created_by: str
    created_at: datetime
    is_current: bool
    is_approved: bool
    is_delivered: bool


class DeliverableVersionHistoryOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    items: list[DeliverableVersionHistoryItemOut]
    total: int
    page: int
    page_size: int


class DeliverableFieldChangeOut(BaseModel):
    path: str
    change_type: Literal["added", "removed", "modified"]
    before: Any | None = None
    after: Any | None = None


class DeliverableBlockChangeOut(BaseModel):
    block_id: str
    block_type: str
    change_type: Literal["added", "removed", "modified"]
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    field_changes: list[DeliverableFieldChangeOut] = Field(default_factory=list)


class DeliverableDiffSummaryOut(BaseModel):
    added_blocks: int
    removed_blocks: int
    modified_blocks: int
    unchanged_blocks: int


class DeliverableVersionDiffOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    from_version_uuid: str
    from_version_no: int
    to_version_uuid: str
    to_version_no: int
    summary: DeliverableDiffSummaryOut
    changes: list[DeliverableBlockChangeOut]


class DeliverableSourceChangeNoticeOut(BaseModel):
    message: str
    affected_evidence_count: int
    historical_snapshot_preserved: bool


class DeliverableDetailOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    title: str
    deliverable_type: str
    scope_type: str
    formality: str
    project_uuid: str | None
    owner_user_id: str
    lifecycle_status: str
    row_version: int
    content_summary: str
    allowed_actions: list[str]
    current_version: DeliverableVersionOut
    source_change_notice: DeliverableSourceChangeNoticeOut | None = None
    created_at: datetime
    updated_at: datetime


class DeliverableEvidenceRefreshOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    lifecycle_status: str
    row_version: int
    invalidated_evidence_uuids: list[str]
    source_change_notice: DeliverableSourceChangeNoticeOut | None = None


class DeliverableSummaryOut(BaseModel):
    deliverable_uuid: str
    title: str
    deliverable_type: str
    scope_type: str
    formality: str
    project_uuid: str | None
    owner_user_id: str
    lifecycle_status: str
    row_version: int
    content_summary: str
    allowed_actions: list[str]
    created_at: datetime
    updated_at: datetime


class DeliverableListOut(BaseModel):
    request_id: str
    items: list[DeliverableSummaryOut]
    total: int
    page: int
    page_size: int


class ReviewStartIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_version: int = Field(ge=1)
    version_uuid: str = Field(min_length=1, max_length=36)
    content_hash: str = Field(min_length=64, max_length=64)

    @field_validator("version_uuid", "content_hash", mode="before")
    @classmethod
    def strip_review_target(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ReviewIssueUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["resolved", "accepted_risk", "wont_fix"]
    reason: str = Field(min_length=1, max_length=2000)

    @field_validator("reason", mode="before")
    @classmethod
    def strip_reason(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class QualityCategoryResultOut(BaseModel):
    category: str
    status: Literal["passed", "failed"]
    rule_count: int
    issue_count: int
    blocking_issue_count: int
    duration_ms: int


class ReviewIssueOut(BaseModel):
    issue_uuid: str
    review_uuid: str
    rule_version_uuid: str
    category: str
    severity: Literal["info", "warning", "error", "blocker"]
    blocking: bool
    block_id: str
    char_start: int | None
    char_end: int | None
    message: str
    evidence_ids: list[str]
    suggested_fix: str
    status: Literal["open", "accepted_risk", "resolved", "wont_fix"]
    handled_by: str
    handling_reason: str
    handled_at: datetime | None
    created_at: datetime


class ReviewRunOut(BaseModel):
    review_uuid: str
    version_uuid: str
    version_no: int
    content_hash: str
    status: Literal["passed", "failed"]
    gates_passed: bool
    total_score: int
    rule_version_uuids: list[str]
    category_results: list[QualityCategoryResultOut]
    issues: list[ReviewIssueOut]
    initiated_by: str
    completed_at: datetime | None
    created_at: datetime


class ReviewCreateOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    lifecycle_status: str
    row_version: int
    review: ReviewRunOut


class ReviewHistoryOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    items: list[ReviewRunOut]
    total: int
    page: int
    page_size: int


class ReviewIssueUpdateOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    issue: ReviewIssueOut


class ExactDeliverableVersionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_version: int = Field(ge=1)
    version_uuid: str = Field(min_length=1, max_length=36)
    content_hash: str = Field(min_length=64, max_length=64)

    @field_validator("version_uuid", "content_hash", mode="before")
    @classmethod
    def strip_exact_target(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class DeliverableSubmitIn(ExactDeliverableVersionIn):
    approval_flow_version_uuid: str = Field(min_length=1, max_length=36)

    @field_validator("approval_flow_version_uuid", mode="before")
    @classmethod
    def strip_flow_version(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class DeliverableApproveIn(ExactDeliverableVersionIn):
    pass


class DeliverableRequestChangesIn(ExactDeliverableVersionIn):
    reason: str = Field(min_length=1, max_length=2000)
    comment_uuids: list[str] = Field(min_length=1, max_length=100)

    @field_validator("reason", mode="before")
    @classmethod
    def strip_change_reason(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("comment_uuids", mode="before")
    @classmethod
    def normalize_comment_uuids(cls, value: object) -> object:
        if not isinstance(value, list):
            return value
        return [item.strip() if isinstance(item, str) else item for item in value]


class DeliverableCommentCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version_uuid: str = Field(min_length=1, max_length=36)
    block_id: str = Field(min_length=1, max_length=128)
    char_start: int | None = Field(default=None, ge=0)
    char_end: int | None = Field(default=None, ge=0)
    content: str = Field(min_length=1, max_length=8000)

    @field_validator("version_uuid", "block_id", "content", mode="before")
    @classmethod
    def strip_comment_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class DeliverableCommentReplyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1, max_length=8000)

    @field_validator("content", mode="before")
    @classmethod
    def strip_reply_content(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class DeliverableCommentResolveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=2000)

    @field_validator("reason", mode="before")
    @classmethod
    def strip_resolution_reason(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class DeliverableDeliverIn(ExactDeliverableVersionIn):
    export_uuid: str = Field(min_length=1, max_length=36)
    recipient_description: str = Field(min_length=1, max_length=1000)
    note: str = Field(default="", max_length=4000)

    @field_validator("export_uuid", "recipient_description", "note", mode="before")
    @classmethod
    def strip_delivery_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class DeliverableExportCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_version: int = Field(ge=1)
    content_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    export_format: Literal["docx"] = "docx"

    @field_validator("content_hash", mode="before")
    @classmethod
    def strip_export_hash(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class DeliverableExportOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    export_uuid: str
    version_uuid: str
    version_no: int
    content_hash: str
    export_format: str
    status: str
    watermarked: bool
    file_name: str
    file_hash: str
    file_size: int
    renderer_version: str
    download_url: str
    created_by: str
    created_at: datetime
    export_report: dict[str, Any] | None = None


class DeliverableArchiveIn(ExactDeliverableVersionIn):
    delivery_uuid: str = Field(min_length=1, max_length=36)

    @field_validator("delivery_uuid", mode="before")
    @classmethod
    def strip_delivery_uuid(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ApprovalEventOut(BaseModel):
    event_uuid: str
    event_type: str
    version_uuid: str
    approval_flow_version_uuid: str | None
    content_hash: str
    actor_user_id: str
    comment_uuids: list[str]
    row_version_before: int
    row_version_after: int
    created_at: datetime


class DeliverableApprovalActionOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    lifecycle_status: str
    row_version: int
    event: ApprovalEventOut


class DeliverableCommentReplyOut(BaseModel):
    reply_uuid: str
    content: str
    author_user_id: str
    created_at: datetime


class DeliverableCommentOut(BaseModel):
    comment_uuid: str
    version_uuid: str
    block_id: str
    char_start: int | None
    char_end: int | None
    content: str
    status: str
    author_user_id: str
    resolved_by: str
    resolved_at: datetime | None
    resolution_reason: str
    allowed_actions: list[str]
    replies: list[DeliverableCommentReplyOut]
    created_at: datetime


class DeliverableCommentMutationOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    comment: DeliverableCommentOut


class DeliverableCommentListOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    items: list[DeliverableCommentOut]
    total: int


class DeliveryRecordOut(BaseModel):
    delivery_uuid: str
    version_uuid: str
    export_uuid: str
    content_hash: str
    delivered_by: str
    recipient_description: str
    note: str
    delivered_at: datetime


class DeliverableDeliveryOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    lifecycle_status: str
    row_version: int
    delivery: DeliveryRecordOut


class ExperienceCandidateCreateIn(ExactDeliverableVersionIn):
    candidate_type: Literal["structure", "rule", "template"]
    deidentified_summary: str = Field(min_length=1, max_length=2000)

    @field_validator("deidentified_summary", mode="before")
    @classmethod
    def strip_deidentified_summary(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ExperienceCandidateOut(BaseModel):
    candidate_uuid: str
    candidate_type: str
    status: str
    source_scope_type: str
    source_project_uuid: str | None
    version_uuid: str
    content_hash: str
    deidentified_summary: str
    submitted_by: str
    created_at: datetime


class ExperienceCandidateCreateOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    candidate: ExperienceCandidateOut
