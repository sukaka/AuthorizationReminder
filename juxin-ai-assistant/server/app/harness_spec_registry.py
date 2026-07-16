"""Versioned, approval-gated storage for immutable Agent Harness specifications."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .harness_spec import harness_spec_path, load_harness_spec, validate_harness_spec
from .models import HarnessSpecAuditEvent, HarnessSpecVersion


class HarnessSpecRegistryError(ValueError):
    pass


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _canonical_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _content_hash(payload: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()


class HarnessSpecRegistry:
    def __init__(self, db: Session) -> None:
        self.db = db

    def _audit(
        self,
        spec: HarnessSpecVersion,
        *,
        action: str,
        actor_id: str,
        from_status: str,
        to_status: str,
    ) -> None:
        self.db.add(
            HarnessSpecAuditEvent(
                spec_uuid=spec.uuid,
                action=action,
                actor_id=actor_id,
                from_status=from_status,
                to_status=to_status,
            )
        )

    def get_or_bootstrap_active(self) -> HarnessSpecVersion:
        rows = list(self.db.scalars(select(HarnessSpecVersion).order_by(HarnessSpecVersion.created_at)))
        active = [row for row in rows if row.status == "active"]
        if len(active) == 1:
            return active[0]
        if active or rows:
            raise HarnessSpecRegistryError("active_spec_missing")

        payload = load_harness_spec()
        spec = HarnessSpecVersion(
            semantic_version=payload["spec_version"],
            content_hash=_content_hash(payload),
            content_json=payload,
            status="active",
            created_by_user_id="system",
            approved_by_user_id="system",
            approved_at=_utc_now(),
            activated_by_user_id="system",
            activated_at=_utc_now(),
        )
        self.db.add(spec)
        self.db.flush()
        self._audit(spec, action="bootstrap", actor_id="system", from_status="", to_status="active")
        self.db.flush()
        return spec

    def register(self, *, payload: dict[str, Any], actor_id: str) -> HarnessSpecVersion:
        validate_harness_spec(payload, base_dir=harness_spec_path().parent)
        version = payload["spec_version"]
        digest = _content_hash(payload)
        if self.db.scalar(select(HarnessSpecVersion).where(HarnessSpecVersion.semantic_version == version)):
            raise HarnessSpecRegistryError("spec_version_already_exists")
        if self.db.scalar(select(HarnessSpecVersion).where(HarnessSpecVersion.content_hash == digest)):
            raise HarnessSpecRegistryError("spec_content_already_exists")
        spec = HarnessSpecVersion(
            semantic_version=version,
            content_hash=digest,
            content_json=json.loads(_canonical_json(payload)),
            status="draft",
            created_by_user_id=actor_id,
        )
        self.db.add(spec)
        self.db.flush()
        self._audit(spec, action="register", actor_id=actor_id, from_status="", to_status="draft")
        self.db.flush()
        return spec

    def _get(self, spec_uuid: str) -> HarnessSpecVersion:
        spec = self.db.scalar(select(HarnessSpecVersion).where(HarnessSpecVersion.uuid == spec_uuid))
        if spec is None:
            raise HarnessSpecRegistryError("spec_not_found")
        return spec

    def submit_for_approval(self, spec_uuid: str, *, actor_id: str) -> HarnessSpecVersion:
        spec = self._get(spec_uuid)
        if spec.status != "draft":
            raise HarnessSpecRegistryError("spec_not_draft")
        previous = spec.status
        spec.status = "pending_approval"
        self._audit(spec, action="submit", actor_id=actor_id, from_status=previous, to_status=spec.status)
        self.db.flush()
        return spec

    def approve(self, spec_uuid: str, *, actor_id: str) -> HarnessSpecVersion:
        spec = self._get(spec_uuid)
        if spec.status != "pending_approval":
            raise HarnessSpecRegistryError("spec_not_pending_approval")
        if spec.created_by_user_id == actor_id:
            raise HarnessSpecRegistryError("independent_approval_required")
        previous = spec.status
        spec.status = "approved"
        spec.approved_by_user_id = actor_id
        spec.approved_at = _utc_now()
        self._audit(spec, action="approve", actor_id=actor_id, from_status=previous, to_status=spec.status)
        self.db.flush()
        return spec

    def activate(self, spec_uuid: str, *, actor_id: str, action: str = "activate") -> HarnessSpecVersion:
        spec = self._get(spec_uuid)
        if spec.status not in {"approved", "retired"}:
            raise HarnessSpecRegistryError("spec_not_activatable")
        for current in self.db.scalars(select(HarnessSpecVersion).where(HarnessSpecVersion.status == "active")):
            current.status = "retired"
            self._audit(current, action="retire", actor_id=actor_id, from_status="active", to_status="retired")
        previous = spec.status
        spec.status = "active"
        spec.activated_by_user_id = actor_id
        spec.activated_at = _utc_now()
        self._audit(spec, action=action, actor_id=actor_id, from_status=previous, to_status="active")
        self.db.flush()
        return spec

    def rollback(self, spec_uuid: str, *, actor_id: str) -> HarnessSpecVersion:
        return self.activate(spec_uuid, actor_id=actor_id, action="rollback")

    def list_audit_actions(self, spec_uuid: str) -> list[str]:
        return list(
            self.db.scalars(
                select(HarnessSpecAuditEvent.action)
                .where(HarnessSpecAuditEvent.spec_uuid == spec_uuid)
                .order_by(HarnessSpecAuditEvent.id)
            )
        )
