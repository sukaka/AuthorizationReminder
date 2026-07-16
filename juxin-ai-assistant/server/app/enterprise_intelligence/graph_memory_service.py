"""Scoped graph and organization-memory write primitives.

The service records relationships and memory proposals without changing the
underlying project facts.  Memory publication is a separate, explicit review
transition so generated candidates cannot silently become trusted context.
"""

from __future__ import annotations

from datetime import UTC, datetime
from hashlib import sha256
import json
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..enterprise_graph_memory_models import (
    EnterpriseGraphRelation,
    EnterpriseGraphRelationEvidence,
    EnterpriseOrgMemoryCandidate,
    EnterpriseOrgMemoryItem,
    EnterpriseOrgMemoryReview,
    EnterpriseOrgMemoryVersion,
)
from ..enterprise_intelligence_models import EnterpriseCustomer, EnterpriseOrganization
from ..project_initialization_models import ProjectAsset
from ..project_task_models import ProjectIssue
from ..project_workspace_models import Project
from .access import EnterpriseAccessScope
from .lineage_service import _get_manageable_project, _require_manage_scope


_ENTITY_TYPES = frozenset({"project", "customer", "issue", "asset", "organization"})
_RELATION_TYPES = frozenset(
    {
        "project_depends_on",
        "project_delivers_for",
        "project_impacts_project",
        "issue_impacts_asset",
        "customer_engagement",
    }
)
_MEMORY_TYPES = frozenset({"fact", "policy", "preference", "lesson"})
_MEMORY_ACTIONS = frozenset({"approve", "reject"})


def _stable_hash(value: Any) -> str:
    return sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _require_organization(db: Session, organization_id: int) -> EnterpriseOrganization:
    organization = db.scalar(
        select(EnterpriseOrganization).where(
            EnterpriseOrganization.id == organization_id,
            EnterpriseOrganization.status == "active",
        )
    )
    if organization is None:
        raise LookupError("组织不存在或已停用")
    return organization


def _validate_entity(
    db: Session,
    scope: EnterpriseAccessScope,
    organization_id: int,
    entity_type: str,
    entity_uuid: str,
) -> None:
    if entity_type not in _ENTITY_TYPES:
        raise ValueError("图谱实体类型不在允许范围")
    entity_uuid = entity_uuid.strip()
    if not entity_uuid:
        raise ValueError("图谱实体 UUID 不能为空")

    if entity_type == "project":
        project = db.scalar(select(Project).where(Project.uuid == entity_uuid))
        if project is None:
            raise LookupError("项目不存在或不可访问")
        if project.organization_id != organization_id:
            raise ValueError("图谱实体与组织不一致")
        _get_manageable_project(db, scope, project.id)
        return

    if entity_type == "customer":
        customer = db.scalar(select(EnterpriseCustomer).where(EnterpriseCustomer.uuid == entity_uuid))
        if customer is None or customer.status != "active":
            raise LookupError("客户不存在或已停用")
        if customer.organization_id != organization_id:
            raise ValueError("图谱实体与组织不一致")
        return

    if entity_type in {"issue", "asset"}:
        model = ProjectIssue if entity_type == "issue" else ProjectAsset
        row = db.scalar(select(model).where(model.uuid == entity_uuid))
        if row is None:
            raise LookupError("图谱实体不存在或不可访问")
        project = _get_manageable_project(db, scope, row.project_id)
        if project.organization_id != organization_id:
            raise ValueError("图谱实体与组织不一致")
        return

    organization = db.scalar(select(EnterpriseOrganization).where(EnterpriseOrganization.uuid == entity_uuid))
    if organization is None or organization.id != organization_id:
        raise LookupError("组织实体不存在或不可访问")


def _evidence_row(
    db: Session,
    relation: EnterpriseGraphRelation,
    evidence: dict[str, Any],
) -> EnterpriseGraphRelationEvidence:
    evidence_type = str(evidence.get("type") or evidence.get("evidence_type") or "").strip()
    evidence_uuid = str(evidence.get("uuid") or evidence.get("evidence_uuid") or "").strip()
    source_version = int(evidence.get("source_version", 1))
    if not evidence_type or not evidence_uuid:
        raise ValueError("图谱证据必须包含 type 和 uuid")
    if source_version < 1:
        raise ValueError("图谱证据 source_version 必须为正数")
    existing = db.scalar(
        select(EnterpriseGraphRelationEvidence).where(
            EnterpriseGraphRelationEvidence.relation_id == relation.id,
            EnterpriseGraphRelationEvidence.evidence_type == evidence_type,
            EnterpriseGraphRelationEvidence.evidence_uuid == evidence_uuid,
            EnterpriseGraphRelationEvidence.source_version == source_version,
        )
    )
    if existing is not None:
        return existing
    row = EnterpriseGraphRelationEvidence(
        relation_id=relation.id,
        evidence_type=evidence_type,
        evidence_uuid=evidence_uuid,
        source_table=str(evidence.get("source_table") or ""),
        source_version=source_version,
        evidence_hash=_stable_hash(evidence),
        notes=str(evidence.get("notes") or ""),
    )
    db.add(row)
    db.flush()
    return row


def create_graph_relation(
    db: Session,
    scope: EnterpriseAccessScope,
    organization_id: int,
    source_entity_type: str,
    source_entity_uuid: str,
    target_entity_type: str,
    target_entity_uuid: str,
    relation_type: str,
    *,
    evidence_refs: Iterable[dict[str, Any]] = (),
    direction: str = "directed",
    weight: float = 1.0,
    confidence: float = 1.0,
    source: str = "manual",
    source_version: int = 1,
) -> EnterpriseGraphRelation:
    """Create an idempotent, scope-checked graph edge and its evidence."""

    _require_manage_scope(scope)
    _require_organization(db, organization_id)
    relation_type = relation_type.strip()
    if relation_type not in _RELATION_TYPES:
        raise ValueError("图谱关系类型不在允许范围")
    if direction not in {"directed", "undirected"}:
        raise ValueError("图谱关系方向不合法")
    if not 0 <= confidence <= 1:
        raise ValueError("图谱关系置信度必须在 0 到 1 之间")
    if weight < 0:
        raise ValueError("图谱关系权重不能为负数")
    if source_version < 1:
        raise ValueError("图谱关系 source_version 必须为正数")

    _validate_entity(db, scope, organization_id, source_entity_type, source_entity_uuid)
    _validate_entity(db, scope, organization_id, target_entity_type, target_entity_uuid)
    existing = db.scalar(
        select(EnterpriseGraphRelation).where(
            EnterpriseGraphRelation.organization_id == organization_id,
            EnterpriseGraphRelation.source_entity_type == source_entity_type,
            EnterpriseGraphRelation.source_entity_uuid == source_entity_uuid,
            EnterpriseGraphRelation.relation_type == relation_type,
            EnterpriseGraphRelation.target_entity_type == target_entity_type,
            EnterpriseGraphRelation.target_entity_uuid == target_entity_uuid,
            EnterpriseGraphRelation.source_version == source_version,
        )
    )
    relation = existing
    if relation is None:
        relation = EnterpriseGraphRelation(
            organization_id=organization_id,
            source_entity_type=source_entity_type,
            source_entity_uuid=source_entity_uuid,
            relation_type=relation_type,
            target_entity_type=target_entity_type,
            target_entity_uuid=target_entity_uuid,
            direction=direction,
            weight=weight,
            confidence=confidence,
            source=source.strip() or "manual",
            scope_fingerprint=scope.scope_fingerprint,
            policy_version=scope.policy_version,
            source_version=source_version,
            created_by=scope.user_id,
        )
        db.add(relation)
        db.flush()

    for evidence in evidence_refs:
        _evidence_row(db, relation, evidence)
    return relation


def _memory_fingerprint(organization_id: int, memory_key: str) -> str:
    # One pending proposal slot per stable key prevents duplicate AI retries
    # from creating competing candidates for the same organization memory.
    return _stable_hash({"organization_id": organization_id, "memory_key": memory_key})


def create_memory_candidate(
    db: Session,
    scope: EnterpriseAccessScope,
    organization_id: int,
    *,
    memory_key: str,
    title: str,
    content: dict[str, Any],
    source_refs: list[dict[str, Any]],
    source_version: int = 1,
) -> EnterpriseOrgMemoryCandidate:
    """Persist a deduplicated proposal; it is never published automatically."""

    _require_manage_scope(scope)
    _require_organization(db, organization_id)
    memory_key = memory_key.strip()
    title = title.strip()
    if not memory_key or not title:
        raise ValueError("记忆候选 key 和标题不能为空")
    if source_version < 1:
        raise ValueError("记忆候选 source_version 必须为正数")
    fingerprint = _memory_fingerprint(organization_id, memory_key)
    existing = db.scalar(
        select(EnterpriseOrgMemoryCandidate).where(
            EnterpriseOrgMemoryCandidate.organization_id == organization_id,
            EnterpriseOrgMemoryCandidate.candidate_fingerprint == fingerprint,
        )
    )
    if existing is not None:
        return existing
    row = EnterpriseOrgMemoryCandidate(
        organization_id=organization_id,
        memory_key=memory_key,
        title=title,
        content_json=content,
        source_refs_json=source_refs,
        source_scope_fingerprint=scope.scope_fingerprint,
        candidate_fingerprint=fingerprint,
        source_version=source_version,
        created_by=scope.user_id,
    )
    db.add(row)
    db.flush()
    return row


def create_org_memory_item(
    db: Session,
    scope: EnterpriseAccessScope,
    organization_id: int,
    *,
    memory_key: str,
    title: str,
    content: dict[str, Any],
    source_refs: list[dict[str, Any]],
    memory_type: str = "fact",
    sensitivity: str = "standard",
    change_reason: str = "",
) -> tuple[EnterpriseOrgMemoryItem, EnterpriseOrgMemoryVersion]:
    """Create a draft item plus its first pending-review version."""

    _require_manage_scope(scope)
    _require_organization(db, organization_id)
    memory_key = memory_key.strip()
    title = title.strip()
    if not memory_key or not title:
        raise ValueError("组织记忆 key 和标题不能为空")
    if memory_type not in _MEMORY_TYPES:
        raise ValueError("组织记忆类型不在允许范围")
    existing = db.scalar(
        select(EnterpriseOrgMemoryItem).where(
            EnterpriseOrgMemoryItem.organization_id == organization_id,
            EnterpriseOrgMemoryItem.memory_key == memory_key,
        )
    )
    if existing is not None:
        raise ValueError("组织记忆 key 已存在，请创建新版本")
    item = EnterpriseOrgMemoryItem(
        organization_id=organization_id,
        memory_key=memory_key,
        title=title,
        memory_type=memory_type,
        sensitivity=sensitivity,
        policy_version=scope.policy_version,
        source_scope_fingerprint=scope.scope_fingerprint,
        created_by=scope.user_id,
    )
    db.add(item)
    db.flush()
    version = EnterpriseOrgMemoryVersion(
        memory_item_id=item.id,
        version=1,
        content_json=content,
        source_refs_json=source_refs,
        source_scope_fingerprint=scope.scope_fingerprint,
        source_hash=_stable_hash({"content": content, "source_refs": source_refs}),
        change_reason=change_reason,
        created_by=scope.user_id,
    )
    db.add(version)
    db.flush()
    return item, version


def review_org_memory_version(
    db: Session,
    scope: EnterpriseAccessScope,
    memory_version_id: int,
    *,
    action: str,
    comment: str = "",
) -> EnterpriseOrgMemoryVersion:
    """Approve or reject one pending version and write an audit review row."""

    _require_manage_scope(scope)
    if action not in _MEMORY_ACTIONS:
        raise ValueError("记忆审核动作不合法")
    version = db.scalar(
        select(EnterpriseOrgMemoryVersion).where(EnterpriseOrgMemoryVersion.id == memory_version_id)
    )
    if version is None:
        raise LookupError("组织记忆版本不存在")
    item = db.scalar(select(EnterpriseOrgMemoryItem).where(EnterpriseOrgMemoryItem.id == version.memory_item_id))
    if item is None:
        raise LookupError("组织记忆不存在")
    _require_organization(db, item.organization_id)
    if version.status != "pending_review":
        raise ValueError("组织记忆版本已审核")

    now = datetime.now(UTC)
    review = EnterpriseOrgMemoryReview(
        memory_version_id=version.id,
        action=action,
        reviewer_user_id=scope.user_id,
        comment=comment.strip(),
        policy_version=scope.policy_version,
    )
    db.add(review)
    version.status = "approved" if action == "approve" else "rejected"
    version.reviewed_by = scope.user_id
    version.reviewed_at = now
    if action == "approve":
        item.status = "published"
        item.current_version = version.version
        item.approved_by = scope.user_id
        item.approved_at = now
    db.flush()
    return version
