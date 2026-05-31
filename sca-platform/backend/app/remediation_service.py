from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from .models import RemediationEvent, RemediationTicket, VulnerabilityRecord, VulnerabilityWhitelist


VALID_TRANSITIONS = {
    "未处理": {"修复中", "已忽略", "待确认"},
    "修复中": {"待确认", "已修复", "已忽略"},
    "待确认": {"已修复", "修复中", "已忽略"},
    "已修复": set(),
    "已忽略": set(),
}


def create_ticket_no(project_id: int, vulnerability_id: int) -> str:
    return f"SCA-{project_id}-{vulnerability_id}-{int(datetime.now(timezone.utc).timestamp())}"


def transition_ticket(db: Session, ticket: RemediationTicket, next_status: str, actor: str, comment: str = "") -> RemediationTicket:
    allowed = VALID_TRANSITIONS.get(ticket.status, set())
    if next_status != ticket.status and next_status not in allowed:
        raise ValueError(f"状态不允许从 {ticket.status} 流转到 {next_status}")
    previous = ticket.status
    ticket.status = next_status
    if next_status in {"已修复", "已忽略"}:
        ticket.closed_at = datetime.now(timezone.utc)
    db.add(RemediationEvent(ticket_id=ticket.id, from_status=previous, to_status=next_status, actor=actor, comment=comment))
    return ticket


def verify_ticket(db: Session, ticket: RemediationTicket, result: str, actor: str, comment: str = "") -> RemediationTicket:
    ticket.verification_result = result
    target = "已修复" if result == "pass" else "修复中"
    return transition_ticket(db, ticket, target, actor, comment or f"验证结果：{result}")


def ignore_vulnerability(
    db: Session,
    vulnerability: VulnerabilityRecord,
    reason: str,
    expires_at: str,
    actor: str,
) -> VulnerabilityWhitelist:
    vulnerability.severity = vulnerability.severity or "unknown"
    row = VulnerabilityWhitelist(
        project_id=vulnerability.project_id,
        vulnerability_id=vulnerability.id,
        reason=reason,
        expires_at=expires_at,
        created_by=actor,
        active=True,
    )
    db.add(row)
    return row


def is_overdue(ticket: RemediationTicket) -> bool:
    if not ticket.due_date or ticket.status in {"已修复", "已忽略"}:
        return False
    try:
        due = datetime.strptime(ticket.due_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return False
    return due < datetime.now(timezone.utc)
