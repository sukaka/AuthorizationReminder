from __future__ import annotations

import json
from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings
from .models import DevopsScanEvent, Project, ReportExport, VulnerabilityRecord
from .report_service import generate_report


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
                VulnerabilityRecord.match_status == "affected",
                VulnerabilityRecord.needs_human_review.is_(False),
                VulnerabilityRecord.gate_eligible.is_(True),
            )
        )
    )
    blockers = [
        item
        for item in blockers
        if item.risk_priority in {"P0", "P1"}
        or item.severity in severities
        or item.cisa_kev
        or item.exploited_in_wild
    ]
    if blockers:
        cves = ", ".join(f"{item.risk_priority or item.severity}:{item.cve_id or item.advisory_id}" for item in blockers[:5])
        return "blocked", f"发现发布阻断风险 {len(blockers)} 个（P0/P1、KEV、在野利用或阻断等级漏洞）：{cves}"
    return "passed", "未发现阻断级别漏洞"


def record_devops_event(db: Session, payload: dict, settings: Settings) -> DevopsScanEvent:
    project = resolve_project(db, payload.get("project_id"), payload.get("project_name", ""))
    decision, reason = evaluate_release_gate(db, project, settings)
    report_id = None
    if project:
        try:
            report_path = generate_report(db, project.id, "pdf", settings.report_root)
            report = ReportExport(
                project_id=project.id,
                format="pdf",
                filename=report_path.name,
                storage_path=str(report_path),
                status="generated",
                created_by="devops",
            )
            db.add(report)
            db.flush()
            report_id = report.id
        except Exception:
            report_id = None
    event = DevopsScanEvent(
        project_id=project.id if project else None,
        source=str(payload.get("source") or "gitlab"),
        pipeline_id=str(payload.get("pipeline_id") or ""),
        ref=str(payload.get("ref") or ""),
        commit_sha=str(payload.get("commit_sha") or ""),
        status="scanned",
        decision=decision,
        block_reason=reason if decision == "blocked" else "",
        report_id=report_id,
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
