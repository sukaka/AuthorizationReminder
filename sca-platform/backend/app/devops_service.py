from __future__ import annotations

import json
from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings
from .models import DevopsScanEvent, Project, VulnerabilityRecord


def block_severities(settings: Settings) -> set[str]:
    return {item.strip().lower() for item in settings.devops_block_severities.split(",") if item.strip()}


def resolve_project(db: Session, project_id: int | None, project_name: str = "") -> Project | None:
    if project_id:
        return db.get(Project, project_id)
    if project_name:
        return db.scalar(select(Project).where(Project.name == project_name))
    return None


def evaluate_release_gate(db: Session, project: Project | None, settings: Settings) -> tuple[str, str]:
    if not project:
        return "passed", "未匹配到 SCA 项目，仅记录 Webhook"
    severities = block_severities(settings)
    blockers = list(
        db.scalars(
            select(VulnerabilityRecord).where(
                VulnerabilityRecord.project_id == project.id,
                VulnerabilityRecord.severity.in_(severities),
            )
        )
    )
    if blockers:
        cves = ", ".join((item.cve_id or item.advisory_id) for item in blockers[:5])
        return "blocked", f"发现阻断级别漏洞 {len(blockers)} 个：{cves}"
    return "passed", "未发现阻断级别漏洞"


def record_devops_event(db: Session, payload: dict, settings: Settings) -> DevopsScanEvent:
    project = resolve_project(db, payload.get("project_id"), payload.get("project_name", ""))
    decision, reason = evaluate_release_gate(db, project, settings)
    event = DevopsScanEvent(
        project_id=project.id if project else None,
        source=str(payload.get("source") or "gitlab"),
        pipeline_id=str(payload.get("pipeline_id") or ""),
        ref=str(payload.get("ref") or ""),
        commit_sha=str(payload.get("commit_sha") or ""),
        status="scanned",
        decision=decision,
        block_reason=reason if decision == "blocked" else "",
        raw_json=json.dumps(payload, ensure_ascii=False),
    )
    db.add(event)
    return event


def devops_dashboard(events: list[DevopsScanEvent]) -> dict:
    by_source = Counter(item.source for item in events)
    return {
        "total": len(events),
        "blocked_count": sum(1 for item in events if item.decision == "blocked"),
        "passed_count": sum(1 for item in events if item.decision == "passed"),
        "by_source": dict(by_source),
    }
