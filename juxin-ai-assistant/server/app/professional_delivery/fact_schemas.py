from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


ClaimType = Literal["fact", "analysis", "inference", "suggestion"]
FactStatus = Literal[
    "pending_confirmation",
    "supported",
    "confirmed",
    "inference",
    "unsupported",
    "conflicted",
    "stale",
    "rejected",
]
EvidenceRelation = Literal["supports", "contradicts", "context", "derived_from"]


class FactExtractIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content_hash: str = Field(min_length=64, max_length=64)

    @field_validator("content_hash", mode="before")
    @classmethod
    def strip_content_hash(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class FactPatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row_version: int = Field(ge=1)
    claim_type: ClaimType | None = None
    claim_text: str | None = Field(default=None, min_length=1, max_length=8000)
    status: Literal[
        "pending_confirmation",
        "confirmed",
        "inference",
        "rejected",
    ] | None = None
    critical: bool | None = None
    rationale: str | None = Field(default=None, max_length=4000)

    @field_validator("claim_text", "rationale", mode="before")
    @classmethod
    def strip_fact_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def require_mutation(self) -> "FactPatchIn":
        if not any(
            value is not None
            for value in (
                self.claim_type,
                self.claim_text,
                self.status,
                self.critical,
                self.rationale,
            )
        ):
            raise ValueError("至少提供一个事实更新字段")
        return self


class EvidenceAttachIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    relation: EvidenceRelation
    source_type: Literal["knowledge_chunk"]
    source_uuid: str = Field(min_length=1, max_length=128)
    derived_expression: str = Field(default="", max_length=4000)
    input_fact_uuids: list[str] = Field(default_factory=list, max_length=100)
    rounding_rule: str = Field(default="", max_length=128)

    @field_validator(
        "source_uuid",
        "derived_expression",
        "rounding_rule",
        mode="before",
    )
    @classmethod
    def strip_attach_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class EvidenceRevokeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=2000)

    @field_validator("reason", mode="before")
    @classmethod
    def strip_reason(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class FactOut(BaseModel):
    fact_uuid: str
    deliverable_uuid: str
    version_uuid: str
    content_hash: str
    block_id: str
    char_start: int | None
    char_end: int | None
    claim_type: ClaimType
    claim_text: str
    claim_hash: str
    critical: bool
    status: FactStatus
    source_required: bool
    human_confirmation_required: bool
    rationale: str
    confirmed_by: str
    confirmed_at: datetime | None
    row_version: int
    created_at: datetime
    updated_at: datetime


class FactListOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    version_uuid: str
    content_hash: str
    items: list[FactOut]
    total: int


class FactMutationOut(BaseModel):
    request_id: str
    fact: FactOut


class EvidenceLocationOut(BaseModel):
    file_name: str
    page_number: int | None
    sheet_name: str
    cell_range: str
    section_title: str
    paragraph_index: int | None
    chunk_id: str


class EvidenceSearchItemOut(BaseModel):
    source_type: str
    source_uuid: str
    source_version: str
    source_content_hash: str
    quote: str
    location: EvidenceLocationOut


class EvidenceSearchOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    version_uuid: str
    items: list[EvidenceSearchItemOut]
    total: int


class EvidenceOut(BaseModel):
    evidence_uuid: str
    deliverable_uuid: str
    version_uuid: str
    project_uuid: str | None
    source_type: str
    source_uuid: str
    source_version: str
    source_content_hash: str
    quote: str
    quote_hash: str
    location: EvidenceLocationOut
    captured_by: str
    captured_at: datetime
    permission_snapshot_hash: str
    status: Literal["active", "stale", "revoked", "inaccessible"]
    stale_reason: str
    revoked_reason: str
    row_version: int


class FactEvidenceLinkOut(BaseModel):
    link_uuid: str
    fact_uuid: str
    evidence_uuid: str
    relation: EvidenceRelation
    derived_expression: str
    input_fact_uuids: list[str]
    rounding_rule: str
    status: str
    linked_by: str
    created_at: datetime


class FactEvidenceMutationOut(BaseModel):
    request_id: str
    fact: FactOut
    evidence: EvidenceOut
    link: FactEvidenceLinkOut


class EvidencePreviewOut(BaseModel):
    request_id: str
    evidence: EvidenceOut


class EvidenceRevokeOut(BaseModel):
    request_id: str
    deliverable_uuid: str
    lifecycle_status: str
    row_version: int
    evidence: EvidenceOut
