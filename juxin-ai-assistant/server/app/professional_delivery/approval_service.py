from __future__ import annotations

import uuid as uuid_lib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..crypto import ContentCipher, EncryptedPayload
from ..models import WorkArtifact, WorkArtifactVersion
from .catalog_service import supports_deliverable_type
from .domain import (
    DeliverableDomainError,
    LifecycleAction,
    LifecycleStatus,
    TransitionContext,
    transition_lifecycle,
)
from .models import (
    ApprovalEvent,
    ApprovalFlowDefinition,
    ApprovalFlowVersion,
    DeliverableComment,
    DeliverableCommentReply,
    DeliverableExport,
    DeliveryRecord,
    ReviewRun,
)
from .schemas import (
    DeliverableApproveIn,
    DeliverableArchiveIn,
    DeliverableCommentCreateIn,
    DeliverableCommentReplyIn,
    DeliverableCommentResolveIn,
    DeliverableDeliverIn,
    DeliverableRequestChangesIn,
    DeliverableSubmitIn,
    ExactDeliverableVersionIn,
)
from .service import (
    PROJECT_DELIVERY_ROLES,
    PROJECT_REVIEWER_ROLES,
    PROJECT_WRITER_ROLES,
    DeliverableAccess,
    ProfessionalDeliveryError,
    _canonical_hash,
    _require_deliverable_review_access,
    _require_deliverable_write_access,
    deliverable_version_payload,
    get_deliverable_version,
    get_visible_deliverable,
    require_deliverable_evidence_gate,
)


@dataclass(frozen=True, slots=True)
class ApprovalActionResult:
    access: DeliverableAccess
    version: WorkArtifactVersion
    flow_version: ApprovalFlowVersion | None
    event: ApprovalEvent
    replayed: bool


@dataclass(frozen=True, slots=True)
class CommentMutationResult:
    access: DeliverableAccess
    comment: DeliverableComment
    replayed: bool


@dataclass(frozen=True, slots=True)
class DeliveryMutationResult:
    access: DeliverableAccess
    version: WorkArtifactVersion
    export: DeliverableExport
    delivery: DeliveryRecord
    replayed: bool


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _request_hash(body: object) -> str:
    model_dump = getattr(body, "model_dump")
    return _canonical_hash(model_dump(mode="json"))


def _idempotency_reused() -> ProfessionalDeliveryError:
    return ProfessionalDeliveryError(
        "IDEMPOTENCY_KEY_REUSED",
        "Idempotency-Key 已用于其他请求",
        409,
    )


def _transition(
    current: str,
    action: LifecycleAction,
    context: TransitionContext,
) -> str:
    try:
        return transition_lifecycle(
            LifecycleStatus(current),
            action,
            context,
        ).value
    except (DeliverableDomainError, ValueError) as error:
        code = getattr(error, "code", "DELIVERABLE_TRANSITION_INVALID")
        raise ProfessionalDeliveryError(code, str(error), 422) from error


def _exact_target(
    db: Session,
    *,
    access: DeliverableAccess,
    body: ExactDeliverableVersionIn,
) -> WorkArtifactVersion:
    version = get_deliverable_version(
        db,
        artifact=access.artifact,
        version_uuid=body.version_uuid,
    )
    artifact = access.artifact
    if (
        artifact.row_version != body.row_version
        or artifact.current_version_id != version.id
        or version.content_hash != body.content_hash
    ):
        raise ProfessionalDeliveryError(
            "DELIVERABLE_VERSION_CONFLICT",
            "成果版本已变化，请刷新后重试",
            409,
            {
                "current_row_version": artifact.row_version,
                "current_version_id": artifact.current_version_id,
            },
        )
    return version


def _approval_event_replay(
    db: Session,
    *,
    access: DeliverableAccess,
    actor_user_id: str,
    event_type: str,
    idempotency_key: str,
    request_hash: str,
) -> ApprovalActionResult | None:
    event = db.scalar(
        select(ApprovalEvent).where(
            ApprovalEvent.actor_user_id == actor_user_id,
            ApprovalEvent.event_type == event_type,
            ApprovalEvent.idempotency_key == idempotency_key,
        )
    )
    if event is None:
        return None
    if event.deliverable_id != access.artifact.id or event.request_hash != request_hash:
        raise _idempotency_reused()
    version = db.get(WorkArtifactVersion, event.deliverable_version_id)
    if version is None:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_VERSION_NOT_AVAILABLE",
            "审批事件绑定的成果版本不可用",
            409,
        )
    flow_version = (
        db.get(ApprovalFlowVersion, event.approval_flow_version_id)
        if event.approval_flow_version_id is not None
        else None
    )
    return ApprovalActionResult(access, version, flow_version, event, True)


def _published_flow_version(
    db: Session,
    *,
    artifact: WorkArtifact,
    flow_version_uuid: str,
) -> tuple[ApprovalFlowDefinition, ApprovalFlowVersion]:
    flow_version = db.scalar(
        select(ApprovalFlowVersion).where(
            ApprovalFlowVersion.uuid == flow_version_uuid,
        )
    )
    flow = (
        db.get(ApprovalFlowDefinition, flow_version.flow_id)
        if flow_version is not None
        else None
    )
    if (
        flow is None
        or flow_version is None
        or flow.status != "published"
        or flow_version.status != "published"
        or flow.current_published_version_id != flow_version.id
    ):
        raise ProfessionalDeliveryError(
            "APPROVAL_FLOW_VERSION_NOT_AVAILABLE",
            "审批流版本不存在或未发布",
            422,
        )
    if flow.scope_policy not in {"both", artifact.scope_type}:
        raise ProfessionalDeliveryError(
            "APPROVAL_FLOW_SCOPE_MISMATCH",
            "审批流不适用于当前成果范围",
            422,
        )
    if not supports_deliverable_type(
        flow.deliverable_types_json,
        artifact.deliverable_type,
    ):
        raise ProfessionalDeliveryError(
            "APPROVAL_FLOW_TYPE_MISMATCH",
            "审批流不适用于当前成果类型",
            422,
        )
    return flow, flow_version


def _pinned_flow_version(
    db: Session,
    *,
    artifact: WorkArtifact,
) -> ApprovalFlowVersion:
    flow_version = (
        db.get(ApprovalFlowVersion, artifact.approval_flow_version_id)
        if artifact.approval_flow_version_id is not None
        else None
    )
    if flow_version is None:
        raise ProfessionalDeliveryError(
            "APPROVAL_FLOW_VERSION_NOT_PINNED",
            "成果尚未绑定审批流版本",
            422,
        )
    return flow_version


def _flow_roles(flow_version: ApprovalFlowVersion) -> set[str]:
    roles: set[str] = set()
    for step in flow_version.steps_json or []:
        if not isinstance(step, dict):
            continue
        for role in step.get("roles") or []:
            normalized = str(role or "").strip()
            if normalized:
                roles.add(normalized)
    return roles


def _require_approval_access(
    access: DeliverableAccess,
    *,
    flow_version: ApprovalFlowVersion,
) -> None:
    if access.artifact.scope_type == "personal":
        return
    role = access.member.role if access.member is not None else ""
    if role not in PROJECT_REVIEWER_ROLES or role not in _flow_roles(flow_version):
        raise ProfessionalDeliveryError(
            "PROJECT_DELIVERABLE_APPROVAL_FORBIDDEN",
            "当前项目角色不能审批成果",
            403,
        )


def _latest_review_passed(
    db: Session,
    *,
    artifact: WorkArtifact,
    version: WorkArtifactVersion,
) -> None:
    run = db.scalar(
        select(ReviewRun)
        .where(ReviewRun.deliverable_id == artifact.id)
        .order_by(ReviewRun.id.desc())
        .limit(1)
    )
    if (
        run is None
        or run.deliverable_version_id != version.id
        or run.content_hash != version.content_hash
        or run.status != "passed"
        or not run.gates_passed
    ):
        raise ProfessionalDeliveryError(
            "DELIVERABLE_REVIEW_NOT_PASSED",
            "当前成果版本尚未通过质量审查",
            422,
        )


def _new_approval_event(
    db: Session,
    *,
    artifact: WorkArtifact,
    version: WorkArtifactVersion,
    flow_version: ApprovalFlowVersion | None,
    event_type: str,
    actor_user_id: str,
    row_version_before: int,
    idempotency_key: str,
    request_hash: str,
    request_id: str,
    key_version: str,
    cipher: ContentCipher,
    reason: str = "",
    comment_uuids: list[str] | None = None,
) -> ApprovalEvent:
    event_uuid = str(uuid_lib.uuid4())
    encrypted_reason = (
        cipher.encrypt_json({"reason": reason}, event_uuid.encode("utf-8"))
        if reason
        else None
    )
    event = ApprovalEvent(
        uuid=event_uuid,
        deliverable_id=artifact.id,
        deliverable_version_id=version.id,
        approval_flow_version_id=flow_version.id if flow_version is not None else None,
        event_type=event_type,
        content_hash=version.content_hash,
        actor_user_id=actor_user_id,
        reason_ciphertext=(
            encrypted_reason.ciphertext if encrypted_reason is not None else None
        ),
        reason_nonce=encrypted_reason.nonce if encrypted_reason is not None else None,
        key_version=key_version,
        comment_uuids_json=comment_uuids or [],
        row_version_before=row_version_before,
        row_version_after=artifact.row_version,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        audit_request_id=request_id,
    )
    db.add(event)
    db.flush()
    return event


def submit_deliverable_for_approval(
    db: Session,
    *,
    deliverable_uuid: str,
    body: DeliverableSubmitIn,
    actor_user_id: str,
    idempotency_key: str,
    request_id: str,
    cipher: ContentCipher,
    key_version: str,
) -> ApprovalActionResult:
    access = get_visible_deliverable(
        db,
        deliverable_uuid=deliverable_uuid,
        actor_user_id=actor_user_id,
        lock=True,
    )
    _require_deliverable_write_access(access)
    request_hash = _request_hash(body)
    replay = _approval_event_replay(
        db,
        access=access,
        actor_user_id=actor_user_id,
        event_type="submitted",
        idempotency_key=idempotency_key,
        request_hash=request_hash,
    )
    if replay is not None:
        return replay
    version = _exact_target(db, access=access, body=body)
    if access.artifact.lifecycle_status != LifecycleStatus.PENDING_APPROVAL.value:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_TRANSITION_INVALID",
            "仅已通过质量审查的成果可以提交审批",
            422,
        )
    _latest_review_passed(db, artifact=access.artifact, version=version)
    require_deliverable_evidence_gate(
        db,
        artifact=access.artifact,
        version=version,
        checkpoint="submit",
        actor_user_id=actor_user_id,
    )
    _, flow_version = _published_flow_version(
        db,
        artifact=access.artifact,
        flow_version_uuid=body.approval_flow_version_uuid,
    )
    row_before = access.artifact.row_version
    access.artifact.approval_flow_version_id = flow_version.id
    access.artifact.row_version += 1
    event = _new_approval_event(
        db,
        artifact=access.artifact,
        version=version,
        flow_version=flow_version,
        event_type="submitted",
        actor_user_id=actor_user_id,
        row_version_before=row_before,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        request_id=request_id,
        key_version=key_version,
        cipher=cipher,
    )
    return ApprovalActionResult(access, version, flow_version, event, False)


def approve_deliverable(
    db: Session,
    *,
    deliverable_uuid: str,
    body: DeliverableApproveIn,
    actor_user_id: str,
    idempotency_key: str,
    request_id: str,
    cipher: ContentCipher,
    key_version: str,
) -> ApprovalActionResult:
    access = get_visible_deliverable(
        db,
        deliverable_uuid=deliverable_uuid,
        actor_user_id=actor_user_id,
        lock=True,
    )
    request_hash = _request_hash(body)
    replay = _approval_event_replay(
        db,
        access=access,
        actor_user_id=actor_user_id,
        event_type="approved",
        idempotency_key=idempotency_key,
        request_hash=request_hash,
    )
    if replay is not None:
        return replay
    version = _exact_target(db, access=access, body=body)
    if access.artifact.lifecycle_status != LifecycleStatus.PENDING_APPROVAL.value:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_TRANSITION_INVALID",
            "成果当前状态不允许审批",
            422,
        )
    flow_version = _pinned_flow_version(db, artifact=access.artifact)
    _require_approval_access(access, flow_version=flow_version)
    if version.created_by == actor_user_id and not flow_version.allow_author_approve:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_SELF_APPROVAL_FORBIDDEN",
            "当前审批流不允许成果作者审批自己的版本",
            403,
        )
    require_deliverable_evidence_gate(
        db,
        artifact=access.artifact,
        version=version,
        checkpoint="approve",
        actor_user_id=actor_user_id,
    )
    duplicate = db.scalar(
        select(ApprovalEvent.id).where(
            ApprovalEvent.deliverable_id == access.artifact.id,
            ApprovalEvent.deliverable_version_id == version.id,
            ApprovalEvent.event_type == "approved",
            ApprovalEvent.actor_user_id == actor_user_id,
        )
    )
    if duplicate is not None:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_ALREADY_APPROVED_BY_ACTOR",
            "当前用户已审批该成果版本",
            409,
        )
    prior_approvals = int(
        db.scalar(
            select(func.count(func.distinct(ApprovalEvent.actor_user_id))).where(
                ApprovalEvent.deliverable_id == access.artifact.id,
                ApprovalEvent.deliverable_version_id == version.id,
                ApprovalEvent.event_type == "approved",
            )
        )
        or 0
    )
    row_before = access.artifact.row_version
    if prior_approvals + 1 >= max(flow_version.min_approvals, 1):
        access.artifact.lifecycle_status = _transition(
            access.artifact.lifecycle_status,
            LifecycleAction.APPROVE,
            TransitionContext(can_approve=True, version_unchanged=True),
        )
        access.artifact.approved_version_id = version.id
        access.artifact.approved_content_hash = version.content_hash
    access.artifact.row_version += 1
    event = _new_approval_event(
        db,
        artifact=access.artifact,
        version=version,
        flow_version=flow_version,
        event_type="approved",
        actor_user_id=actor_user_id,
        row_version_before=row_before,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        request_id=request_id,
        key_version=key_version,
        cipher=cipher,
    )
    return ApprovalActionResult(access, version, flow_version, event, False)


def request_deliverable_changes(
    db: Session,
    *,
    deliverable_uuid: str,
    body: DeliverableRequestChangesIn,
    actor_user_id: str,
    idempotency_key: str,
    request_id: str,
    cipher: ContentCipher,
    key_version: str,
) -> ApprovalActionResult:
    access = get_visible_deliverable(
        db,
        deliverable_uuid=deliverable_uuid,
        actor_user_id=actor_user_id,
        lock=True,
    )
    request_hash = _request_hash(body)
    replay = _approval_event_replay(
        db,
        access=access,
        actor_user_id=actor_user_id,
        event_type="changes_requested",
        idempotency_key=idempotency_key,
        request_hash=request_hash,
    )
    if replay is not None:
        return replay
    version = _exact_target(db, access=access, body=body)
    if access.artifact.lifecycle_status != LifecycleStatus.PENDING_APPROVAL.value:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_TRANSITION_INVALID",
            "成果当前状态不允许退回修改",
            422,
        )
    flow_version = _pinned_flow_version(db, artifact=access.artifact)
    _require_approval_access(access, flow_version=flow_version)
    requested_uuids = list(dict.fromkeys(body.comment_uuids))
    comments = list(
        db.scalars(
            select(DeliverableComment).where(
                DeliverableComment.uuid.in_(requested_uuids),
            )
        )
    )
    if (
        len(comments) != len(requested_uuids)
        or any(
            comment.deliverable_id != access.artifact.id
            or comment.deliverable_version_id != version.id
            or comment.status != "open"
            for comment in comments
        )
    ):
        raise ProfessionalDeliveryError(
            "DELIVERABLE_CHANGE_COMMENTS_INVALID",
            "退回修改必须关联当前版本的未解决评论",
            422,
        )
    row_before = access.artifact.row_version
    access.artifact.lifecycle_status = _transition(
        access.artifact.lifecycle_status,
        LifecycleAction.REQUEST_CHANGES,
        TransitionContext(reason=body.reason),
    )
    access.artifact.row_version += 1
    event = _new_approval_event(
        db,
        artifact=access.artifact,
        version=version,
        flow_version=flow_version,
        event_type="changes_requested",
        actor_user_id=actor_user_id,
        row_version_before=row_before,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        request_id=request_id,
        key_version=key_version,
        cipher=cipher,
        reason=body.reason,
        comment_uuids=requested_uuids,
    )
    return ApprovalActionResult(access, version, flow_version, event, False)


def create_deliverable_comment(
    db: Session,
    *,
    deliverable_uuid: str,
    body: DeliverableCommentCreateIn,
    actor_user_id: str,
    idempotency_key: str,
    cipher: ContentCipher,
    key_version: str,
) -> CommentMutationResult:
    access = get_visible_deliverable(
        db,
        deliverable_uuid=deliverable_uuid,
        actor_user_id=actor_user_id,
    )
    _require_deliverable_review_access(access)
    request_hash = _request_hash(body)
    existing = db.scalar(
        select(DeliverableComment).where(
            DeliverableComment.author_user_id == actor_user_id,
            DeliverableComment.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        if existing.deliverable_id != access.artifact.id or existing.request_hash != request_hash:
            raise _idempotency_reused()
        return CommentMutationResult(access, existing, True)
    version = get_deliverable_version(
        db,
        artifact=access.artifact,
        version_uuid=body.version_uuid,
    )
    content = deliverable_version_payload(db, version=version, cipher=cipher)["content"]
    blocks = content.get("blocks") if isinstance(content, dict) else None
    block = next(
        (
            candidate
            for candidate in blocks or []
            if isinstance(candidate, dict) and candidate.get("block_id") == body.block_id
        ),
        None,
    )
    if block is None:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_COMMENT_BLOCK_NOT_FOUND",
            "评论绑定的内容块不存在",
            422,
        )
    if (body.char_start is None) != (body.char_end is None):
        raise ProfessionalDeliveryError(
            "DELIVERABLE_COMMENT_RANGE_INVALID",
            "评论字符范围必须同时提供起止位置",
            422,
        )
    if body.char_start is not None and body.char_end is not None:
        text = str(block.get("text") or "")
        if body.char_end <= body.char_start or body.char_end > len(text):
            raise ProfessionalDeliveryError(
                "DELIVERABLE_COMMENT_RANGE_INVALID",
                "评论字符范围超出内容块边界",
                422,
            )
    comment_uuid = str(uuid_lib.uuid4())
    encrypted = cipher.encrypt_json(
        {"content": body.content},
        comment_uuid.encode("utf-8"),
    )
    comment = DeliverableComment(
        uuid=comment_uuid,
        deliverable_id=access.artifact.id,
        deliverable_version_id=version.id,
        block_id=body.block_id,
        char_start=body.char_start,
        char_end=body.char_end,
        content_ciphertext=encrypted.ciphertext,
        content_nonce=encrypted.nonce,
        key_version=key_version,
        status="open",
        author_user_id=actor_user_id,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
    )
    db.add(comment)
    db.flush()
    return CommentMutationResult(access, comment, False)


def list_deliverable_comments(
    db: Session,
    *,
    deliverable_uuid: str,
    actor_user_id: str,
) -> tuple[DeliverableAccess, list[DeliverableComment]]:
    access = get_visible_deliverable(
        db,
        deliverable_uuid=deliverable_uuid,
        actor_user_id=actor_user_id,
    )
    comments = list(
        db.scalars(
            select(DeliverableComment)
            .where(DeliverableComment.deliverable_id == access.artifact.id)
            .order_by(DeliverableComment.id.asc())
        )
    )
    return access, comments


def _comment_access(
    db: Session,
    *,
    comment_uuid: str,
    actor_user_id: str,
) -> tuple[DeliverableAccess, DeliverableComment]:
    comment = db.scalar(
        select(DeliverableComment).where(DeliverableComment.uuid == comment_uuid)
    )
    artifact = db.get(WorkArtifact, comment.deliverable_id) if comment is not None else None
    if comment is None or artifact is None:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_COMMENT_NOT_FOUND",
            "成果评论不存在",
            404,
        )
    access = get_visible_deliverable(
        db,
        deliverable_uuid=artifact.uuid,
        actor_user_id=actor_user_id,
    )
    return access, comment


def _require_comment_write_access(access: DeliverableAccess) -> None:
    if access.artifact.scope_type == "personal":
        return
    role = access.member.role if access.member is not None else ""
    if role not in PROJECT_WRITER_ROLES | PROJECT_REVIEWER_ROLES:
        raise ProfessionalDeliveryError(
            "PROJECT_DELIVERABLE_COMMENT_FORBIDDEN",
            "当前项目角色不能回复成果评论",
            403,
        )


def reply_to_deliverable_comment(
    db: Session,
    *,
    comment_uuid: str,
    body: DeliverableCommentReplyIn,
    actor_user_id: str,
    idempotency_key: str,
    cipher: ContentCipher,
    key_version: str,
) -> CommentMutationResult:
    access, comment = _comment_access(
        db,
        comment_uuid=comment_uuid,
        actor_user_id=actor_user_id,
    )
    _require_comment_write_access(access)
    request_hash = _request_hash(body)
    existing = db.scalar(
        select(DeliverableCommentReply).where(
            DeliverableCommentReply.author_user_id == actor_user_id,
            DeliverableCommentReply.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        if existing.comment_id != comment.id or existing.request_hash != request_hash:
            raise _idempotency_reused()
        return CommentMutationResult(access, comment, True)
    if comment.status != "open":
        raise ProfessionalDeliveryError(
            "DELIVERABLE_COMMENT_CLOSED",
            "已解决的评论不能继续回复",
            422,
        )
    reply_uuid = str(uuid_lib.uuid4())
    encrypted = cipher.encrypt_json(
        {"content": body.content},
        reply_uuid.encode("utf-8"),
    )
    db.add(
        DeliverableCommentReply(
            uuid=reply_uuid,
            comment_id=comment.id,
            content_ciphertext=encrypted.ciphertext,
            content_nonce=encrypted.nonce,
            key_version=key_version,
            author_user_id=actor_user_id,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
        )
    )
    db.flush()
    return CommentMutationResult(access, comment, False)


def resolve_deliverable_comment(
    db: Session,
    *,
    comment_uuid: str,
    body: DeliverableCommentResolveIn,
    actor_user_id: str,
    idempotency_key: str,
    cipher: ContentCipher,
) -> CommentMutationResult:
    access, comment = _comment_access(
        db,
        comment_uuid=comment_uuid,
        actor_user_id=actor_user_id,
    )
    request_hash = _request_hash(body)
    if comment.resolved_idempotency_key:
        if (
            comment.resolved_idempotency_key != idempotency_key
            or comment.resolved_request_hash != request_hash
        ):
            if comment.status == "resolved":
                raise ProfessionalDeliveryError(
                    "DELIVERABLE_COMMENT_ALREADY_RESOLVED",
                    "成果评论已经解决",
                    409,
                )
            raise _idempotency_reused()
        return CommentMutationResult(access, comment, True)
    role = access.member.role if access.member is not None else ""
    if comment.author_user_id != actor_user_id and (
        access.artifact.scope_type != "project" or role not in PROJECT_REVIEWER_ROLES
    ):
        raise ProfessionalDeliveryError(
            "DELIVERABLE_COMMENT_RESOLVE_FORBIDDEN",
            "当前用户不能解决该成果评论",
            403,
        )
    if comment.status != "open":
        raise ProfessionalDeliveryError(
            "DELIVERABLE_COMMENT_ALREADY_RESOLVED",
            "成果评论已经解决",
            409,
        )
    encrypted = cipher.encrypt_json(
        {"reason": body.reason},
        comment.uuid.encode("utf-8"),
    )
    comment.status = "resolved"
    comment.resolved_by = actor_user_id
    comment.resolved_at = _now()
    comment.resolution_reason_ciphertext = encrypted.ciphertext
    comment.resolution_reason_nonce = encrypted.nonce
    comment.resolved_idempotency_key = idempotency_key
    comment.resolved_request_hash = request_hash
    db.flush()
    return CommentMutationResult(access, comment, False)


def comment_payload(
    db: Session,
    *,
    comment: DeliverableComment,
    cipher: ContentCipher,
    access: DeliverableAccess,
    actor_user_id: str,
) -> dict[str, Any]:
    version = db.get(WorkArtifactVersion, comment.deliverable_version_id)
    if version is None:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_VERSION_NOT_AVAILABLE",
            "评论绑定的成果版本不可用",
            409,
        )
    content = cipher.decrypt_json(
        EncryptedPayload(comment.content_ciphertext, comment.content_nonce),
        comment.uuid.encode("utf-8"),
    )
    resolution_reason = ""
    if (
        comment.resolution_reason_ciphertext is not None
        and comment.resolution_reason_nonce is not None
    ):
        resolution = cipher.decrypt_json(
            EncryptedPayload(
                comment.resolution_reason_ciphertext,
                comment.resolution_reason_nonce,
            ),
            comment.uuid.encode("utf-8"),
        )
        resolution_reason = str(resolution.get("reason") or "")
    replies = list(
        db.scalars(
            select(DeliverableCommentReply)
            .where(DeliverableCommentReply.comment_id == comment.id)
            .order_by(DeliverableCommentReply.id.asc())
        )
    )
    role = access.member.role if access.member is not None else ""
    can_resolve = comment.status == "open" and (
        comment.author_user_id == actor_user_id
        or access.artifact.scope_type == "personal"
        or role in PROJECT_REVIEWER_ROLES
    )
    return {
        "comment_uuid": comment.uuid,
        "version_uuid": version.uuid,
        "block_id": comment.block_id,
        "char_start": comment.char_start,
        "char_end": comment.char_end,
        "content": str(content.get("content") or ""),
        "status": comment.status,
        "author_user_id": comment.author_user_id,
        "resolved_by": comment.resolved_by,
        "resolved_at": comment.resolved_at,
        "resolution_reason": resolution_reason,
        "allowed_actions": ["resolve_comment"] if can_resolve else [],
        "replies": [
            {
                "reply_uuid": reply.uuid,
                "content": str(
                    cipher.decrypt_json(
                        EncryptedPayload(reply.content_ciphertext, reply.content_nonce),
                        reply.uuid.encode("utf-8"),
                    ).get("content")
                    or ""
                ),
                "author_user_id": reply.author_user_id,
                "created_at": reply.created_at,
            }
            for reply in replies
        ],
        "created_at": comment.created_at,
    }


def _require_delivery_access(access: DeliverableAccess) -> None:
    if access.artifact.scope_type == "personal":
        return
    role = access.member.role if access.member is not None else ""
    if role not in PROJECT_DELIVERY_ROLES:
        raise ProfessionalDeliveryError(
            "PROJECT_DELIVERABLE_DELIVERY_FORBIDDEN",
            "当前项目角色不能交付或归档成果",
            403,
        )


def deliver_approved_deliverable(
    db: Session,
    *,
    deliverable_uuid: str,
    body: DeliverableDeliverIn,
    actor_user_id: str,
    idempotency_key: str,
    request_id: str,
    cipher: ContentCipher,
    key_version: str,
) -> DeliveryMutationResult:
    access = get_visible_deliverable(
        db,
        deliverable_uuid=deliverable_uuid,
        actor_user_id=actor_user_id,
        lock=True,
    )
    _require_delivery_access(access)
    request_hash = _request_hash(body)
    existing = db.scalar(
        select(DeliveryRecord).where(
            DeliveryRecord.delivered_by == actor_user_id,
            DeliveryRecord.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        if existing.deliverable_id != access.artifact.id or existing.request_hash != request_hash:
            raise _idempotency_reused()
        version = db.get(WorkArtifactVersion, existing.deliverable_version_id)
        export = db.get(DeliverableExport, existing.export_id)
        if version is None or export is None:
            raise ProfessionalDeliveryError(
                "DELIVERABLE_DELIVERY_RECORD_INVALID",
                "交付记录绑定的版本或导出文件不可用",
                409,
            )
        return DeliveryMutationResult(access, version, export, existing, True)
    version = _exact_target(db, access=access, body=body)
    artifact = access.artifact
    if (
        artifact.lifecycle_status != LifecycleStatus.APPROVED.value
        or artifact.approved_version_id != version.id
        or artifact.approved_content_hash != version.content_hash
    ):
        raise ProfessionalDeliveryError(
            "DELIVERABLE_NOT_APPROVED",
            "仅已批准且版本未变化的成果可以交付",
            422,
        )
    require_deliverable_evidence_gate(
        db,
        artifact=artifact,
        version=version,
        checkpoint="deliver",
        actor_user_id=actor_user_id,
    )
    export = db.scalar(
        select(DeliverableExport).where(
            DeliverableExport.uuid == body.export_uuid,
            DeliverableExport.deliverable_id == artifact.id,
        )
    )
    if (
        export is None
        or export.deliverable_version_id != version.id
        or export.content_hash != version.content_hash
        or export.export_format != "docx"
        or export.status != "ready"
        or export.watermarked
        or not export.file_path
        or len(export.file_hash) != 64
        or export.file_size <= 0
        or not export.renderer_version
    ):
        raise ProfessionalDeliveryError(
            "DELIVERABLE_EXPORT_NOT_READY",
            "交付必须使用当前已批准版本的可用 Word 导出文件",
            422,
        )
    delivery_uuid = str(uuid_lib.uuid4())
    encrypted = cipher.encrypt_json(
        {
            "recipient_description": body.recipient_description,
            "note": body.note,
        },
        delivery_uuid.encode("utf-8"),
    )
    artifact.lifecycle_status = _transition(
        artifact.lifecycle_status,
        LifecycleAction.DELIVER,
        TransitionContext(approved_version_selected=True),
    )
    artifact.delivered_version_id = version.id
    artifact.row_version += 1
    delivery = DeliveryRecord(
        uuid=delivery_uuid,
        deliverable_id=artifact.id,
        deliverable_version_id=version.id,
        export_id=export.id,
        content_hash=version.content_hash,
        delivered_by=actor_user_id,
        delivery_metadata_ciphertext=encrypted.ciphertext,
        delivery_metadata_nonce=encrypted.nonce,
        key_version=key_version,
        delivered_at=_now(),
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        audit_request_id=request_id,
    )
    db.add(delivery)
    db.flush()
    return DeliveryMutationResult(access, version, export, delivery, False)


def archive_delivered_deliverable(
    db: Session,
    *,
    deliverable_uuid: str,
    body: DeliverableArchiveIn,
    actor_user_id: str,
    idempotency_key: str,
    request_id: str,
    cipher: ContentCipher,
    key_version: str,
) -> ApprovalActionResult:
    access = get_visible_deliverable(
        db,
        deliverable_uuid=deliverable_uuid,
        actor_user_id=actor_user_id,
        lock=True,
    )
    _require_delivery_access(access)
    request_hash = _request_hash(body)
    replay = _approval_event_replay(
        db,
        access=access,
        actor_user_id=actor_user_id,
        event_type="archived",
        idempotency_key=idempotency_key,
        request_hash=request_hash,
    )
    if replay is not None:
        return replay
    version = _exact_target(db, access=access, body=body)
    delivery = db.scalar(
        select(DeliveryRecord).where(DeliveryRecord.uuid == body.delivery_uuid)
    )
    artifact = access.artifact
    if (
        artifact.lifecycle_status != LifecycleStatus.DELIVERED.value
        or artifact.delivered_version_id != version.id
        or delivery is None
        or delivery.deliverable_id != artifact.id
        or delivery.deliverable_version_id != version.id
    ):
        raise ProfessionalDeliveryError(
            "DELIVERABLE_DELIVERY_RECORD_INVALID",
            "成果缺少匹配当前版本的完整交付记录",
            422,
        )
    row_before = artifact.row_version
    artifact.lifecycle_status = _transition(
        artifact.lifecycle_status,
        LifecycleAction.ARCHIVE,
        TransitionContext(delivery_record_complete=True),
    )
    artifact.archived_by = actor_user_id
    artifact.archived_at = _now()
    artifact.row_version += 1
    flow_version = (
        db.get(ApprovalFlowVersion, artifact.approval_flow_version_id)
        if artifact.approval_flow_version_id is not None
        else None
    )
    event = _new_approval_event(
        db,
        artifact=artifact,
        version=version,
        flow_version=flow_version,
        event_type="archived",
        actor_user_id=actor_user_id,
        row_version_before=row_before,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        request_id=request_id,
        key_version=key_version,
        cipher=cipher,
    )
    return ApprovalActionResult(access, version, flow_version, event, False)


def approval_event_payload(
    db: Session,
    *,
    event: ApprovalEvent,
) -> dict[str, Any]:
    version = db.get(WorkArtifactVersion, event.deliverable_version_id)
    flow_version = (
        db.get(ApprovalFlowVersion, event.approval_flow_version_id)
        if event.approval_flow_version_id is not None
        else None
    )
    if version is None:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_VERSION_NOT_AVAILABLE",
            "审批事件绑定的成果版本不可用",
            409,
        )
    return {
        "event_uuid": event.uuid,
        "event_type": event.event_type,
        "version_uuid": version.uuid,
        "approval_flow_version_uuid": flow_version.uuid if flow_version else None,
        "content_hash": event.content_hash,
        "actor_user_id": event.actor_user_id,
        "comment_uuids": list(event.comment_uuids_json or []),
        "row_version_before": event.row_version_before,
        "row_version_after": event.row_version_after,
        "created_at": event.created_at,
    }


def delivery_record_payload(
    *,
    result: DeliveryMutationResult,
    cipher: ContentCipher,
) -> dict[str, Any]:
    metadata = cipher.decrypt_json(
        EncryptedPayload(
            result.delivery.delivery_metadata_ciphertext,
            result.delivery.delivery_metadata_nonce,
        ),
        result.delivery.uuid.encode("utf-8"),
    )
    return {
        "delivery_uuid": result.delivery.uuid,
        "version_uuid": result.version.uuid,
        "export_uuid": result.export.uuid,
        "content_hash": result.delivery.content_hash,
        "delivered_by": result.delivery.delivered_by,
        "recipient_description": str(metadata.get("recipient_description") or ""),
        "note": str(metadata.get("note") or ""),
        "delivered_at": result.delivery.delivered_at,
    }
