from collections.abc import Callable

from fastapi import Request
from sqlalchemy.orm import Session

from ..audit import AuditActor, AuditEvent, AuditRequest, JsonValue, write_audit
from ..config import Settings
from ..crypto import ContentCipher
from ..prompt_client import PromptCenterClient
from ..schemas import SessionPayload


PromptDependency = Callable[..., PromptCenterClient]
CipherDependency = Callable[..., ContentCipher]


def write_request_audit(
    db: Session,
    session: SessionPayload,
    request: Request,
    settings: Settings,
    *,
    action: str,
    entity_type: str,
    entity_uuid: str,
    result: str = "SUCCESS",
    metadata: dict[str, JsonValue] | None = None,
) -> None:
    write_audit(
        db,
        AuditActor(
            sso_user_id=str(session.user.id),
            username=session.user.username,
        ),
        AuditRequest(
            ip_address=request.client.host if request.client else "",
            user_agent=request.headers.get("user-agent", ""),
        ),
        AuditEvent(
            action=action,
            entity_type=entity_type,
            entity_uuid=entity_uuid,
            result=result,
            metadata=metadata or {},
        ),
        hash_salt=settings.audit_hash_salt,
    )
