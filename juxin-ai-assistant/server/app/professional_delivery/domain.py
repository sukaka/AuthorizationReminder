from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from enum import Enum
from typing import Any


class DeliverableDomainError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class ScopeType(str, Enum):
    PERSONAL = "personal"
    PROJECT = "project"


@dataclass(frozen=True, slots=True)
class DeliverableScope:
    scope_type: ScopeType
    owner_user_id: str | None
    project_id: int | None

    def __post_init__(self) -> None:
        try:
            scope_type = ScopeType(self.scope_type)
        except ValueError as exc:
            raise DeliverableDomainError(
                "DELIVERABLE_SCOPE_INVALID",
                "成果范围仅支持 personal 或 project",
            ) from exc
        object.__setattr__(self, "scope_type", scope_type)

        owner_user_id = (self.owner_user_id or "").strip() or None
        object.__setattr__(self, "owner_user_id", owner_user_id)

        if scope_type is ScopeType.PERSONAL:
            if owner_user_id is None or self.project_id is not None:
                raise DeliverableDomainError(
                    "DELIVERABLE_SCOPE_INVALID",
                    "个人成果必须有所有者且不能关联项目",
                )
            return

        if (
            isinstance(self.project_id, bool)
            or not isinstance(self.project_id, int)
            or self.project_id <= 0
        ):
            raise DeliverableDomainError(
                "DELIVERABLE_SCOPE_INVALID",
                "项目成果必须关联有效项目",
            )


@dataclass(frozen=True, slots=True)
class DeliverableVersionSnapshot:
    deliverable_id: int
    version_no: int
    parent_version_id: int | None
    skill_version_id: int
    template_version_id: int
    content_json: str
    content_hash: str
    content_format: str
    content_schema_version: str
    title_snapshot: str
    summary_snapshot: str
    created_by: str
    creation_reason: str

    @classmethod
    def create(
        cls,
        *,
        deliverable_id: int,
        version_no: int,
        parent_version_id: int | None,
        skill_version_id: int | None,
        template_version_id: int | None,
        content: Mapping[str, Any],
        content_format: str,
        content_schema_version: str,
        title_snapshot: str,
        summary_snapshot: str,
        created_by: str,
        creation_reason: str,
    ) -> DeliverableVersionSnapshot:
        required_ids = {
            "deliverable_id": deliverable_id,
            "version_no": version_no,
            "skill_version_id": skill_version_id,
            "template_version_id": template_version_id,
        }
        if any(
            isinstance(value, bool) or not isinstance(value, int) or value <= 0
            for value in required_ids.values()
        ):
            raise DeliverableDomainError(
                "DELIVERABLE_VERSION_INVALID",
                "成果版本必须绑定有效成果、Skill 版本和模板版本",
            )
        if parent_version_id is not None and (
            isinstance(parent_version_id, bool)
            or not isinstance(parent_version_id, int)
            or parent_version_id <= 0
        ):
            raise DeliverableDomainError(
                "DELIVERABLE_VERSION_INVALID",
                "父版本标识无效",
            )
        if not isinstance(content, Mapping):
            raise DeliverableDomainError(
                "DELIVERABLE_VERSION_INVALID",
                "成果正文必须是结构化对象",
            )
        if not all(
            value.strip()
            for value in (content_format, content_schema_version, created_by, creation_reason)
        ):
            raise DeliverableDomainError(
                "DELIVERABLE_VERSION_INVALID",
                "成果版本格式、结构版本、创建人和创建原因不能为空",
            )
        try:
            content_json = json.dumps(
                content,
                ensure_ascii=False,
                allow_nan=False,
                separators=(",", ":"),
                sort_keys=True,
            )
        except (TypeError, ValueError) as exc:
            raise DeliverableDomainError(
                "DELIVERABLE_VERSION_INVALID",
                "成果正文必须可序列化为标准 JSON",
            ) from exc

        return cls(
            deliverable_id=deliverable_id,
            version_no=version_no,
            parent_version_id=parent_version_id,
            skill_version_id=skill_version_id,
            template_version_id=template_version_id,
            content_json=content_json,
            content_hash=hashlib.sha256(content_json.encode("utf-8")).hexdigest(),
            content_format=content_format.strip(),
            content_schema_version=content_schema_version.strip(),
            title_snapshot=title_snapshot,
            summary_snapshot=summary_snapshot,
            created_by=created_by.strip(),
            creation_reason=creation_reason.strip(),
        )

    @property
    def content(self) -> dict[str, Any]:
        return json.loads(self.content_json)


class LifecycleStatus(str, Enum):
    DRAFT = "draft"
    QUALITY_REVIEW = "quality_review"
    CHANGES_REQUESTED = "changes_requested"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    DELIVERED = "delivered"
    ARCHIVED = "archived"
    CANCELLED = "cancelled"


class LifecycleAction(str, Enum):
    SUBMIT_QUALITY_REVIEW = "submit_quality_review"
    QUALITY_REVIEW_FAILED = "quality_review_failed"
    QUALITY_REVIEW_PASSED = "quality_review_passed"
    REQUEST_CHANGES = "request_changes"
    APPROVE = "approve"
    DELIVER = "deliver"
    ARCHIVE = "archive"
    CREATE_REVISION = "create_revision"


@dataclass(frozen=True, slots=True)
class TransitionContext:
    has_current_version: bool = False
    content_hash_unchanged: bool = False
    has_blocking_issues: bool = False
    quality_gates_passed: bool = False
    reason: str | None = None
    can_approve: bool = False
    version_unchanged: bool = False
    approved_version_selected: bool = False
    delivery_record_complete: bool = False
    creates_new_version: bool = False


_TRANSITIONS = {
    (LifecycleStatus.DRAFT, LifecycleAction.SUBMIT_QUALITY_REVIEW): LifecycleStatus.QUALITY_REVIEW,
    (LifecycleStatus.CHANGES_REQUESTED, LifecycleAction.SUBMIT_QUALITY_REVIEW): LifecycleStatus.QUALITY_REVIEW,
    (LifecycleStatus.QUALITY_REVIEW, LifecycleAction.QUALITY_REVIEW_FAILED): LifecycleStatus.CHANGES_REQUESTED,
    (LifecycleStatus.QUALITY_REVIEW, LifecycleAction.QUALITY_REVIEW_PASSED): LifecycleStatus.PENDING_APPROVAL,
    (LifecycleStatus.PENDING_APPROVAL, LifecycleAction.REQUEST_CHANGES): LifecycleStatus.CHANGES_REQUESTED,
    (LifecycleStatus.PENDING_APPROVAL, LifecycleAction.APPROVE): LifecycleStatus.APPROVED,
    (LifecycleStatus.APPROVED, LifecycleAction.DELIVER): LifecycleStatus.DELIVERED,
    (LifecycleStatus.DELIVERED, LifecycleAction.ARCHIVE): LifecycleStatus.ARCHIVED,
    (LifecycleStatus.APPROVED, LifecycleAction.CREATE_REVISION): LifecycleStatus.DRAFT,
    (LifecycleStatus.DELIVERED, LifecycleAction.CREATE_REVISION): LifecycleStatus.DRAFT,
    (LifecycleStatus.ARCHIVED, LifecycleAction.CREATE_REVISION): LifecycleStatus.DRAFT,
}


def transition_lifecycle(
    current: LifecycleStatus,
    action: LifecycleAction,
    context: TransitionContext,
) -> LifecycleStatus:
    try:
        next_status = _TRANSITIONS[(LifecycleStatus(current), LifecycleAction(action))]
    except (KeyError, ValueError) as exc:
        raise DeliverableDomainError(
            "DELIVERABLE_TRANSITION_INVALID",
            f"成果状态 {current} 不允许执行动作 {action}",
        ) from exc

    precondition_met = {
        LifecycleAction.SUBMIT_QUALITY_REVIEW: (
            context.has_current_version and context.content_hash_unchanged
        ),
        LifecycleAction.QUALITY_REVIEW_FAILED: context.has_blocking_issues,
        LifecycleAction.QUALITY_REVIEW_PASSED: context.quality_gates_passed,
        LifecycleAction.REQUEST_CHANGES: bool((context.reason or "").strip()),
        LifecycleAction.APPROVE: context.can_approve and context.version_unchanged,
        LifecycleAction.DELIVER: context.approved_version_selected,
        LifecycleAction.ARCHIVE: context.delivery_record_complete,
        LifecycleAction.CREATE_REVISION: context.creates_new_version,
    }[LifecycleAction(action)]
    if not precondition_met:
        raise DeliverableDomainError(
            "DELIVERABLE_TRANSITION_PRECONDITION_FAILED",
            f"成果状态动作 {action} 的前置条件未满足",
        )
    return next_status
