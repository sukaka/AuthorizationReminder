"""Provider-free enterprise snapshot worker.

The worker is deliberately a transaction unit rather than a scheduler.  A
durable scheduler (for example ``WorkflowControlWorker``) owns claiming and
fencing; this class fixes the cutoff and persists the append-only records.  It
does not commit so the caller can use the same transaction boundary for a
lease, snapshot rows and quality findings.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy.orm import Session

from .access import EnterpriseAccessScope
from .service import (
    persist_enterprise_data_quality_issues,
    persist_enterprise_overview_snapshots,
)


def _utc(value: datetime | None) -> datetime:
    current = value or datetime.now(UTC)
    if current.tzinfo is None:
        return current.replace(tzinfo=UTC)
    return current.astimezone(UTC)


@dataclass(frozen=True, slots=True)
class EnterpriseSnapshotRun:
    worker_id: str
    scope_fingerprint: str
    cutoff: datetime
    source_version: int
    metric_snapshots_created: int
    health_snapshots_created: int
    quality_issues_scanned: int
    quality_issues_created: int

    def as_dict(self) -> dict[str, object]:
        return {
            "worker_id": self.worker_id,
            "scope_fingerprint": self.scope_fingerprint,
            "cutoff": self.cutoff.isoformat(),
            "source_version": self.source_version,
            "snapshots": {
                "metric_created": self.metric_snapshots_created,
                "health_created": self.health_snapshots_created,
            },
            "data_quality": {
                "issues_scanned": self.quality_issues_scanned,
                "issues_created": self.quality_issues_created,
            },
        }


class EnterpriseSnapshotWorker:
    """Run one idempotent, scope-bound enterprise snapshot transaction."""

    def __init__(self, *, worker_id: str | None = None) -> None:
        self.worker_id = (worker_id or f"enterprise-snapshot-{uuid4().hex}").strip()
        if not self.worker_id:
            raise ValueError("worker_id 不能为空")

    def run_once(
        self,
        db: Session,
        scope: EnterpriseAccessScope,
        *,
        cutoff: datetime | None = None,
        source_version: int = 1,
    ) -> EnterpriseSnapshotRun:
        if not scope.can("intelligence:view"):
            raise PermissionError("当前身份无企业智能中枢访问权限")
        if source_version < 1:
            raise ValueError("source_version must be positive")
        fixed_cutoff = _utc(cutoff)
        quality = persist_enterprise_data_quality_issues(
            db,
            scope,
            detected_at=fixed_cutoff,
            source_version=source_version,
        )
        snapshots = persist_enterprise_overview_snapshots(
            db,
            scope,
            cutoff=fixed_cutoff,
        )
        return EnterpriseSnapshotRun(
            worker_id=self.worker_id,
            scope_fingerprint=scope.scope_fingerprint,
            cutoff=fixed_cutoff,
            source_version=source_version,
            metric_snapshots_created=snapshots["metric_snapshots_created"],
            health_snapshots_created=snapshots["health_snapshots_created"],
            quality_issues_scanned=quality["issues_scanned"],
            quality_issues_created=quality["issues_created"],
        )


__all__ = ["EnterpriseSnapshotRun", "EnterpriseSnapshotWorker"]
