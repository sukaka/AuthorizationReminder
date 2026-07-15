from __future__ import annotations

import hashlib
import json
import re
import uuid as uuid_lib
from dataclasses import dataclass
from datetime import datetime, timezone
from time import perf_counter
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ..crypto import ContentCipher, EncryptedPayload
from ..models import KnowledgeChunk, KnowledgeFile, WorkArtifact, WorkArtifactVersion
from ..project_context_models import ProjectFile
from ..project_workspace_models import Project, ProjectMember
from .domain import (
    DeliverableDomainError,
    DeliverableScope,
    DeliverableVersionSnapshot,
    LifecycleAction,
    LifecycleStatus,
    ScopeType,
    TransitionContext,
    transition_lifecycle,
)
from .models import (
    ApprovalEvent,
    ApprovalFlowVersion,
    DeliverableEvidence,
    DeliverableExperienceCandidate,
    DeliverableFact,
    DeliverableIdempotencyRecord,
    FactEvidenceLink,
    QualityRuleDefinition,
    QualityRuleVersion,
    ReviewIssue,
    ReviewRun,
    SkillDefinition,
    SkillVersion,
    TemplateDefinition,
    TemplateVersion,
)
from .schemas import (
    DeliverableCreateIn,
    DeliverableMetadataUpdateIn,
    DeliverableVersionCreateIn,
    ExperienceCandidateCreateIn,
    ReviewIssueUpdateIn,
    ReviewStartIn,
)


PROFESSIONAL_SOURCE = "professional_delivery"
CREATE_OPERATION = "deliverable.create"
CREATE_VERSION_OPERATION = "deliverable.version.create"
UPDATE_METADATA_OPERATION = "deliverable.metadata.update"
PROJECT_WRITER_ROLES = frozenset({"project_lead", "project_admin", "member"})
PROJECT_REVIEWER_ROLES = frozenset({"project_lead", "project_admin", "reviewer"})
PROJECT_DELIVERY_ROLES = frozenset({"project_lead", "project_admin"})
REQUIRED_REVIEW_CATEGORIES = (
    "structure_contract",
    "facts_evidence",
    "project_scope",
    "consistency",
    "professional_rules",
    "format_expression",
    "sensitive_security",
)


class ProfessionalDeliveryError(ValueError):
    def __init__(
        self,
        code: str,
        message: str,
        status_code: int,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


class ProfessionalDeliveryEvidenceInvalidatedError(ProfessionalDeliveryError):
    """Signals that evidence invalidation must be committed before returning 422."""


@dataclass(frozen=True, slots=True)
class DeliverableAccess:
    artifact: WorkArtifact
    project: Project | None
    member: ProjectMember | None


@dataclass(frozen=True, slots=True)
class DeliverableCreateResult:
    artifact: WorkArtifact
    version: WorkArtifactVersion
    replayed: bool


@dataclass(frozen=True, slots=True)
class DeliverableVersionCreateResult:
    artifact: WorkArtifact
    version: WorkArtifactVersion
    parent_version: WorkArtifactVersion | None
    replayed: bool


@dataclass(frozen=True, slots=True)
class DeliverableMetadataUpdateResult:
    access: DeliverableAccess
    replayed: bool


@dataclass(frozen=True, slots=True)
class ExperienceCandidateCreateResult:
    access: DeliverableAccess
    version: WorkArtifactVersion
    candidate: DeliverableExperienceCandidate
    replayed: bool


@dataclass(frozen=True, slots=True)
class ReviewCreateResult:
    artifact: WorkArtifact
    run: ReviewRun
    issues: list[ReviewIssue]
    replayed: bool


@dataclass(frozen=True, slots=True)
class ReviewIssueAccess:
    access: DeliverableAccess
    run: ReviewRun
    issue: ReviewIssue


def _canonical_hash(value: dict[str, Any]) -> str:
    raw = json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _validate_content(content: dict[str, Any]) -> str:
    schema_version = str(content.get("schema_version") or "").strip()
    blocks = content.get("blocks")
    if not schema_version or not isinstance(blocks, list):
        raise ProfessionalDeliveryError(
            "INVALID_DELIVERABLE_CONTENT",
            "成果正文必须包含结构版本和内容块列表",
            422,
        )

    block_ids: set[str] = set()
    for block in blocks:
        if not isinstance(block, dict):
            raise ProfessionalDeliveryError(
                "INVALID_DELIVERABLE_CONTENT",
                "成果内容块必须是结构化对象",
                422,
            )
        block_id = str(block.get("block_id") or "").strip()
        block_type = str(block.get("type") or "").strip()
        if not block_id or not block_type or block_id in block_ids:
            raise ProfessionalDeliveryError(
                "INVALID_DELIVERABLE_CONTENT",
                "成果内容块必须有唯一且稳定的 block_id 和有效类型",
                422,
            )
        block_ids.add(block_id)
    return schema_version


def _load_published_catalog(
    db: Session,
    body: DeliverableCreateIn,
) -> tuple[SkillVersion, TemplateVersion]:
    skill_version = db.scalar(
        select(SkillVersion).where(SkillVersion.uuid == body.skill_version_uuid)
    )
    skill = (
        db.get(SkillDefinition, skill_version.skill_id)
        if skill_version is not None
        else None
    )
    if (
        skill_version is None
        or skill is None
        or skill_version.status != "published"
        or skill.status != "published"
    ):
        raise ProfessionalDeliveryError(
            "SKILL_VERSION_NOT_AVAILABLE",
            "指定的 Skill 版本不可用",
            422,
        )
    if skill.scope_policy not in {"both", body.scope_type}:
        raise ProfessionalDeliveryError(
            "SKILL_SCOPE_MISMATCH",
            "指定的 Skill 不适用于当前成果范围",
            422,
        )

    template_version = db.scalar(
        select(TemplateVersion).where(
            TemplateVersion.uuid == body.template_version_uuid
        )
    )
    template = (
        db.get(TemplateDefinition, template_version.template_id)
        if template_version is not None
        else None
    )
    if (
        template_version is None
        or template is None
        or template_version.status != "published"
        or template.status != "published"
    ):
        raise ProfessionalDeliveryError(
            "TEMPLATE_VERSION_NOT_AVAILABLE",
            "指定的模板版本不可用",
            422,
        )
    if body.deliverable_type not in template.deliverable_types_json:
        raise ProfessionalDeliveryError(
            "TEMPLATE_DELIVERABLE_TYPE_MISMATCH",
            "指定模板不支持当前成果类型",
            422,
        )
    compatible_skill_ids = {
        int(item)
        for item in template_version.compatible_skill_version_ids_json
        if isinstance(item, int) or (isinstance(item, str) and item.isdigit())
    }
    if compatible_skill_ids and skill_version.id not in compatible_skill_ids:
        raise ProfessionalDeliveryError(
            "TEMPLATE_SKILL_MISMATCH",
            "指定模板与 Skill 版本不兼容",
            422,
        )
    return skill_version, template_version


def create_deliverable(
    db: Session,
    *,
    body: DeliverableCreateIn,
    actor_user_id: str,
    idempotency_key: str,
    project: Project | None,
    cipher: ContentCipher,
    key_version: str,
) -> DeliverableCreateResult:
    request_hash = _canonical_hash(body.model_dump(mode="json"))
    existing = db.scalar(
        select(DeliverableIdempotencyRecord).where(
            DeliverableIdempotencyRecord.actor_user_id == actor_user_id,
            DeliverableIdempotencyRecord.operation == CREATE_OPERATION,
            DeliverableIdempotencyRecord.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        if existing.request_hash != request_hash:
            raise ProfessionalDeliveryError(
                "IDEMPOTENCY_KEY_REUSED",
                "该幂等键已用于不同请求",
                409,
            )
        artifact = db.get(WorkArtifact, existing.deliverable_id)
        version = db.get(WorkArtifactVersion, existing.version_id)
        if artifact is None or version is None:
            raise ProfessionalDeliveryError(
                "IDEMPOTENCY_RECORD_INVALID",
                "幂等记录对应的成果不存在",
                409,
            )
        return DeliverableCreateResult(artifact=artifact, version=version, replayed=True)

    schema_version = _validate_content(body.content)
    skill_version, template_version = _load_published_catalog(db, body)
    project_id = project.id if project is not None else None
    DeliverableScope(
        scope_type=ScopeType(body.scope_type),
        owner_user_id=actor_user_id,
        project_id=project_id,
    )

    artifact = WorkArtifact(
        owner_user_id=actor_user_id,
        title=body.title,
        artifact_type=body.deliverable_type,
        deliverable_type=body.deliverable_type,
        scope_type=body.scope_type,
        formality=body.formality,
        project_id=project_id,
        lifecycle_status="draft",
        row_version=1,
        created_by=actor_user_id,
        record_status="active",
        source_scope=PROFESSIONAL_SOURCE,
        content_summary=body.content_summary,
        version=1,
        status="active",
    )
    db.add(artifact)
    db.flush()

    snapshot = DeliverableVersionSnapshot.create(
        deliverable_id=artifact.id,
        version_no=1,
        parent_version_id=None,
        skill_version_id=skill_version.id,
        template_version_id=template_version.id,
        content=body.content,
        content_format="structured_json",
        content_schema_version=schema_version,
        title_snapshot=body.title,
        summary_snapshot=body.content_summary,
        created_by=actor_user_id,
        creation_reason=body.creation_reason,
    )
    version_uuid = str(uuid_lib.uuid4())
    encrypted = cipher.encrypt_json(snapshot.content, version_uuid.encode("utf-8"))
    version = WorkArtifactVersion(
        uuid=version_uuid,
        artifact_id=artifact.id,
        version=snapshot.version_no,
        parent_version_id=snapshot.parent_version_id,
        skill_version_id=snapshot.skill_version_id,
        template_version_id=snapshot.template_version_id,
        content_format=snapshot.content_format,
        content_schema_version=snapshot.content_schema_version,
        content_ciphertext=encrypted.ciphertext,
        content_nonce=encrypted.nonce,
        key_version=key_version,
        content_hash=snapshot.content_hash,
        title_snapshot=snapshot.title_snapshot,
        summary_snapshot=snapshot.summary_snapshot,
        project_scope_snapshot_json=(
            {"project_uuid": project.uuid} if project is not None else {}
        ),
        created_by=snapshot.created_by,
        creation_reason=snapshot.creation_reason,
        legacy_incomplete=False,
        source=PROFESSIONAL_SOURCE,
        content_summary=body.content_summary,
        status="active",
    )
    db.add(version)
    db.flush()
    artifact.current_version_id = version.id
    db.add(
        DeliverableIdempotencyRecord(
            actor_user_id=actor_user_id,
            operation=CREATE_OPERATION,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            deliverable_id=artifact.id,
            version_id=version.id,
            status="completed",
        )
    )
    db.flush()
    return DeliverableCreateResult(artifact=artifact, version=version, replayed=False)


def _not_found() -> ProfessionalDeliveryError:
    return ProfessionalDeliveryError(
        "DELIVERABLE_NOT_FOUND",
        "成果不存在",
        404,
    )


def _version_not_found() -> ProfessionalDeliveryError:
    return ProfessionalDeliveryError(
        "DELIVERABLE_VERSION_NOT_FOUND",
        "成果版本不存在",
        404,
    )


def get_visible_deliverable(
    db: Session,
    *,
    deliverable_uuid: str,
    actor_user_id: str,
    lock: bool = False,
) -> DeliverableAccess:
    statement = select(WorkArtifact).where(
        WorkArtifact.uuid == deliverable_uuid,
        WorkArtifact.source_scope == PROFESSIONAL_SOURCE,
        WorkArtifact.record_status == "active",
    )
    if lock:
        statement = statement.with_for_update()
    artifact = db.scalar(statement)
    if artifact is None:
        raise _not_found()
    if artifact.scope_type == "personal":
        if artifact.owner_user_id != actor_user_id:
            raise _not_found()
        return DeliverableAccess(artifact=artifact, project=None, member=None)
    if artifact.scope_type != "project" or artifact.project_id is None:
        raise _not_found()

    project = db.get(Project, artifact.project_id)
    member = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == artifact.project_id,
            ProjectMember.user_id == actor_user_id,
            ProjectMember.status == "active",
        )
    )
    if project is None or member is None:
        raise _not_found()
    return DeliverableAccess(artifact=artifact, project=project, member=member)


def get_deliverable_version(
    db: Session,
    *,
    artifact: WorkArtifact,
    version_uuid: str,
) -> WorkArtifactVersion:
    version = db.scalar(
        select(WorkArtifactVersion).where(
            WorkArtifactVersion.uuid == version_uuid,
            WorkArtifactVersion.artifact_id == artifact.id,
        )
    )
    if version is None:
        raise _version_not_found()
    return version


def list_deliverable_versions(
    db: Session,
    *,
    artifact: WorkArtifact,
    page: int,
    page_size: int,
) -> tuple[list[WorkArtifactVersion], int]:
    filters = (WorkArtifactVersion.artifact_id == artifact.id,)
    total = int(
        db.scalar(select(func.count(WorkArtifactVersion.id)).where(*filters)) or 0
    )
    versions = list(
        db.scalars(
            select(WorkArtifactVersion)
            .where(*filters)
            .order_by(
                WorkArtifactVersion.version.desc(),
                WorkArtifactVersion.id.desc(),
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return versions, total


def _require_deliverable_write_access(access: DeliverableAccess) -> None:
    if access.artifact.scope_type == "personal":
        return
    if access.member is None or access.member.role not in PROJECT_WRITER_ROLES:
        raise ProfessionalDeliveryError(
            "PROJECT_DELIVERABLE_WRITE_FORBIDDEN",
            "当前项目角色不能修改成果",
            403,
        )


def update_deliverable_metadata(
    db: Session,
    *,
    deliverable_uuid: str,
    body: DeliverableMetadataUpdateIn,
    actor_user_id: str,
    idempotency_key: str,
) -> DeliverableMetadataUpdateResult:
    access = get_visible_deliverable(
        db,
        deliverable_uuid=deliverable_uuid,
        actor_user_id=actor_user_id,
        lock=True,
    )
    _require_deliverable_write_access(access)
    artifact = access.artifact
    request_hash = _canonical_hash(
        {
            "deliverable_uuid": deliverable_uuid,
            "body": body.model_dump(mode="json"),
        }
    )
    existing = db.scalar(
        select(DeliverableIdempotencyRecord).where(
            DeliverableIdempotencyRecord.actor_user_id == actor_user_id,
            DeliverableIdempotencyRecord.operation == UPDATE_METADATA_OPERATION,
            DeliverableIdempotencyRecord.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        if existing.request_hash != request_hash:
            raise ProfessionalDeliveryError(
                "IDEMPOTENCY_KEY_REUSED",
                "该幂等键已用于不同请求",
                409,
            )
        if existing.deliverable_id != artifact.id:
            raise ProfessionalDeliveryError(
                "IDEMPOTENCY_RECORD_INVALID",
                "幂等记录对应的成果不存在",
                409,
            )
        return DeliverableMetadataUpdateResult(access=access, replayed=True)

    if artifact.row_version != body.row_version:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_VERSION_CONFLICT",
            "成果已被其他操作更新，请刷新后重试",
            409,
            {"current_row_version": artifact.row_version},
        )
    if artifact.lifecycle_status == "archived":
        raise ProfessionalDeliveryError(
            "DELIVERABLE_METADATA_UPDATE_FORBIDDEN",
            "已归档成果不能修改聚合元数据",
            422,
        )
    if artifact.current_version_id is None:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_VERSION_NOT_AVAILABLE",
            "成果当前版本不可用",
            409,
        )

    artifact.title = body.title
    artifact.row_version += 1
    db.add(
        DeliverableIdempotencyRecord(
            actor_user_id=actor_user_id,
            operation=UPDATE_METADATA_OPERATION,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            deliverable_id=artifact.id,
            version_id=artifact.current_version_id,
            status="completed",
        )
    )
    db.flush()
    return DeliverableMetadataUpdateResult(access=access, replayed=False)


_SENSITIVE_EXPERIENCE_PATTERNS = (
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"),
    re.compile(r"(?<!\d)\d{17}[0-9Xx](?!\d)"),
)


def _validate_deidentified_experience_summary(
    *,
    access: DeliverableAccess,
    summary: str,
) -> None:
    if any(pattern.search(summary) for pattern in _SENSITIVE_EXPERIENCE_PATTERNS):
        raise ProfessionalDeliveryError(
            "EXPERIENCE_CANDIDATE_NOT_DEIDENTIFIED",
            "经验候选仍包含邮箱、手机号或证件号，请去敏后重试",
            422,
        )
    if access.project is not None:
        project_name = access.project.name.strip()
        if len(project_name) >= 2 and project_name.casefold() in summary.casefold():
            raise ProfessionalDeliveryError(
                "EXPERIENCE_CANDIDATE_NOT_DEIDENTIFIED",
                "经验候选仍包含项目名称，请去敏后重试",
                422,
            )


def create_experience_candidate(
    db: Session,
    *,
    deliverable_uuid: str,
    body: ExperienceCandidateCreateIn,
    actor_user_id: str,
    idempotency_key: str,
    request_id: str,
    cipher: ContentCipher,
    key_version: str,
) -> ExperienceCandidateCreateResult:
    access = get_visible_deliverable(
        db,
        deliverable_uuid=deliverable_uuid,
        actor_user_id=actor_user_id,
        lock=True,
    )
    _require_deliverable_write_access(access)
    artifact = access.artifact
    request_hash = _canonical_hash(
        {
            "deliverable_uuid": deliverable_uuid,
            "body": body.model_dump(mode="json"),
        }
    )
    existing = db.scalar(
        select(DeliverableExperienceCandidate).where(
            DeliverableExperienceCandidate.submitted_by == actor_user_id,
            DeliverableExperienceCandidate.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        if existing.request_hash != request_hash:
            raise ProfessionalDeliveryError(
                "IDEMPOTENCY_KEY_REUSED",
                "该幂等键已用于不同请求",
                409,
            )
        version = db.get(WorkArtifactVersion, existing.deliverable_version_id)
        if existing.deliverable_id != artifact.id or version is None:
            raise ProfessionalDeliveryError(
                "IDEMPOTENCY_RECORD_INVALID",
                "幂等记录对应的经验候选不存在",
                409,
            )
        return ExperienceCandidateCreateResult(
            access=access,
            version=version,
            candidate=existing,
            replayed=True,
        )

    if artifact.row_version != body.row_version:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_VERSION_CONFLICT",
            "成果已被其他操作更新，请刷新后重试",
            409,
            {"current_row_version": artifact.row_version},
        )
    if artifact.lifecycle_status not in {"delivered", "archived"}:
        raise ProfessionalDeliveryError(
            "EXPERIENCE_CANDIDATE_FORBIDDEN",
            "只有已交付或已归档成果可以提交经验候选",
            422,
        )
    version = (
        db.get(WorkArtifactVersion, artifact.delivered_version_id)
        if artifact.delivered_version_id is not None
        else None
    )
    if (
        version is None
        or version.uuid != body.version_uuid
        or version.content_hash != body.content_hash
    ):
        raise ProfessionalDeliveryError(
            "EXPERIENCE_CANDIDATE_TARGET_STALE",
            "经验候选必须绑定成果已交付的精确版本",
            409,
        )
    _validate_deidentified_experience_summary(
        access=access,
        summary=body.deidentified_summary,
    )

    candidate_uuid = str(uuid_lib.uuid4())
    encrypted = cipher.encrypt_json(
        {"deidentified_summary": body.deidentified_summary},
        candidate_uuid.encode("utf-8"),
    )
    candidate = DeliverableExperienceCandidate(
        uuid=candidate_uuid,
        deliverable_id=artifact.id,
        deliverable_version_id=version.id,
        project_id=artifact.project_id,
        candidate_type=body.candidate_type,
        content_hash=version.content_hash,
        payload_ciphertext=encrypted.ciphertext,
        payload_nonce=encrypted.nonce,
        key_version=key_version,
        status="pending_review",
        submitted_by=actor_user_id,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        audit_request_id=request_id,
    )
    db.add(candidate)
    db.flush()
    return ExperienceCandidateCreateResult(
        access=access,
        version=version,
        candidate=candidate,
        replayed=False,
    )


def experience_candidate_payload(
    *,
    access: DeliverableAccess,
    version: WorkArtifactVersion,
    candidate: DeliverableExperienceCandidate,
    cipher: ContentCipher,
) -> dict[str, Any]:
    payload = cipher.decrypt_json(
        EncryptedPayload(candidate.payload_ciphertext, candidate.payload_nonce),
        candidate.uuid.encode("utf-8"),
    )
    return {
        "candidate_uuid": candidate.uuid,
        "candidate_type": candidate.candidate_type,
        "status": candidate.status,
        "source_scope_type": access.artifact.scope_type,
        "source_project_uuid": (
            access.project.uuid if access.project is not None else None
        ),
        "version_uuid": version.uuid,
        "content_hash": candidate.content_hash,
        "deidentified_summary": str(payload.get("deidentified_summary", "")),
        "submitted_by": candidate.submitted_by,
        "created_at": candidate.created_at,
    }


def _next_status_for_version_write(artifact: WorkArtifact) -> str:
    try:
        current = LifecycleStatus(artifact.lifecycle_status)
    except ValueError as exc:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_VERSION_WRITE_FORBIDDEN",
            "成果当前状态不允许创建新版本",
            422,
        ) from exc

    if current in {LifecycleStatus.DRAFT, LifecycleStatus.CHANGES_REQUESTED}:
        return current.value
    if current in {
        LifecycleStatus.APPROVED,
        LifecycleStatus.DELIVERED,
        LifecycleStatus.ARCHIVED,
    }:
        return transition_lifecycle(
            current,
            LifecycleAction.CREATE_REVISION,
            TransitionContext(creates_new_version=True),
        ).value
    raise ProfessionalDeliveryError(
        "DELIVERABLE_VERSION_WRITE_FORBIDDEN",
        "成果当前状态不允许创建新版本",
        422,
    )


def _load_parent_version(
    db: Session,
    *,
    artifact: WorkArtifact,
    parent_version_uuid: str | None,
) -> WorkArtifactVersion:
    if parent_version_uuid:
        parent = db.scalar(
            select(WorkArtifactVersion).where(
                WorkArtifactVersion.uuid == parent_version_uuid,
                WorkArtifactVersion.artifact_id == artifact.id,
            )
        )
    else:
        parent = (
            db.get(WorkArtifactVersion, artifact.current_version_id)
            if artifact.current_version_id is not None
            else None
        )
    if (
        parent is None
        or parent.skill_version_id is None
        or parent.template_version_id is None
    ):
        raise ProfessionalDeliveryError(
            "DELIVERABLE_PARENT_VERSION_NOT_AVAILABLE",
            "指定的成果父版本不可用",
            422,
        )
    return parent


def _content_claim_hashes(content: dict[str, Any]) -> set[tuple[str, str]]:
    claim_hashes: set[tuple[str, str]] = set()
    blocks = content.get("blocks")
    if not isinstance(blocks, list):
        return claim_hashes
    for block in blocks:
        if not isinstance(block, dict):
            continue
        block_id = str(block.get("block_id") or "").strip()
        claim_text = ""
        for key in ("text", "claim", "content", "value"):
            value = block.get(key)
            if isinstance(value, str) and value.strip():
                claim_text = value.strip()
                break
        if block_id and claim_text:
            claim_hashes.add(
                (block_id, hashlib.sha256(claim_text.encode("utf-8")).hexdigest())
            )
    return claim_hashes


def _inherit_unchanged_fact_evidence(
    db: Session,
    *,
    artifact: WorkArtifact,
    parent_version: WorkArtifactVersion,
    version: WorkArtifactVersion,
    content: dict[str, Any],
    actor_user_id: str,
    cipher: ContentCipher,
    key_version: str,
) -> None:
    matching_claims = _content_claim_hashes(content)
    if not matching_claims:
        return
    parent_facts = list(
        db.scalars(
            select(DeliverableFact)
            .where(DeliverableFact.deliverable_version_id == parent_version.id)
            .order_by(DeliverableFact.id.asc())
        )
    )
    candidate_facts = {
        fact.uuid: fact
        for fact in parent_facts
        if (fact.block_id, fact.claim_hash) in matching_claims
    }
    if not candidate_facts:
        return

    candidate_links = list(
        db.scalars(
            select(FactEvidenceLink)
            .where(
                FactEvidenceLink.fact_id.in_(
                    [fact.id for fact in candidate_facts.values()]
                )
            )
            .order_by(FactEvidenceLink.id.asc())
        )
    )
    fact_uuid_by_id = {fact.id: fact.uuid for fact in candidate_facts.values()}
    while True:
        rejected_fact_uuids = {
            fact_uuid_by_id[link.fact_id]
            for link in candidate_links
            if link.fact_id in fact_uuid_by_id
            and link.relation == "derived_from"
            and any(
                str(input_uuid) not in candidate_facts
                for input_uuid in (link.input_fact_uuids_json or [])
            )
        }
        if not rejected_fact_uuids:
            break
        for fact_uuid in rejected_fact_uuids:
            candidate_facts.pop(fact_uuid, None)
        fact_uuid_by_id = {fact.id: fact.uuid for fact in candidate_facts.values()}
    if not candidate_facts:
        return

    extraction_batch_uuid = str(uuid_lib.uuid4())
    inherited_facts: dict[str, DeliverableFact] = {}
    for old_fact in candidate_facts.values():
        claim_payload = cipher.decrypt_json(
            EncryptedPayload(old_fact.claim_ciphertext, old_fact.claim_nonce),
            old_fact.uuid.encode("utf-8"),
        )
        new_fact_uuid = str(uuid_lib.uuid4())
        encrypted_claim = cipher.encrypt_json(
            claim_payload,
            new_fact_uuid.encode("utf-8"),
        )
        encrypted_rationale = None
        if (
            old_fact.rationale_ciphertext is not None
            and old_fact.rationale_nonce is not None
        ):
            rationale_payload = cipher.decrypt_json(
                EncryptedPayload(
                    old_fact.rationale_ciphertext,
                    old_fact.rationale_nonce,
                ),
                f"{old_fact.uuid}:rationale".encode("utf-8"),
            )
            encrypted_rationale = cipher.encrypt_json(
                rationale_payload,
                f"{new_fact_uuid}:rationale".encode("utf-8"),
            )
        new_fact = DeliverableFact(
            uuid=new_fact_uuid,
            deliverable_id=artifact.id,
            deliverable_version_id=version.id,
            deliverable_content_hash=version.content_hash,
            block_id=old_fact.block_id,
            char_start=old_fact.char_start,
            char_end=old_fact.char_end,
            claim_type=old_fact.claim_type,
            claim_ciphertext=encrypted_claim.ciphertext,
            claim_nonce=encrypted_claim.nonce,
            claim_hash=old_fact.claim_hash,
            key_version=key_version,
            critical=old_fact.critical,
            status=old_fact.status,
            source_required=old_fact.source_required,
            human_confirmation_required=old_fact.human_confirmation_required,
            rationale_ciphertext=(
                encrypted_rationale.ciphertext
                if encrypted_rationale is not None
                else None
            ),
            rationale_nonce=(
                encrypted_rationale.nonce
                if encrypted_rationale is not None
                else None
            ),
            confirmed_by=old_fact.confirmed_by,
            confirmed_at=old_fact.confirmed_at,
            extraction_batch_uuid=extraction_batch_uuid,
            created_by=actor_user_id,
            updated_by=actor_user_id,
            row_version=1,
        )
        db.add(new_fact)
        inherited_facts[old_fact.uuid] = new_fact
    db.flush()

    old_fact_uuid_by_id = {
        fact.id: fact.uuid
        for fact in candidate_facts.values()
    }
    inherited_evidence: dict[int, DeliverableEvidence] = {}
    for old_link in candidate_links:
        old_fact_uuid = old_fact_uuid_by_id.get(old_link.fact_id)
        new_fact = inherited_facts.get(old_fact_uuid or "")
        if new_fact is None:
            continue
        input_fact_uuids = [
            str(value) for value in (old_link.input_fact_uuids_json or [])
        ]
        if old_link.relation == "derived_from":
            if any(value not in inherited_facts for value in input_fact_uuids):
                continue
            input_fact_uuids = [
                inherited_facts[value].uuid for value in input_fact_uuids
            ]
        old_evidence = db.get(DeliverableEvidence, old_link.evidence_id)
        if old_evidence is None:
            continue
        new_evidence = inherited_evidence.get(old_evidence.id)
        if new_evidence is None:
            quote_payload = cipher.decrypt_json(
                EncryptedPayload(
                    old_evidence.quote_ciphertext,
                    old_evidence.quote_nonce,
                ),
                old_evidence.uuid.encode("utf-8"),
            )
            new_evidence_uuid = str(uuid_lib.uuid4())
            encrypted_quote = cipher.encrypt_json(
                quote_payload,
                new_evidence_uuid.encode("utf-8"),
            )
            new_evidence = DeliverableEvidence(
                uuid=new_evidence_uuid,
                deliverable_id=artifact.id,
                deliverable_version_id=version.id,
                project_id=old_evidence.project_id,
                source_type=old_evidence.source_type,
                source_uuid=old_evidence.source_uuid,
                source_version=old_evidence.source_version,
                source_content_hash=old_evidence.source_content_hash,
                file_name=old_evidence.file_name,
                page_number=old_evidence.page_number,
                sheet_name=old_evidence.sheet_name,
                cell_range=old_evidence.cell_range,
                section_title=old_evidence.section_title,
                paragraph_index=old_evidence.paragraph_index,
                chunk_id=old_evidence.chunk_id,
                quote_ciphertext=encrypted_quote.ciphertext,
                quote_nonce=encrypted_quote.nonce,
                quote_hash=old_evidence.quote_hash,
                key_version=key_version,
                captured_by=old_evidence.captured_by,
                captured_at=old_evidence.captured_at,
                permission_snapshot_hash=old_evidence.permission_snapshot_hash,
                status=old_evidence.status,
                stale_reason=old_evidence.stale_reason,
                revoked_reason=old_evidence.revoked_reason,
                row_version=1,
            )
            db.add(new_evidence)
            db.flush()
            inherited_evidence[old_evidence.id] = new_evidence
        db.add(
            FactEvidenceLink(
                fact_id=new_fact.id,
                evidence_id=new_evidence.id,
                relation=old_link.relation,
                derived_expression=old_link.derived_expression,
                input_fact_uuids_json=input_fact_uuids,
                rounding_rule=old_link.rounding_rule,
                status=old_link.status,
                linked_by=actor_user_id,
            )
        )
    db.flush()


def create_deliverable_version(
    db: Session,
    *,
    deliverable_uuid: str,
    body: DeliverableVersionCreateIn,
    actor_user_id: str,
    idempotency_key: str,
    cipher: ContentCipher,
    key_version: str,
) -> DeliverableVersionCreateResult:
    access = get_visible_deliverable(
        db,
        deliverable_uuid=deliverable_uuid,
        actor_user_id=actor_user_id,
        lock=True,
    )
    _require_deliverable_write_access(access)
    artifact = access.artifact
    request_hash = _canonical_hash(
        {
            "deliverable_uuid": deliverable_uuid,
            "body": body.model_dump(mode="json"),
        }
    )
    existing = db.scalar(
        select(DeliverableIdempotencyRecord).where(
            DeliverableIdempotencyRecord.actor_user_id == actor_user_id,
            DeliverableIdempotencyRecord.operation == CREATE_VERSION_OPERATION,
            DeliverableIdempotencyRecord.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        if existing.request_hash != request_hash:
            raise ProfessionalDeliveryError(
                "IDEMPOTENCY_KEY_REUSED",
                "该幂等键已用于不同请求",
                409,
            )
        version = db.get(WorkArtifactVersion, existing.version_id)
        if (
            existing.deliverable_id != artifact.id
            or version is None
            or version.artifact_id != artifact.id
        ):
            raise ProfessionalDeliveryError(
                "IDEMPOTENCY_RECORD_INVALID",
                "幂等记录对应的成果版本不存在",
                409,
            )
        parent_version = (
            db.get(WorkArtifactVersion, version.parent_version_id)
            if version.parent_version_id is not None
            else None
        )
        return DeliverableVersionCreateResult(
            artifact=artifact,
            version=version,
            parent_version=parent_version,
            replayed=True,
        )

    if artifact.row_version != body.row_version:
        current_version = (
            db.get(WorkArtifactVersion, artifact.current_version_id)
            if artifact.current_version_id is not None
            else None
        )
        raise ProfessionalDeliveryError(
            "DELIVERABLE_VERSION_CONFLICT",
            "成果已被其他操作更新，请刷新后重试",
            409,
            {
                "current_row_version": artifact.row_version,
                "current_version_no": (
                    current_version.version
                    if current_version is not None
                    else artifact.version
                ),
            },
        )

    next_status = _next_status_for_version_write(artifact)
    parent_version = _load_parent_version(
        db,
        artifact=artifact,
        parent_version_uuid=body.parent_version_uuid,
    )
    schema_version = _validate_content(body.content)
    summary_snapshot = (
        body.content_summary
        if body.content_summary is not None
        else artifact.content_summary
    )
    latest_version = int(
        db.scalar(
            select(func.max(WorkArtifactVersion.version)).where(
                WorkArtifactVersion.artifact_id == artifact.id
            )
        )
        or 0
    )
    snapshot = DeliverableVersionSnapshot.create(
        deliverable_id=artifact.id,
        version_no=latest_version + 1,
        parent_version_id=parent_version.id,
        skill_version_id=parent_version.skill_version_id,
        template_version_id=parent_version.template_version_id,
        content=body.content,
        content_format="structured_json",
        content_schema_version=schema_version,
        title_snapshot=artifact.title,
        summary_snapshot=summary_snapshot,
        created_by=actor_user_id,
        creation_reason=body.creation_reason,
    )
    version_uuid = str(uuid_lib.uuid4())
    encrypted = cipher.encrypt_json(snapshot.content, version_uuid.encode("utf-8"))
    version = WorkArtifactVersion(
        uuid=version_uuid,
        artifact_id=artifact.id,
        version=snapshot.version_no,
        parent_version_id=snapshot.parent_version_id,
        skill_version_id=snapshot.skill_version_id,
        template_version_id=snapshot.template_version_id,
        content_format=snapshot.content_format,
        content_schema_version=snapshot.content_schema_version,
        content_ciphertext=encrypted.ciphertext,
        content_nonce=encrypted.nonce,
        key_version=key_version,
        content_hash=snapshot.content_hash,
        title_snapshot=snapshot.title_snapshot,
        summary_snapshot=snapshot.summary_snapshot,
        change_summary=body.change_summary,
        project_scope_snapshot_json=dict(
            parent_version.project_scope_snapshot_json or {}
        ),
        input_summary_json=dict(parent_version.input_summary_json or {}),
        source_policy_snapshot_json=dict(
            parent_version.source_policy_snapshot_json or {}
        ),
        created_by=snapshot.created_by,
        creation_reason=snapshot.creation_reason,
        legacy_incomplete=False,
        source=PROFESSIONAL_SOURCE,
        source_summary_json=list(parent_version.source_summary_json or []),
        content_summary=summary_snapshot,
        status="active",
    )
    db.add(version)
    db.flush()
    _inherit_unchanged_fact_evidence(
        db,
        artifact=artifact,
        parent_version=parent_version,
        version=version,
        content=body.content,
        actor_user_id=actor_user_id,
        cipher=cipher,
        key_version=key_version,
    )

    artifact.current_version_id = version.id
    artifact.version = version.version
    artifact.row_version += 1
    artifact.lifecycle_status = next_status
    artifact.content_summary = summary_snapshot
    db.add(
        DeliverableIdempotencyRecord(
            actor_user_id=actor_user_id,
            operation=CREATE_VERSION_OPERATION,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            deliverable_id=artifact.id,
            version_id=version.id,
            status="completed",
        )
    )
    db.flush()
    return DeliverableVersionCreateResult(
        artifact=artifact,
        version=version,
        parent_version=parent_version,
        replayed=False,
    )


def list_visible_deliverables(
    db: Session,
    *,
    actor_user_id: str,
    page: int,
    page_size: int,
) -> tuple[list[DeliverableAccess], int]:
    project_ids = select(ProjectMember.project_id).where(
        ProjectMember.user_id == actor_user_id,
        ProjectMember.status == "active",
    )
    visibility = or_(
        and_(
            WorkArtifact.scope_type == "personal",
            WorkArtifact.owner_user_id == actor_user_id,
        ),
        and_(
            WorkArtifact.scope_type == "project",
            WorkArtifact.project_id.in_(project_ids),
        ),
    )
    filters = (
        WorkArtifact.source_scope == PROFESSIONAL_SOURCE,
        WorkArtifact.record_status == "active",
        visibility,
    )
    total = int(db.scalar(select(func.count(WorkArtifact.id)).where(*filters)) or 0)
    artifacts = list(
        db.scalars(
            select(WorkArtifact)
            .where(*filters)
            .order_by(WorkArtifact.updated_at.desc(), WorkArtifact.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    accesses: list[DeliverableAccess] = []
    for artifact in artifacts:
        if artifact.scope_type == "personal":
            accesses.append(DeliverableAccess(artifact, None, None))
            continue
        project = db.get(Project, artifact.project_id)
        member = db.scalar(
            select(ProjectMember).where(
                ProjectMember.project_id == artifact.project_id,
                ProjectMember.user_id == actor_user_id,
                ProjectMember.status == "active",
            )
        )
        if project is not None and member is not None:
            accesses.append(DeliverableAccess(artifact, project, member))
    return accesses, total


def _approval_flow_roles(flow_version: ApprovalFlowVersion) -> set[str]:
    roles: set[str] = set()
    for step in flow_version.steps_json or []:
        if not isinstance(step, dict):
            continue
        roles.update(
            str(role).strip()
            for role in step.get("roles") or []
            if str(role).strip()
        )
    return roles


def allowed_actions(db: Session, access: DeliverableAccess) -> list[str]:
    artifact = access.artifact
    is_personal = artifact.scope_type == "personal"
    role = access.member.role if access.member is not None else ""
    actor_user_id = (
        artifact.owner_user_id
        if is_personal
        else (access.member.user_id if access.member is not None else "")
    )
    can_write = is_personal or role in PROJECT_WRITER_ROLES
    can_review = is_personal or role in PROJECT_REVIEWER_ROLES
    can_reply = is_personal or role in PROJECT_WRITER_ROLES | PROJECT_REVIEWER_ROLES
    can_deliver = is_personal or role in PROJECT_DELIVERY_ROLES
    status = artifact.lifecycle_status
    permitted: set[str] = {"export"}

    if can_write and status != "archived":
        permitted.add("update_metadata")

    if status in {"draft", "changes_requested"}:
        if can_write:
            permitted.update({"edit", "create_version", "manage_facts"})
        if can_review:
            permitted.update({"review", "resolve_review_issue", "comment"})
        if can_reply:
            permitted.add("reply_comment")
    elif status == "pending_approval":
        if artifact.approval_flow_version_id is None:
            if can_write:
                permitted.add("submit")
        else:
            if can_review:
                permitted.add("comment")
            if can_reply:
                permitted.add("reply_comment")
            flow_version = db.get(
                ApprovalFlowVersion,
                artifact.approval_flow_version_id,
            )
            can_use_flow = flow_version is not None and (
                is_personal or role in _approval_flow_roles(flow_version)
            )
            if can_review and can_use_flow:
                permitted.add("request_changes")
                current_version = (
                    db.get(WorkArtifactVersion, artifact.current_version_id)
                    if artifact.current_version_id is not None
                    else None
                )
                author_can_approve = (
                    current_version is not None
                    and (
                        current_version.created_by != actor_user_id
                        or flow_version.allow_author_approve
                    )
                )
                already_approved = (
                    db.scalar(
                        select(ApprovalEvent.id).where(
                            ApprovalEvent.deliverable_id == artifact.id,
                            ApprovalEvent.deliverable_version_id
                            == artifact.current_version_id,
                            ApprovalEvent.event_type == "approved",
                            ApprovalEvent.actor_user_id == actor_user_id,
                        )
                    )
                    is not None
                )
                if author_can_approve and not already_approved:
                    permitted.add("approve")
    elif status == "approved":
        if can_write:
            permitted.add("create_revision")
        if can_deliver:
            permitted.add("deliver")
    elif status == "delivered":
        if can_write:
            permitted.update({"create_revision", "submit_experience"})
        if can_deliver:
            permitted.add("archive")
    elif status == "archived" and can_write:
        permitted.update({"create_revision", "submit_experience"})

    action_order = (
        "edit",
        "update_metadata",
        "create_version",
        "create_revision",
        "manage_facts",
        "review",
        "resolve_review_issue",
        "comment",
        "reply_comment",
        "export",
        "submit",
        "approve",
        "request_changes",
        "deliver",
        "archive",
        "submit_experience",
    )
    return [action for action in action_order if action in permitted]


def deliverable_summary_payload(
    db: Session,
    access: DeliverableAccess,
) -> dict[str, Any]:
    artifact = access.artifact
    return {
        "deliverable_uuid": artifact.uuid,
        "title": artifact.title,
        "deliverable_type": artifact.deliverable_type,
        "scope_type": artifact.scope_type,
        "formality": artifact.formality,
        "project_uuid": access.project.uuid if access.project is not None else None,
        "owner_user_id": artifact.owner_user_id,
        "lifecycle_status": artifact.lifecycle_status,
        "row_version": artifact.row_version,
        "content_summary": artifact.content_summary,
        "allowed_actions": allowed_actions(db, access),
        "created_at": artifact.created_at,
        "updated_at": artifact.updated_at,
    }


def _deliverable_version_references(
    db: Session,
    *,
    version: WorkArtifactVersion,
) -> tuple[WorkArtifactVersion | None, SkillVersion, TemplateVersion]:
    parent_version = (
        db.get(WorkArtifactVersion, version.parent_version_id)
        if version.parent_version_id is not None
        else None
    )
    if version.parent_version_id is not None and parent_version is None:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_VERSION_NOT_AVAILABLE",
            "成果父版本不可用",
            409,
        )
    if version.skill_version_id is None or version.template_version_id is None:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_VERSION_NOT_AVAILABLE",
            "成果当前版本不可用",
            409,
        )
    skill_version = db.get(SkillVersion, version.skill_version_id)
    template_version = db.get(TemplateVersion, version.template_version_id)
    if skill_version is None or template_version is None:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_VERSION_NOT_AVAILABLE",
            "成果绑定的 Skill 或模板版本不可用",
            409,
        )
    return parent_version, skill_version, template_version


def deliverable_version_metadata_payload(
    db: Session,
    *,
    artifact: WorkArtifact,
    version: WorkArtifactVersion,
) -> dict[str, Any]:
    parent_version, skill_version, template_version = (
        _deliverable_version_references(db, version=version)
    )
    return {
        "version_uuid": version.uuid,
        "version_no": version.version,
        "parent_version_uuid": (
            parent_version.uuid if parent_version is not None else None
        ),
        "skill_version_uuid": skill_version.uuid,
        "template_version_uuid": template_version.uuid,
        "title_snapshot": version.title_snapshot,
        "summary_snapshot": version.summary_snapshot,
        "change_summary": version.change_summary,
        "creation_reason": version.creation_reason,
        "content_hash": version.content_hash,
        "created_by": version.created_by,
        "created_at": version.created_at,
        "is_current": version.id == artifact.current_version_id,
        "is_approved": version.id == artifact.approved_version_id,
        "is_delivered": version.id == artifact.delivered_version_id,
    }


def deliverable_version_payload(
    db: Session,
    *,
    version: WorkArtifactVersion,
    cipher: ContentCipher,
) -> dict[str, Any]:
    parent_version, skill_version, template_version = (
        _deliverable_version_references(db, version=version)
    )
    if version.content_ciphertext is None or version.content_nonce is None:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_VERSION_NOT_AVAILABLE",
            "成果当前版本不可用",
            409,
        )
    content = cipher.decrypt_json(
        EncryptedPayload(version.content_ciphertext, version.content_nonce),
        version.uuid.encode("utf-8"),
    )
    return {
        "version_uuid": version.uuid,
        "version_no": version.version,
        "parent_version_uuid": (
            parent_version.uuid if parent_version is not None else None
        ),
        "skill_version_uuid": skill_version.uuid,
        "template_version_uuid": template_version.uuid,
        "title_snapshot": version.title_snapshot,
        "summary_snapshot": version.summary_snapshot,
        "change_summary": version.change_summary,
        "creation_reason": version.creation_reason,
        "content": content,
        "content_hash": version.content_hash,
        "created_at": version.created_at,
    }


_MISSING = object()


def _json_pointer_path(path: str, segment: str | int) -> str:
    escaped = str(segment).replace("~", "~0").replace("/", "~1")
    return f"{path}/{escaped}"


def _diff_json_values(
    before: Any,
    after: Any,
    *,
    path: str,
) -> list[dict[str, Any]]:
    if before is _MISSING:
        return [
            {
                "path": path,
                "change_type": "added",
                "before": None,
                "after": after,
            }
        ]
    if after is _MISSING:
        return [
            {
                "path": path,
                "change_type": "removed",
                "before": before,
                "after": None,
            }
        ]
    if isinstance(before, dict) and isinstance(after, dict):
        changes: list[dict[str, Any]] = []
        keys = [*before, *(key for key in after if key not in before)]
        for key in keys:
            changes.extend(
                _diff_json_values(
                    before.get(key, _MISSING),
                    after.get(key, _MISSING),
                    path=_json_pointer_path(path, key),
                )
            )
        return changes
    if isinstance(before, list) and isinstance(after, list):
        changes = []
        for index in range(max(len(before), len(after))):
            changes.extend(
                _diff_json_values(
                    before[index] if index < len(before) else _MISSING,
                    after[index] if index < len(after) else _MISSING,
                    path=_json_pointer_path(path, index),
                )
            )
        return changes
    if before == after:
        return []
    return [
        {
            "path": path or "/",
            "change_type": "modified",
            "before": before,
            "after": after,
        }
    ]


def deliverable_version_diff_payload(
    db: Session,
    *,
    from_version: WorkArtifactVersion,
    to_version: WorkArtifactVersion,
    cipher: ContentCipher,
) -> dict[str, Any]:
    from_content = deliverable_version_payload(
        db,
        version=from_version,
        cipher=cipher,
    )["content"]
    to_content = deliverable_version_payload(
        db,
        version=to_version,
        cipher=cipher,
    )["content"]
    from_blocks = list(from_content.get("blocks") or [])
    to_blocks = list(to_content.get("blocks") or [])
    from_by_id = {str(block["block_id"]): block for block in from_blocks}
    to_by_id = {str(block["block_id"]): block for block in to_blocks}

    added_blocks = 0
    removed_blocks = 0
    modified_blocks = 0
    unchanged_blocks = 0
    changes: list[dict[str, Any]] = []
    for after in to_blocks:
        block_id = str(after["block_id"])
        before = from_by_id.get(block_id)
        if before is None:
            added_blocks += 1
            changes.append(
                {
                    "block_id": block_id,
                    "block_type": str(after["type"]),
                    "change_type": "added",
                    "before": None,
                    "after": after,
                    "field_changes": [],
                }
            )
            continue
        field_changes = _diff_json_values(before, after, path="")
        if not field_changes:
            unchanged_blocks += 1
            continue
        modified_blocks += 1
        changes.append(
            {
                "block_id": block_id,
                "block_type": str(after["type"]),
                "change_type": "modified",
                "before": before,
                "after": after,
                "field_changes": field_changes,
            }
        )

    for before in from_blocks:
        block_id = str(before["block_id"])
        if block_id in to_by_id:
            continue
        removed_blocks += 1
        changes.append(
            {
                "block_id": block_id,
                "block_type": str(before["type"]),
                "change_type": "removed",
                "before": before,
                "after": None,
                "field_changes": [],
            }
        )

    return {
        "from_version_uuid": from_version.uuid,
        "from_version_no": from_version.version,
        "to_version_uuid": to_version.uuid,
        "to_version_no": to_version.version,
        "summary": {
            "added_blocks": added_blocks,
            "removed_blocks": removed_blocks,
            "modified_blocks": modified_blocks,
            "unchanged_blocks": unchanged_blocks,
        },
        "changes": changes,
    }


def deliverable_detail_payload(
    db: Session,
    *,
    access: DeliverableAccess,
    cipher: ContentCipher,
    request_id: str,
) -> dict[str, Any]:
    artifact = access.artifact
    version = (
        db.get(WorkArtifactVersion, artifact.current_version_id)
        if artifact.current_version_id is not None
        else None
    )
    if version is None:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_VERSION_NOT_AVAILABLE",
            "成果当前版本不可用",
            409,
        )
    return {
        "request_id": request_id,
        **deliverable_summary_payload(db, access),
        "current_version": deliverable_version_payload(
            db,
            version=version,
            cipher=cipher,
        ),
        "source_change_notice": deliverable_source_change_notice(
            db,
            artifact=artifact,
            version=version,
        ),
    }


def deliverable_source_change_notice(
    db: Session,
    *,
    artifact: WorkArtifact,
    version: WorkArtifactVersion,
) -> dict[str, Any] | None:
    affected_evidence_count = int(
        db.scalar(
            select(func.count(DeliverableEvidence.id)).where(
                DeliverableEvidence.deliverable_version_id == version.id,
                DeliverableEvidence.status.in_(
                    ("stale", "revoked", "inaccessible")
                ),
            )
        )
        or 0
    )
    if affected_evidence_count == 0:
        return None
    historical_snapshot_preserved = (
        artifact.lifecycle_status in {"delivered", "archived"}
        and artifact.delivered_version_id == version.id
    )
    return {
        "message": (
            "来源后续已变化"
            if historical_snapshot_preserved
            else "来源已变化，需重新审阅"
        ),
        "affected_evidence_count": affected_evidence_count,
        "historical_snapshot_preserved": historical_snapshot_preserved,
    }


def _require_deliverable_review_access(access: DeliverableAccess) -> None:
    if access.artifact.scope_type == "personal":
        return
    if access.member is None or access.member.role not in PROJECT_REVIEWER_ROLES:
        raise ProfessionalDeliveryError(
            "PROJECT_DELIVERABLE_REVIEW_FORBIDDEN",
            "当前项目角色不能执行或处理成果质量审查",
            403,
        )


def _load_review_rule_versions(
    db: Session,
    *,
    version: WorkArtifactVersion,
) -> list[tuple[QualityRuleDefinition, QualityRuleVersion]]:
    if version.skill_version_id is None:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_VERSION_NOT_AVAILABLE",
            "成果当前版本未绑定 Skill 版本",
            409,
        )
    skill_version = db.get(SkillVersion, version.skill_version_id)
    if skill_version is None:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_VERSION_NOT_AVAILABLE",
            "成果绑定的 Skill 版本不可用",
            409,
        )

    rule_version_ids = [
        int(value)
        for value in (skill_version.quality_policy_ids_json or [])
        if (isinstance(value, int) and not isinstance(value, bool))
        or (isinstance(value, str) and value.isdigit())
    ]
    loaded: list[tuple[QualityRuleDefinition, QualityRuleVersion]] = []
    for rule_version_id in rule_version_ids:
        rule_version = db.get(QualityRuleVersion, rule_version_id)
        rule = (
            db.get(QualityRuleDefinition, rule_version.rule_id)
            if rule_version is not None
            else None
        )
        if (
            rule_version is None
            or rule is None
            or rule_version.status != "published"
            or rule.status != "published"
        ):
            continue
        loaded.append((rule, rule_version))

    loaded_categories = {rule.category for rule, _ in loaded}
    missing_categories = [
        category
        for category in REQUIRED_REVIEW_CATEGORIES
        if category not in loaded_categories
    ]
    if missing_categories:
        raise ProfessionalDeliveryError(
            "QUALITY_RULE_SET_INCOMPLETE",
            "成果质量审查规则集不完整",
            422,
            {"missing_categories": missing_categories},
        )
    return loaded


def _evidence_ids(block: dict[str, Any]) -> list[str]:
    values = block.get("evidence_ids")
    if not isinstance(values, list):
        return []
    return [str(value) for value in values if str(value).strip()]


def _iter_text_values(value: Any):
    if isinstance(value, str):
        yield value
        return
    if isinstance(value, dict):
        for child in value.values():
            yield from _iter_text_values(child)
        return
    if isinstance(value, list):
        for child in value:
            yield from _iter_text_values(child)


def _evaluate_quality_rule(
    *,
    rule: QualityRuleDefinition,
    rule_version: QualityRuleVersion,
    content: dict[str, Any],
    expected_project_scope: dict[str, Any],
    actual_project_scope: dict[str, Any],
) -> list[dict[str, Any]]:
    blocks = [block for block in content.get("blocks", []) if isinstance(block, dict)]
    config = dict(rule_version.config_json or {})
    evaluator = rule_version.evaluator_type
    issues: list[dict[str, Any]] = []

    if evaluator == "required_blocks":
        present = {
            str(block.get("block_id") or "").strip()
            for block in blocks
            if str(block.get("block_id") or "").strip()
        }
        required = [
            str(value).strip()
            for value in config.get("required_block_ids", [])
            if str(value).strip()
        ]
        for block_id in required:
            if block_id not in present:
                issues.append(
                    {
                        "block_id": block_id,
                        "message": "成果缺少必需的结构化内容块",
                        "evidence_ids": [],
                        "suggested_fix": "按模板补齐对应内容块后重新审查",
                    }
                )
        return issues

    if evaluator == "fact_status_gate":
        blocked_statuses = {
            str(value).strip().lower()
            for value in config.get("blocked_statuses", [])
            if str(value).strip()
        }
        critical_only = config.get("critical_only") is True
        for block in blocks:
            if critical_only and block.get("critical") is not True:
                continue
            fact_status = str(block.get("fact_status") or "").strip().lower()
            if fact_status not in blocked_statuses:
                continue
            issues.append(
                {
                    "block_id": str(block.get("block_id") or ""),
                    "message": "关键事实缺少可用证据或存在证据冲突",
                    "evidence_ids": _evidence_ids(block),
                    "suggested_fix": "补齐可核验依据并更新事实状态后重新审查",
                }
            )
        return issues

    if evaluator == "project_scope_gate":
        if actual_project_scope != expected_project_scope:
            issues.append(
                {
                    "block_id": "",
                    "message": "成果版本的项目范围快照与当前成果范围不一致",
                    "evidence_ids": [],
                    "suggested_fix": "基于当前项目范围创建新成果版本后重新审查",
                }
            )
        return issues

    if evaluator == "declared_count_gate":
        for block in blocks:
            declared_count = block.get("declared_count")
            items = block.get("items")
            if (
                isinstance(declared_count, int)
                and not isinstance(declared_count, bool)
                and isinstance(items, list)
                and declared_count != len(items)
            ):
                issues.append(
                    {
                        "block_id": str(block.get("block_id") or ""),
                        "message": "内容块声明数量与明细数量不一致",
                        "evidence_ids": _evidence_ids(block),
                        "suggested_fix": "核对并统一声明数量与明细数量",
                    }
                )
        return issues

    if evaluator == "required_block_fields":
        required_fields = [
            str(value).strip()
            for value in config.get("required_fields", [])
            if str(value).strip()
        ]
        for block in blocks:
            missing_fields = [
                field
                for field in required_fields
                if field not in block or block[field] in (None, "")
            ]
            if missing_fields:
                issues.append(
                    {
                        "block_id": str(block.get("block_id") or ""),
                        "message": "内容块缺少格式契约要求的字段",
                        "evidence_ids": _evidence_ids(block),
                        "suggested_fix": "补齐内容块必需字段后重新审查",
                    }
                )
        return issues

    if evaluator == "forbidden_literals":
        literals = [
            str(value).casefold()
            for value in config.get("literals", [])
            if str(value).strip()
        ]
        for block in blocks:
            if any(
                literal in text.casefold()
                for text in _iter_text_values(block)
                for literal in literals
            ):
                issues.append(
                    {
                        "block_id": str(block.get("block_id") or ""),
                        "message": "内容块包含禁止写入成果的敏感信息",
                        "evidence_ids": [],
                        "suggested_fix": "删除或脱敏相关信息后重新审查",
                    }
                )
        return issues

    raise ProfessionalDeliveryError(
        "QUALITY_RULE_NOT_SUPPORTED",
        f"质量规则执行器 {evaluator} 不受支持",
        422,
        {"rule_uuid": rule.uuid},
    )


def _run_quality_rules(
    *,
    rules: list[tuple[QualityRuleDefinition, QualityRuleVersion]],
    content: dict[str, Any],
    expected_project_scope: dict[str, Any],
    actual_project_scope: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    category_results: list[dict[str, Any]] = []
    issue_specs: list[dict[str, Any]] = []
    for category in REQUIRED_REVIEW_CATEGORIES:
        started = perf_counter()
        category_rules = [item for item in rules if item[0].category == category]
        category_specs: list[dict[str, Any]] = []
        for rule, rule_version in category_rules:
            evaluated = _evaluate_quality_rule(
                rule=rule,
                rule_version=rule_version,
                content=content,
                expected_project_scope=expected_project_scope,
                actual_project_scope=actual_project_scope,
            )
            for issue in evaluated:
                category_specs.append(
                    {
                        **issue,
                        "rule_version_id": rule_version.id,
                        "category": category,
                        "severity": rule_version.severity,
                        "blocking": (
                            rule_version.blocking
                            or rule_version.severity == "blocker"
                        ),
                    }
                )
        blocking_issue_count = sum(
            1 for issue in category_specs if issue["blocking"]
        )
        category_results.append(
            {
                "category": category,
                "status": "failed" if blocking_issue_count else "passed",
                "rule_count": len(category_rules),
                "issue_count": len(category_specs),
                "blocking_issue_count": blocking_issue_count,
                "duration_ms": int((perf_counter() - started) * 1000),
            }
        )
        issue_specs.extend(category_specs)
    return category_results, issue_specs


def _evidence_source_stale_reason(
    db: Session,
    *,
    artifact: WorkArtifact,
    evidence: DeliverableEvidence,
) -> str | None:
    if evidence.source_type == "human_confirmation":
        return None
    if evidence.source_type != "knowledge_chunk":
        return "unsupported_source_type"
    chunk = db.scalar(
        select(KnowledgeChunk).where(KnowledgeChunk.chunk_id == evidence.source_uuid)
    )
    file = db.get(KnowledgeFile, chunk.file_id) if chunk is not None else None
    if chunk is None or file is None:
        return "source_unavailable"
    if file.deleted_at is not None or chunk.deleted_at is not None:
        return "source_deleted"
    if file.reference_enabled is not True:
        return "source_reference_disabled"
    if file.is_current_version is not True or str(file.version) != evidence.source_version:
        return "source_version_changed"
    if file.status != "READY" or chunk.status != "READY":
        return "source_unavailable"
    if file.content_sha256 != evidence.source_content_hash:
        return "source_content_changed"
    if artifact.scope_type == "personal":
        if evidence.project_id is not None or artifact.project_id is not None:
            return "source_scope_changed"
        return None
    if artifact.project_id is None or evidence.project_id != artifact.project_id:
        return "source_scope_changed"
    if (
        db.scalar(
            select(ProjectFile.id).where(
                ProjectFile.project_id == artifact.project_id,
                ProjectFile.knowledge_file_id == file.id,
                ProjectFile.status == "active",
            )
        )
        is None
    ):
        return "source_scope_changed"
    return None


def _evidence_source_is_current(
    db: Session,
    *,
    artifact: WorkArtifact,
    evidence: DeliverableEvidence,
) -> bool:
    return (
        _evidence_source_stale_reason(
            db,
            artifact=artifact,
            evidence=evidence,
        )
        is None
    )


def recompute_fact_status(
    db: Session,
    fact: DeliverableFact,
    actor_user_id: str,
) -> None:
    rows = db.execute(
        select(FactEvidenceLink, DeliverableEvidence)
        .join(
            DeliverableEvidence,
            DeliverableEvidence.id == FactEvidenceLink.evidence_id,
        )
        .where(
            FactEvidenceLink.fact_id == fact.id,
            FactEvidenceLink.status == "active",
        )
    ).all()
    active_contradiction = any(
        link.relation == "contradicts" and evidence.status == "active"
        for link, evidence in rows
    )
    active_support = any(
        link.relation in {"supports", "derived_from"}
        and evidence.status == "active"
        for link, evidence in rows
    )
    inactive_support = any(
        link.relation in {"supports", "derived_from"}
        and evidence.status in {"stale", "revoked", "inaccessible"}
        for link, evidence in rows
    )
    if active_contradiction:
        next_status = "conflicted"
    elif active_support:
        next_status = "supported"
    elif inactive_support:
        next_status = "stale"
    elif fact.claim_type == "inference":
        next_status = "inference"
    else:
        next_status = "pending_confirmation"
    if fact.status != next_status:
        fact.status = next_status
        fact.row_version += 1
        fact.updated_by = actor_user_id


@dataclass(frozen=True, slots=True)
class EvidenceRefreshResult:
    stale_evidence_uuids: tuple[str, ...]


def refresh_deliverable_evidence_state(
    db: Session,
    *,
    artifact: WorkArtifact,
    version: WorkArtifactVersion,
    actor_user_id: str,
) -> EvidenceRefreshResult:
    evidence_rows = list(
        db.scalars(
            select(DeliverableEvidence)
            .where(
                DeliverableEvidence.deliverable_version_id == version.id,
                DeliverableEvidence.status == "active",
            )
            .order_by(DeliverableEvidence.id.asc())
            .with_for_update()
        )
    )
    stale_evidence: list[DeliverableEvidence] = []
    for evidence in evidence_rows:
        stale_reason = _evidence_source_stale_reason(
            db,
            artifact=artifact,
            evidence=evidence,
        )
        if stale_reason is None:
            continue
        evidence.status = "stale"
        evidence.stale_reason = stale_reason
        evidence.row_version += 1
        stale_evidence.append(evidence)

    if not stale_evidence:
        return EvidenceRefreshResult(())

    stale_evidence_ids = [evidence.id for evidence in stale_evidence]
    fact_ids = list(
        db.scalars(
            select(FactEvidenceLink.fact_id)
            .where(
                FactEvidenceLink.evidence_id.in_(stale_evidence_ids),
                FactEvidenceLink.status == "active",
            )
            .distinct()
        )
    )
    if fact_ids:
        facts = list(
            db.scalars(
                select(DeliverableFact)
                .where(DeliverableFact.id.in_(fact_ids))
                .with_for_update()
            )
        )
        for fact in facts:
            recompute_fact_status(db, fact, actor_user_id)

    if (
        artifact.current_version_id == version.id
        and artifact.lifecycle_status not in {"delivered", "archived"}
    ):
        artifact.lifecycle_status = "changes_requested"
        artifact.row_version += 1
        if artifact.approved_version_id == version.id:
            artifact.approved_version_id = None
            artifact.approved_content_hash = ""

    db.flush()
    return EvidenceRefreshResult(
        tuple(evidence.uuid for evidence in stale_evidence)
    )


def _database_fact_evidence_issues(
    db: Session,
    *,
    artifact: WorkArtifact,
    version: WorkArtifactVersion,
    rules: list[tuple[QualityRuleDefinition, QualityRuleVersion]],
) -> list[dict[str, Any]]:
    facts = list(
        db.scalars(
            select(DeliverableFact)
            .where(
                DeliverableFact.deliverable_version_id == version.id,
                DeliverableFact.critical.is_(True),
            )
            .order_by(DeliverableFact.id.asc())
        )
    )
    if not facts:
        return []
    fact_rule = next(
        (
            item
            for item in rules
            if item[0].category == "facts_evidence"
            and item[1].evaluator_type == "fact_status_gate"
        ),
        next((item for item in rules if item[0].category == "facts_evidence"), None),
    )
    if fact_rule is None:
        return []
    _, rule_version = fact_rule
    blocked_statuses = {
        str(value).strip().lower()
        for value in dict(rule_version.config_json or {}).get(
            "blocked_statuses",
            ["pending_confirmation", "unsupported", "conflicted", "stale"],
        )
        if str(value).strip()
    }
    issues: list[dict[str, Any]] = []
    for fact in facts:
        rows = db.execute(
            select(FactEvidenceLink, DeliverableEvidence)
            .join(
                DeliverableEvidence,
                DeliverableEvidence.id == FactEvidenceLink.evidence_id,
            )
            .where(
                FactEvidenceLink.fact_id == fact.id,
                FactEvidenceLink.status == "active",
            )
        ).all()
        active_rows = [
            (link, evidence)
            for link, evidence in rows
            if evidence.status == "active"
        ]
        current_rows = [
            (link, evidence)
            for link, evidence in active_rows
            if _evidence_source_is_current(
                db,
                artifact=artifact,
                evidence=evidence,
            )
        ]
        supports = [
            (link, evidence)
            for link, evidence in current_rows
            if link.relation in {"supports", "derived_from"}
            and not (
                fact.source_required
                and evidence.source_type == "human_confirmation"
            )
        ]
        contradictions = [
            evidence
            for link, evidence in current_rows
            if link.relation == "contradicts"
        ]
        invalid_evidence = [
            evidence
            for _, evidence in rows
            if evidence.status != "active"
            or not _evidence_source_is_current(
                db,
                artifact=artifact,
                evidence=evidence,
            )
        ]
        reasons: list[str] = []
        if fact.status in blocked_statuses:
            reasons.append("事实状态未通过")
        if not supports:
            reasons.append("缺少有效支持证据")
        if contradictions:
            reasons.append("存在未解决的反证")
        if invalid_evidence and not supports:
            reasons.append("关联证据已失效或来源已变化")
        if fact.human_confirmation_required and not fact.confirmed_by:
            reasons.append("缺少必要的人工确认")
        if not reasons:
            continue
        evidence_ids = list(
            dict.fromkeys(evidence.uuid for _, evidence in rows)
        )
        issues.append(
            {
                "rule_version_id": rule_version.id,
                "category": "facts_evidence",
                "severity": rule_version.severity,
                "blocking": (
                    rule_version.blocking or rule_version.severity == "blocker"
                ),
                "block_id": fact.block_id,
                "message": "关键事实证据门禁未通过：" + "；".join(reasons),
                "evidence_ids": evidence_ids,
                "suggested_fix": "补齐可核验依据、解决反证或更新事实状态后重新审查",
            }
        )
    return issues


def require_deliverable_evidence_gate(
    db: Session,
    *,
    artifact: WorkArtifact,
    version: WorkArtifactVersion,
    checkpoint: str,
    actor_user_id: str,
) -> None:
    critical_fact_id = db.scalar(
        select(DeliverableFact.id).where(
            DeliverableFact.deliverable_version_id == version.id,
            DeliverableFact.critical.is_(True),
        )
    )
    if critical_fact_id is None:
        return

    refresh_result = refresh_deliverable_evidence_state(
        db,
        artifact=artifact,
        version=version,
        actor_user_id=actor_user_id,
    )
    rules = _load_review_rule_versions(db, version=version)
    blocking_issues = [
        issue
        for issue in _database_fact_evidence_issues(
            db,
            artifact=artifact,
            version=version,
            rules=rules,
        )
        if issue["blocking"]
    ]
    if not blocking_issues and not refresh_result.stale_evidence_uuids:
        return

    if not blocking_issues:
        blocking_issues.append(
            {
                "block_id": "evidence-source",
                "message": "关键事实证据来源已变化，当前版本必须重新执行质量审查",
                "evidence_ids": list(refresh_result.stale_evidence_uuids),
                "suggested_fix": "确认更新后的来源并重新关联证据，然后重新执行质量审查",
            }
        )

    error_type = (
        ProfessionalDeliveryEvidenceInvalidatedError
        if refresh_result.stale_evidence_uuids
        else ProfessionalDeliveryError
    )
    raise error_type(
        "DELIVERABLE_EVIDENCE_GATE_FAILED",
        "成果关键事实的证据已失效，请修复并重新执行质量审查",
        422,
        {
            "checkpoint": checkpoint,
            "version_uuid": version.uuid,
            "content_hash": version.content_hash,
            "invalidated_evidence_uuids": list(
                refresh_result.stale_evidence_uuids
            ),
            "issues": [
                {
                    "block_id": issue["block_id"],
                    "message": issue["message"],
                    "evidence_ids": issue["evidence_ids"],
                    "suggested_fix": issue["suggested_fix"],
                }
                for issue in blocking_issues
            ],
        },
    )


def _append_database_fact_evidence_results(
    *,
    category_results: list[dict[str, Any]],
    issue_specs: list[dict[str, Any]],
    database_issues: list[dict[str, Any]],
) -> None:
    if not database_issues:
        return
    existing_keys = {
        (issue["category"], issue["block_id"])
        for issue in issue_specs
    }
    new_issues = [
        issue
        for issue in database_issues
        if (issue["category"], issue["block_id"]) not in existing_keys
    ]
    if not new_issues:
        return
    issue_specs.extend(new_issues)
    category_result = next(
        item for item in category_results if item["category"] == "facts_evidence"
    )
    category_result["issue_count"] += len(new_issues)
    category_result["blocking_issue_count"] += sum(
        1 for issue in new_issues if issue["blocking"]
    )
    if category_result["blocking_issue_count"]:
        category_result["status"] = "failed"


def create_deliverable_review(
    db: Session,
    *,
    deliverable_uuid: str,
    body: ReviewStartIn,
    actor_user_id: str,
    idempotency_key: str,
    request_id: str,
    cipher: ContentCipher,
    enforce_actor_review_access: bool = True,
) -> ReviewCreateResult:
    access = get_visible_deliverable(
        db,
        deliverable_uuid=deliverable_uuid,
        actor_user_id=actor_user_id,
        lock=True,
    )
    if enforce_actor_review_access:
        _require_deliverable_review_access(access)
    artifact = access.artifact
    request_hash = _canonical_hash(
        {
            "deliverable_uuid": deliverable_uuid,
            "body": body.model_dump(mode="json"),
        }
    )
    existing = db.scalar(
        select(ReviewRun).where(
            ReviewRun.initiated_by == actor_user_id,
            ReviewRun.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        if existing.request_hash != request_hash:
            raise ProfessionalDeliveryError(
                "IDEMPOTENCY_KEY_REUSED",
                "该幂等键已用于不同请求",
                409,
            )
        if existing.deliverable_id != artifact.id:
            raise ProfessionalDeliveryError(
                "IDEMPOTENCY_RECORD_INVALID",
                "幂等记录对应的质量审查不存在",
                409,
            )
        issues = list(
            db.scalars(
                select(ReviewIssue)
                .where(ReviewIssue.review_run_id == existing.id)
                .order_by(ReviewIssue.id.asc())
            )
        )
        return ReviewCreateResult(artifact, existing, issues, True)

    if artifact.row_version != body.row_version:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_VERSION_CONFLICT",
            "成果已被其他操作更新，请刷新后重试",
            409,
            {"current_row_version": artifact.row_version},
        )
    version = (
        db.get(WorkArtifactVersion, artifact.current_version_id)
        if artifact.current_version_id is not None
        else None
    )
    if (
        version is None
        or version.uuid != body.version_uuid
        or version.content_hash != body.content_hash
    ):
        raise ProfessionalDeliveryError(
            "DELIVERABLE_REVIEW_TARGET_STALE",
            "审查目标已不是成果当前版本",
            409,
        )
    if artifact.lifecycle_status not in {"draft", "changes_requested"}:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_REVIEW_FORBIDDEN",
            "成果当前状态不允许发起质量审查",
            422,
        )
    if version.template_version_id is None or version.skill_version_id is None:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_VERSION_NOT_AVAILABLE",
            "成果当前版本未绑定 Skill 或模板版本",
            409,
        )

    rules = _load_review_rule_versions(db, version=version)
    content = deliverable_version_payload(db, version=version, cipher=cipher)[
        "content"
    ]
    expected_project_scope = (
        {"project_uuid": access.project.uuid}
        if access.project is not None
        else {}
    )
    actual_project_scope = dict(version.project_scope_snapshot_json or {})
    review_started = perf_counter()
    category_results, issue_specs = _run_quality_rules(
        rules=rules,
        content=content,
        expected_project_scope=expected_project_scope,
        actual_project_scope=actual_project_scope,
    )
    _append_database_fact_evidence_results(
        category_results=category_results,
        issue_specs=issue_specs,
        database_issues=_database_fact_evidence_issues(
            db,
            artifact=artifact,
            version=version,
            rules=rules,
        ),
    )
    blocking_issue_count = sum(1 for issue in issue_specs if issue["blocking"])
    severity_counts = {
        severity: sum(1 for issue in issue_specs if issue["severity"] == severity)
        for severity in ("info", "warning", "error", "blocker")
    }
    gates_passed = blocking_issue_count == 0
    status = "passed" if gates_passed else "failed"
    total_score = max(
        0,
        100
        - severity_counts["blocker"] * 25
        - severity_counts["error"] * 10
        - severity_counts["warning"] * 3
        - severity_counts["info"],
    )

    try:
        quality_review_status = transition_lifecycle(
            LifecycleStatus(artifact.lifecycle_status),
            LifecycleAction.SUBMIT_QUALITY_REVIEW,
            TransitionContext(
                has_current_version=True,
                content_hash_unchanged=True,
            ),
        )
        final_status = transition_lifecycle(
            quality_review_status,
            (
                LifecycleAction.QUALITY_REVIEW_PASSED
                if gates_passed
                else LifecycleAction.QUALITY_REVIEW_FAILED
            ),
            TransitionContext(
                has_blocking_issues=not gates_passed,
                quality_gates_passed=gates_passed,
            ),
        )
    except DeliverableDomainError as error:
        raise ProfessionalDeliveryError(error.code, str(error), 422) from error

    rule_version_ids = [rule_version.id for _, rule_version in rules]
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    run = ReviewRun(
        deliverable_id=artifact.id,
        deliverable_version_id=version.id,
        content_hash=version.content_hash,
        skill_version_id=version.skill_version_id,
        template_version_id=version.template_version_id,
        rule_version_ids_json=rule_version_ids,
        execution_context_hash=_canonical_hash(
            {
                "deliverable_uuid": artifact.uuid,
                "version_uuid": version.uuid,
                "actor_user_id": actor_user_id,
                "rule_version_ids": rule_version_ids,
            }
        ),
        project_scope_hash=_canonical_hash(actual_project_scope),
        status=status,
        gates_passed=gates_passed,
        total_score=total_score,
        steps_json=category_results,
        result_summary_json={
            "category_results": category_results,
            "issue_count": len(issue_specs),
            "blocking_issue_count": blocking_issue_count,
            "severity_counts": severity_counts,
        },
        model_identity_hash=_canonical_hash({"engine": "deterministic-v1"}),
        initiated_by=actor_user_id,
        completed_at=now,
        audit_request_id=request_id,
        duration_ms=int((perf_counter() - review_started) * 1000),
        idempotency_key=idempotency_key,
        request_hash=request_hash,
    )
    db.add(run)
    db.flush()

    issues: list[ReviewIssue] = []
    for issue_spec in issue_specs:
        issue = ReviewIssue(
            review_run_id=run.id,
            rule_version_id=issue_spec["rule_version_id"],
            category=issue_spec["category"],
            severity=issue_spec["severity"],
            blocking=issue_spec["blocking"],
            block_id=issue_spec["block_id"],
            char_start=None,
            char_end=None,
            message=issue_spec["message"],
            evidence_ids_json=issue_spec["evidence_ids"],
            suggested_fix=issue_spec["suggested_fix"],
            status="open",
        )
        db.add(issue)
        issues.append(issue)
    artifact.lifecycle_status = final_status.value
    artifact.row_version += 1
    db.flush()
    return ReviewCreateResult(artifact, run, issues, False)


def list_deliverable_reviews(
    db: Session,
    *,
    artifact: WorkArtifact,
    page: int,
    page_size: int,
) -> tuple[list[ReviewRun], int]:
    filters = (ReviewRun.deliverable_id == artifact.id,)
    total = int(db.scalar(select(func.count(ReviewRun.id)).where(*filters)) or 0)
    runs = list(
        db.scalars(
            select(ReviewRun)
            .where(*filters)
            .order_by(ReviewRun.created_at.desc(), ReviewRun.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return runs, total


def list_review_issues(db: Session, *, run: ReviewRun) -> list[ReviewIssue]:
    return list(
        db.scalars(
            select(ReviewIssue)
            .where(ReviewIssue.review_run_id == run.id)
            .order_by(ReviewIssue.id.asc())
        )
    )


def get_review_issue_access(
    db: Session,
    *,
    issue_uuid: str,
    actor_user_id: str,
) -> ReviewIssueAccess:
    issue = db.scalar(select(ReviewIssue).where(ReviewIssue.uuid == issue_uuid))
    run = db.get(ReviewRun, issue.review_run_id) if issue is not None else None
    artifact = db.get(WorkArtifact, run.deliverable_id) if run is not None else None
    if issue is None or run is None or artifact is None:
        raise ProfessionalDeliveryError(
            "REVIEW_ISSUE_NOT_FOUND",
            "审查问题不存在",
            404,
        )
    access = get_visible_deliverable(
        db,
        deliverable_uuid=artifact.uuid,
        actor_user_id=actor_user_id,
    )
    return ReviewIssueAccess(access, run, issue)


def update_review_issue(
    db: Session,
    *,
    issue_uuid: str,
    body: ReviewIssueUpdateIn,
    actor_user_id: str,
) -> ReviewIssueAccess:
    issue_access = get_review_issue_access(
        db,
        issue_uuid=issue_uuid,
        actor_user_id=actor_user_id,
    )
    _require_deliverable_review_access(issue_access.access)
    issue = issue_access.issue
    if issue.status != "open":
        raise ProfessionalDeliveryError(
            "REVIEW_ISSUE_ALREADY_CLOSED",
            "审查问题已完成处置",
            409,
        )
    if issue.blocking and body.status in {"accepted_risk", "wont_fix"}:
        raise ProfessionalDeliveryError(
            "REVIEW_ISSUE_WAIVER_FORBIDDEN",
            "阻断问题不能通过风险接受或忽略关闭",
            422,
        )
    issue.status = body.status
    issue.handled_by = actor_user_id
    issue.handling_reason = body.reason
    issue.handled_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.flush()
    return issue_access


def review_issue_payload(
    db: Session,
    *,
    run: ReviewRun,
    issue: ReviewIssue,
) -> dict[str, Any]:
    rule_version = db.get(QualityRuleVersion, issue.rule_version_id)
    if rule_version is None:
        raise ProfessionalDeliveryError(
            "REVIEW_RECORD_INVALID",
            "审查问题绑定的规则版本不存在",
            409,
        )
    return {
        "issue_uuid": issue.uuid,
        "review_uuid": run.uuid,
        "rule_version_uuid": rule_version.uuid,
        "category": issue.category,
        "severity": issue.severity,
        "blocking": issue.blocking,
        "block_id": issue.block_id,
        "char_start": issue.char_start,
        "char_end": issue.char_end,
        "message": issue.message,
        "evidence_ids": [str(value) for value in issue.evidence_ids_json or []],
        "suggested_fix": issue.suggested_fix,
        "status": issue.status,
        "handled_by": issue.handled_by,
        "handling_reason": issue.handling_reason,
        "handled_at": issue.handled_at,
        "created_at": issue.created_at,
    }


def review_run_payload(
    db: Session,
    *,
    run: ReviewRun,
    issues: list[ReviewIssue] | None = None,
) -> dict[str, Any]:
    version = db.get(WorkArtifactVersion, run.deliverable_version_id)
    if version is None:
        raise ProfessionalDeliveryError(
            "REVIEW_RECORD_INVALID",
            "审查运行绑定的成果版本不存在",
            409,
        )
    rule_versions = [
        db.get(QualityRuleVersion, int(rule_version_id))
        for rule_version_id in run.rule_version_ids_json or []
    ]
    if any(rule_version is None for rule_version in rule_versions):
        raise ProfessionalDeliveryError(
            "REVIEW_RECORD_INVALID",
            "审查运行绑定的规则版本不存在",
            409,
        )
    resolved_issues = issues if issues is not None else list_review_issues(db, run=run)
    return {
        "review_uuid": run.uuid,
        "version_uuid": version.uuid,
        "version_no": version.version,
        "content_hash": run.content_hash,
        "status": run.status,
        "gates_passed": run.gates_passed,
        "total_score": run.total_score,
        "rule_version_uuids": [
            rule_version.uuid for rule_version in rule_versions if rule_version is not None
        ],
        "category_results": list(
            (run.result_summary_json or {}).get("category_results") or []
        ),
        "issues": [
            review_issue_payload(db, run=run, issue=issue)
            for issue in resolved_issues
        ],
        "initiated_by": run.initiated_by,
        "completed_at": run.completed_at,
        "created_at": run.created_at,
    }
