import uuid as uuid_lib
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy.orm import Session

from ..admin.route_common import write_request_audit
from ..auth import get_session, is_platform_admin_role, require_action
from ..config import Settings, get_settings
from ..crypto import ContentCipher
from ..database import get_db
from ..project_access import require_project_access
from ..schemas import SessionPayload
from .catalog_schemas import (
    SkillSelectIn,
    SkillVersionCreateIn,
    TemplateVersionCreateIn,
)
from .catalog_service import (
    ProfessionalCatalogError,
    create_skill_version,
    create_template_version,
    get_skill_version,
    get_template_version,
    list_published_approval_flows,
    list_published_skills,
    list_published_templates,
    publish_skill_version,
    publish_template_version,
    select_skill_version,
    skill_version_detail,
    template_version_detail,
)
from .routes import get_deliverable_content_cipher


skill_catalog_router = APIRouter(
    prefix="/api/ai/skills",
    tags=["professional-skill-catalog"],
)
template_catalog_router = APIRouter(
    prefix="/api/ai/templates",
    tags=["professional-template-catalog"],
)
approval_flow_catalog_router = APIRouter(
    prefix="/api/ai/approval-flows",
    tags=["professional-approval-flow-catalog"],
)


def _http_error(error: ProfessionalCatalogError) -> HTTPException:
    return HTTPException(
        status_code=error.status_code,
        detail={**error.details, "code": error.code, "message": error.message},
    )


def _idempotency_key(value: str | None) -> str:
    normalized = (value or "").strip()
    if not normalized:
        raise ProfessionalCatalogError(
            "IDEMPOTENCY_KEY_REQUIRED",
            "写入目录必须提供 Idempotency-Key",
            400,
        )
    if len(normalized) > 128:
        raise ProfessionalCatalogError(
            "IDEMPOTENCY_KEY_INVALID",
            "Idempotency-Key 长度不能超过 128 个字符",
            400,
        )
    return normalized


def _request_id(request: Request) -> str:
    supplied = request.headers.get("x-request-id", "").strip()
    return supplied[:128] if supplied else str(uuid_lib.uuid4())


async def _require_use(
    request: Request,
    session_payload: SessionPayload,
    current_settings: Settings,
) -> None:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )


async def _require_admin(
    request: Request,
    session_payload: SessionPayload,
    current_settings: Settings,
) -> None:
    if not is_platform_admin_role(session_payload.user.role):
        raise HTTPException(status_code=403, detail="仅管理员可管理专业目录")
    await require_action(
        "ai_assistant:admin",
        request,
        session_payload,
        current_settings,
    )


def _project_id_for_scope(
    db: Session,
    *,
    scope_type: str,
    project_uuid: str | None,
    user_id: str,
) -> int | None:
    if scope_type == "project":
        if not project_uuid:
            raise ProfessionalCatalogError(
                "PROJECT_UUID_REQUIRED",
                "项目范围必须提供 project_uuid",
                422,
            )
        project, _ = require_project_access(db, project_uuid, user_id)
        return project.id
    if project_uuid:
        raise ProfessionalCatalogError(
            "PROJECT_UUID_NOT_ALLOWED",
            "个人范围不能提供 project_uuid",
            422,
        )
    return None


def _template_mutation_payload(result) -> dict:
    version = result.entity
    return {
        "version_uuid": version.uuid,
        "version": version.version,
        "content_hash": version.content_hash,
        "status": version.status,
        "previous_content_hash": result.previous_content_hash,
        "replayed": result.replayed,
    }


@approval_flow_catalog_router.get("")
async def list_professional_approval_flows(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    scope_type: Literal["personal", "project"] = Query(default="personal"),
    deliverable_type: str | None = Query(default=None, max_length=64),
    project_uuid: str | None = Query(default=None, max_length=36),
) -> dict:
    await _require_use(request, session_payload, current_settings)
    try:
        _project_id_for_scope(
            db,
            scope_type=scope_type,
            project_uuid=project_uuid,
            user_id=str(session_payload.user.id),
        )
        items = list_published_approval_flows(
            db,
            scope_type=scope_type,
            deliverable_type=deliverable_type,
        )
        return {"request_id": _request_id(request), "items": items, "total": len(items)}
    except ProfessionalCatalogError as error:
        raise _http_error(error) from error


@skill_catalog_router.get("")
async def list_professional_skills(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    scope_type: Literal["personal", "project"] = Query(default="personal"),
    deliverable_type: str | None = Query(default=None, max_length=64),
    project_uuid: str | None = Query(default=None, max_length=36),
) -> dict:
    await _require_use(request, session_payload, current_settings)
    try:
        _project_id_for_scope(
            db,
            scope_type=scope_type,
            project_uuid=project_uuid,
            user_id=str(session_payload.user.id),
        )
        items = list_published_skills(
            db,
            scope_type=scope_type,
            deliverable_type=deliverable_type,
        )
        return {"request_id": _request_id(request), "items": items, "total": len(items)}
    except ProfessionalCatalogError as error:
        raise _http_error(error) from error


@skill_catalog_router.get("/{skill_uuid}/versions/{version_uuid}")
async def get_professional_skill_version(
    skill_uuid: str,
    version_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    await _require_use(request, session_payload, current_settings)
    try:
        definition, version = get_skill_version(
            db,
            skill_uuid=skill_uuid,
            version_uuid=version_uuid,
            include_draft=is_platform_admin_role(session_payload.user.role),
        )
        return {
            "request_id": _request_id(request),
            **skill_version_detail(db, definition, version),
        }
    except ProfessionalCatalogError as error:
        raise _http_error(error) from error


@skill_catalog_router.post("/select")
async def select_professional_skill(
    body: SkillSelectIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> dict:
    await _require_use(request, session_payload, current_settings)
    try:
        key = _idempotency_key(idempotency_key)
        project_id = _project_id_for_scope(
            db,
            scope_type=body.scope_type,
            project_uuid=body.project_uuid,
            user_id=str(session_payload.user.id),
        )
        result = select_skill_version(
            db,
            body=body,
            actor_user_id=str(session_payload.user.id),
            idempotency_key=key,
            project_id=project_id,
        )
        if not result.replayed:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_skill.select",
                entity_type="professional_skill_selection",
                entity_uuid=result.record.uuid,
                metadata={"status": result.record.selection_source or "pending_confirmation"},
            )
        db.commit()
        return {
            "request_id": _request_id(request),
            "selection_uuid": result.record.uuid,
            "selection_source": result.record.selection_source,
            "selected": result.selected,
            "candidates": result.candidates,
            "confirmation_required": result.confirmation_required,
            "replayed": result.replayed,
        }
    except ProfessionalCatalogError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@skill_catalog_router.post("/{skill_uuid}/versions", status_code=201)
async def create_professional_skill_version(
    skill_uuid: str,
    body: SkillVersionCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> dict:
    await _require_admin(request, session_payload, current_settings)
    try:
        result = create_skill_version(
            db,
            skill_uuid=skill_uuid,
            body=body,
            actor_user_id=str(session_payload.user.id),
            idempotency_key=_idempotency_key(idempotency_key),
            cipher=cipher,
            key_version=current_settings.content_encryption_key_version,
        )
        if not result.replayed:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_skill.version.create",
                entity_type="professional_skill_version",
                entity_uuid=result.entity.uuid,
                metadata={"to_version": result.entity.version, "status": "draft"},
            )
        db.commit()
        definition, version = get_skill_version(
            db,
            skill_uuid=skill_uuid,
            version_uuid=result.entity.uuid,
            include_draft=True,
        )
        return {
            "request_id": _request_id(request),
            "version_uuid": version.uuid,
            "version": version.version,
            "content_hash": version.content_hash,
            "status": version.status,
            "default_template_version_uuid": skill_version_detail(
                db, definition, version
            )["default_template_version_uuid"],
            "previous_content_hash": result.previous_content_hash,
            "replayed": result.replayed,
        }
    except ProfessionalCatalogError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@skill_catalog_router.post("/{skill_uuid}/versions/{version_uuid}/publish")
async def publish_professional_skill_version(
    skill_uuid: str,
    version_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> dict:
    await _require_admin(request, session_payload, current_settings)
    try:
        result = publish_skill_version(
            db,
            skill_uuid=skill_uuid,
            version_uuid=version_uuid,
            actor_user_id=str(session_payload.user.id),
            idempotency_key=_idempotency_key(idempotency_key),
        )
        if not result.replayed and result.changed:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_skill.version.publish",
                entity_type="professional_skill_version",
                entity_uuid=version_uuid,
                metadata={"to_version": result.entity.version, "status": "published"},
            )
        db.commit()
        return {
            "request_id": _request_id(request),
            "version_uuid": result.entity.uuid,
            "version": result.entity.version,
            "content_hash": result.entity.content_hash,
            "status": result.entity.status,
            "replayed": result.replayed,
        }
    except ProfessionalCatalogError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@template_catalog_router.get("")
async def list_professional_templates(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    scope_type: Literal["personal", "project"] = Query(default="personal"),
    deliverable_type: str | None = Query(default=None, max_length=64),
    project_uuid: str | None = Query(default=None, max_length=36),
) -> dict:
    await _require_use(request, session_payload, current_settings)
    try:
        _project_id_for_scope(
            db,
            scope_type=scope_type,
            project_uuid=project_uuid,
            user_id=str(session_payload.user.id),
        )
        items = list_published_templates(
            db,
            scope_type=scope_type,
            deliverable_type=deliverable_type,
        )
        return {"request_id": _request_id(request), "items": items, "total": len(items)}
    except ProfessionalCatalogError as error:
        raise _http_error(error) from error


@template_catalog_router.get("/{template_uuid}/versions/{version_uuid}")
async def get_professional_template_version(
    template_uuid: str,
    version_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    await _require_use(request, session_payload, current_settings)
    try:
        definition, version = get_template_version(
            db,
            template_uuid=template_uuid,
            version_uuid=version_uuid,
            include_draft=is_platform_admin_role(session_payload.user.role),
        )
        return {
            "request_id": _request_id(request),
            **template_version_detail(definition, version),
        }
    except ProfessionalCatalogError as error:
        raise _http_error(error) from error


@template_catalog_router.post("/{template_uuid}/versions", status_code=201)
async def create_professional_template_version(
    template_uuid: str,
    body: TemplateVersionCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> dict:
    await _require_admin(request, session_payload, current_settings)
    try:
        result = create_template_version(
            db,
            template_uuid=template_uuid,
            body=body,
            actor_user_id=str(session_payload.user.id),
            idempotency_key=_idempotency_key(idempotency_key),
        )
        if not result.replayed:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_template.version.create",
                entity_type="professional_template_version",
                entity_uuid=result.entity.uuid,
                metadata={"to_version": result.entity.version, "status": "draft"},
            )
        db.commit()
        return {
            "request_id": _request_id(request),
            **_template_mutation_payload(result),
        }
    except ProfessionalCatalogError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@template_catalog_router.post("/{template_uuid}/versions/{version_uuid}/publish")
async def publish_professional_template_version(
    template_uuid: str,
    version_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> dict:
    await _require_admin(request, session_payload, current_settings)
    try:
        result = publish_template_version(
            db,
            template_uuid=template_uuid,
            version_uuid=version_uuid,
            actor_user_id=str(session_payload.user.id),
            idempotency_key=_idempotency_key(idempotency_key),
        )
        if not result.replayed and result.changed:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_template.version.publish",
                entity_type="professional_template_version",
                entity_uuid=result.entity.uuid,
                metadata={"to_version": result.entity.version, "status": "published"},
            )
        db.commit()
        return {
            "request_id": _request_id(request),
            **_template_mutation_payload(result),
        }
    except ProfessionalCatalogError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise
