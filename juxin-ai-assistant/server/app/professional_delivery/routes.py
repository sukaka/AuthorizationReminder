import uuid as uuid_lib
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ..admin.route_common import write_request_audit
from ..auth import get_session, require_action
from ..config import Settings, get_settings
from ..crypto import ContentCipher
from ..database import get_db
from ..export_file_manager import (
    DOCX_MEDIA_TYPE,
    ExportFileManager,
    content_disposition_for_download,
)
from ..models import WorkArtifactVersion
from ..project_access import require_project_access
from ..schemas import SessionPayload
from .schemas import (
    DeliverableApprovalActionOut,
    DeliverableApproveIn,
    DeliverableArchiveIn,
    DeliverableCommentCreateIn,
    DeliverableCommentListOut,
    DeliverableCommentMutationOut,
    DeliverableCommentReplyIn,
    DeliverableCommentResolveIn,
    DeliverableCreateIn,
    DeliverableDeliverIn,
    DeliverableDeliveryOut,
    DeliverableDetailOut,
    DeliverableEvidenceRefreshOut,
    DeliverableExportCreateIn,
    DeliverableExportOut,
    DeliverableListOut,
    DeliverableMetadataUpdateIn,
    DeliverableRequestChangesIn,
    DeliverableSubmitIn,
    DeliverableVersionCreateIn,
    DeliverableVersionCreateOut,
    DeliverableVersionDetailOut,
    DeliverableVersionDiffOut,
    DeliverableVersionHistoryOut,
    ExperienceCandidateCreateIn,
    ExperienceCandidateCreateOut,
    ReviewCreateOut,
    ReviewHistoryOut,
    ReviewIssueUpdateIn,
    ReviewIssueUpdateOut,
    ReviewStartIn,
)
from .approval_service import (
    approval_event_payload,
    approve_deliverable,
    archive_delivered_deliverable,
    comment_payload,
    create_deliverable_comment,
    deliver_approved_deliverable,
    delivery_record_payload,
    list_deliverable_comments,
    reply_to_deliverable_comment,
    request_deliverable_changes,
    resolve_deliverable_comment,
    submit_deliverable_for_approval,
)
from .export_service import (
    create_deliverable_export,
    deliverable_export_payload,
    get_deliverable_export_download,
)
from .service import (
    PROJECT_WRITER_ROLES,
    ProfessionalDeliveryEvidenceInvalidatedError,
    ProfessionalDeliveryError,
    create_experience_candidate,
    create_deliverable,
    create_deliverable_review,
    create_deliverable_version,
    deliverable_detail_payload,
    deliverable_source_change_notice,
    deliverable_summary_payload,
    deliverable_version_diff_payload,
    deliverable_version_metadata_payload,
    deliverable_version_payload,
    experience_candidate_payload,
    get_deliverable_version,
    get_visible_deliverable,
    list_deliverable_reviews,
    list_deliverable_versions,
    list_review_issues,
    list_visible_deliverables,
    review_issue_payload,
    review_run_payload,
    refresh_deliverable_evidence_state,
    update_deliverable_metadata,
    update_review_issue,
)


router = APIRouter(prefix="/api/ai/deliverables", tags=["professional-deliverables"])
review_issue_router = APIRouter(
    prefix="/api/ai/review-issues",
    tags=["professional-deliverable-reviews"],
)
comment_router = APIRouter(
    prefix="/api/ai/comments",
    tags=["professional-deliverable-comments"],
)
export_router = APIRouter(
    prefix="/api/ai/deliverable-exports",
    tags=["professional-deliverable-exports"],
)


def get_deliverable_content_cipher(
    current_settings: Annotated[Settings, Depends(get_settings)],
) -> ContentCipher:
    return ContentCipher(current_settings.content_encryption_key)


async def _require_ai_use(
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


def _request_id(request: Request) -> str:
    supplied = request.headers.get("x-request-id", "").strip()
    return supplied[:128] if supplied else str(uuid_lib.uuid4())


def _idempotency_key(value: str | None) -> str:
    normalized = (value or "").strip()
    if not normalized:
        raise ProfessionalDeliveryError(
            "IDEMPOTENCY_KEY_REQUIRED",
            "写入成果必须提供 Idempotency-Key",
            400,
        )
    if len(normalized) > 128:
        raise ProfessionalDeliveryError(
            "IDEMPOTENCY_KEY_INVALID",
            "Idempotency-Key 长度不能超过 128 个字符",
            400,
        )
    return normalized


def _http_error(error: ProfessionalDeliveryError) -> HTTPException:
    detail = {**error.details, "code": error.code, "message": error.message}
    return HTTPException(
        status_code=error.status_code,
        detail=detail,
    )


def _commit_evidence_invalidation(
    db: Session,
    *,
    session_payload: SessionPayload,
    request: Request,
    current_settings: Settings,
    deliverable_uuid: str,
    error: ProfessionalDeliveryEvidenceInvalidatedError,
) -> None:
    try:
        write_request_audit(
            db,
            session_payload,
            request,
            current_settings,
            action="professional_deliverable.evidence.invalidate",
            entity_type="professional_deliverable",
            entity_uuid=deliverable_uuid,
            metadata={
                "event": "deliverable_evidence_invalidated",
                "status": "changes_requested",
                "record_count": len(
                    error.details.get("invalidated_evidence_uuids", [])
                ),
            },
        )
        db.commit()
    except Exception:
        db.rollback()
        raise


def _approval_action_output(
    db: Session,
    *,
    request_id: str,
    result,
) -> DeliverableApprovalActionOut:
    return DeliverableApprovalActionOut(
        request_id=request_id,
        deliverable_uuid=result.access.artifact.uuid,
        lifecycle_status=result.access.artifact.lifecycle_status,
        row_version=result.access.artifact.row_version,
        event=approval_event_payload(db, event=result.event),
    )


@router.post("", response_model=DeliverableDetailOut, status_code=201)
async def create_professional_deliverable(
    body: DeliverableCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> DeliverableDetailOut:
    await _require_ai_use(request, session_payload, current_settings)
    actor_user_id = str(session_payload.user.id)
    try:
        idempotency_key = _idempotency_key(idempotency_key_header)
        project = None
        if body.scope_type == "project":
            if not body.project_uuid:
                raise ProfessionalDeliveryError(
                    "INVALID_DELIVERABLE_SCOPE",
                    "项目成果必须指定项目",
                    422,
                )
            project, member = require_project_access(
                db,
                body.project_uuid,
                actor_user_id,
            )
            if member.role not in PROJECT_WRITER_ROLES:
                raise ProfessionalDeliveryError(
                    "PROJECT_DELIVERABLE_WRITE_FORBIDDEN",
                    "当前项目角色不能创建成果",
                    403,
                )
        elif body.project_uuid is not None:
            raise ProfessionalDeliveryError(
                "INVALID_DELIVERABLE_SCOPE",
                "个人成果不能关联项目",
                422,
            )

        result = create_deliverable(
            db,
            body=body,
            actor_user_id=actor_user_id,
            idempotency_key=idempotency_key,
            project=project,
            cipher=cipher,
            key_version=current_settings.content_encryption_key_version,
        )
        if not result.replayed:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_deliverable.create",
                entity_type="professional_deliverable",
                entity_uuid=result.artifact.uuid,
                metadata={"event": "deliverable_created", "status": "draft"},
            )
        db.commit()
        access = get_visible_deliverable(
            db,
            deliverable_uuid=result.artifact.uuid,
            actor_user_id=actor_user_id,
        )
        return DeliverableDetailOut(
            **deliverable_detail_payload(
                db,
                access=access,
                cipher=cipher,
                request_id=_request_id(request),
            )
        )
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@router.patch("/{deliverable_uuid}", response_model=DeliverableDetailOut)
async def update_professional_deliverable_metadata(
    deliverable_uuid: str,
    body: DeliverableMetadataUpdateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> DeliverableDetailOut:
    await _require_ai_use(request, session_payload, current_settings)
    actor_user_id = str(session_payload.user.id)
    request_id = _request_id(request)
    try:
        result = update_deliverable_metadata(
            db,
            deliverable_uuid=deliverable_uuid,
            body=body,
            actor_user_id=actor_user_id,
            idempotency_key=_idempotency_key(idempotency_key_header),
        )
        if not result.replayed:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_deliverable.metadata.update",
                entity_type="professional_deliverable",
                entity_uuid=result.access.artifact.uuid,
                metadata={
                    "event": "deliverable_metadata_updated",
                    "status": result.access.artifact.lifecycle_status,
                },
            )
        db.commit()
        access = get_visible_deliverable(
            db,
            deliverable_uuid=deliverable_uuid,
            actor_user_id=actor_user_id,
        )
        return DeliverableDetailOut(
            **deliverable_detail_payload(
                db,
                access=access,
                cipher=cipher,
                request_id=request_id,
            )
        )
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@router.post(
    "/{deliverable_uuid}/versions",
    response_model=DeliverableVersionCreateOut,
    status_code=201,
)
async def create_professional_deliverable_version(
    deliverable_uuid: str,
    body: DeliverableVersionCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> DeliverableVersionCreateOut:
    await _require_ai_use(request, session_payload, current_settings)
    actor_user_id = str(session_payload.user.id)
    try:
        idempotency_key = _idempotency_key(idempotency_key_header)
        result = create_deliverable_version(
            db,
            deliverable_uuid=deliverable_uuid,
            body=body,
            actor_user_id=actor_user_id,
            idempotency_key=idempotency_key,
            cipher=cipher,
            key_version=current_settings.content_encryption_key_version,
        )
        if not result.replayed:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_deliverable.version.create",
                entity_type="professional_deliverable",
                entity_uuid=result.artifact.uuid,
                metadata={
                    "event": "deliverable_version_created",
                    "from_version": (
                        result.parent_version.version
                        if result.parent_version is not None
                        else None
                    ),
                    "to_version": result.version.version,
                    "status": result.artifact.lifecycle_status,
                },
            )
        db.commit()
        return DeliverableVersionCreateOut(
            request_id=_request_id(request),
            deliverable_uuid=result.artifact.uuid,
            version=deliverable_version_payload(
                db,
                version=result.version,
                cipher=cipher,
            ),
        )
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@router.get(
    "/{deliverable_uuid}/versions",
    response_model=DeliverableVersionHistoryOut,
)
async def list_professional_deliverable_versions(
    deliverable_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> DeliverableVersionHistoryOut:
    await _require_ai_use(request, session_payload, current_settings)
    try:
        access = get_visible_deliverable(
            db,
            deliverable_uuid=deliverable_uuid,
            actor_user_id=str(session_payload.user.id),
        )
        versions, total = list_deliverable_versions(
            db,
            artifact=access.artifact,
            page=page,
            page_size=page_size,
        )
        return DeliverableVersionHistoryOut(
            request_id=_request_id(request),
            deliverable_uuid=access.artifact.uuid,
            items=[
                deliverable_version_metadata_payload(
                    db,
                    artifact=access.artifact,
                    version=version,
                )
                for version in versions
            ],
            total=total,
            page=page,
            page_size=page_size,
        )
    except ProfessionalDeliveryError as error:
        raise _http_error(error) from error


@router.get(
    "/{deliverable_uuid}/versions/{version_uuid}",
    response_model=DeliverableVersionDetailOut,
)
async def get_professional_deliverable_version(
    deliverable_uuid: str,
    version_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
) -> DeliverableVersionDetailOut:
    await _require_ai_use(request, session_payload, current_settings)
    try:
        access = get_visible_deliverable(
            db,
            deliverable_uuid=deliverable_uuid,
            actor_user_id=str(session_payload.user.id),
        )
        version = get_deliverable_version(
            db,
            artifact=access.artifact,
            version_uuid=version_uuid,
        )
        return DeliverableVersionDetailOut(
            request_id=_request_id(request),
            deliverable_uuid=access.artifact.uuid,
            version=deliverable_version_payload(
                db,
                version=version,
                cipher=cipher,
            ),
        )
    except ProfessionalDeliveryError as error:
        raise _http_error(error) from error


@router.get(
    "/{deliverable_uuid}/diff",
    response_model=DeliverableVersionDiffOut,
)
async def diff_professional_deliverable_versions(
    deliverable_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    from_version_uuid: Annotated[
        str,
        Query(alias="from", min_length=1, max_length=36),
    ],
    to_version_uuid: Annotated[
        str,
        Query(alias="to", min_length=1, max_length=36),
    ],
) -> DeliverableVersionDiffOut:
    await _require_ai_use(request, session_payload, current_settings)
    try:
        access = get_visible_deliverable(
            db,
            deliverable_uuid=deliverable_uuid,
            actor_user_id=str(session_payload.user.id),
        )
        from_version = get_deliverable_version(
            db,
            artifact=access.artifact,
            version_uuid=from_version_uuid,
        )
        to_version = get_deliverable_version(
            db,
            artifact=access.artifact,
            version_uuid=to_version_uuid,
        )
        return DeliverableVersionDiffOut(
            request_id=_request_id(request),
            deliverable_uuid=access.artifact.uuid,
            **deliverable_version_diff_payload(
                db,
                from_version=from_version,
                to_version=to_version,
                cipher=cipher,
            ),
        )
    except ProfessionalDeliveryError as error:
        raise _http_error(error) from error


@router.post(
    "/{deliverable_uuid}/submit",
    response_model=DeliverableApprovalActionOut,
    status_code=201,
)
async def submit_professional_deliverable(
    deliverable_uuid: str,
    body: DeliverableSubmitIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> DeliverableApprovalActionOut:
    await _require_ai_use(request, session_payload, current_settings)
    request_id = _request_id(request)
    try:
        result = submit_deliverable_for_approval(
            db,
            deliverable_uuid=deliverable_uuid,
            body=body,
            actor_user_id=str(session_payload.user.id),
            idempotency_key=_idempotency_key(idempotency_key_header),
            request_id=request_id,
            cipher=cipher,
            key_version=current_settings.content_encryption_key_version,
        )
        if not result.replayed:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_deliverable.approval.submit",
                entity_type="professional_deliverable",
                entity_uuid=result.access.artifact.uuid,
                metadata={
                    "event": "deliverable_submitted",
                    "status": result.access.artifact.lifecycle_status,
                },
            )
        db.commit()
        return _approval_action_output(db, request_id=request_id, result=result)
    except ProfessionalDeliveryError as error:
        if isinstance(error, ProfessionalDeliveryEvidenceInvalidatedError):
            _commit_evidence_invalidation(
                db,
                session_payload=session_payload,
                request=request,
                current_settings=current_settings,
                deliverable_uuid=deliverable_uuid,
                error=error,
            )
        else:
            db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@router.post(
    "/{deliverable_uuid}/approve",
    response_model=DeliverableApprovalActionOut,
)
async def approve_professional_deliverable(
    deliverable_uuid: str,
    body: DeliverableApproveIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> DeliverableApprovalActionOut:
    await _require_ai_use(request, session_payload, current_settings)
    request_id = _request_id(request)
    try:
        result = approve_deliverable(
            db,
            deliverable_uuid=deliverable_uuid,
            body=body,
            actor_user_id=str(session_payload.user.id),
            idempotency_key=_idempotency_key(idempotency_key_header),
            request_id=request_id,
            cipher=cipher,
            key_version=current_settings.content_encryption_key_version,
        )
        if not result.replayed:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_deliverable.approval.approve",
                entity_type="professional_deliverable",
                entity_uuid=result.access.artifact.uuid,
                metadata={
                    "event": "deliverable_approved",
                    "status": result.access.artifact.lifecycle_status,
                },
            )
        db.commit()
        return _approval_action_output(db, request_id=request_id, result=result)
    except ProfessionalDeliveryError as error:
        if isinstance(error, ProfessionalDeliveryEvidenceInvalidatedError):
            _commit_evidence_invalidation(
                db,
                session_payload=session_payload,
                request=request,
                current_settings=current_settings,
                deliverable_uuid=deliverable_uuid,
                error=error,
            )
        else:
            db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@router.post(
    "/{deliverable_uuid}/request-changes",
    response_model=DeliverableApprovalActionOut,
)
async def request_professional_deliverable_changes(
    deliverable_uuid: str,
    body: DeliverableRequestChangesIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> DeliverableApprovalActionOut:
    await _require_ai_use(request, session_payload, current_settings)
    request_id = _request_id(request)
    try:
        result = request_deliverable_changes(
            db,
            deliverable_uuid=deliverable_uuid,
            body=body,
            actor_user_id=str(session_payload.user.id),
            idempotency_key=_idempotency_key(idempotency_key_header),
            request_id=request_id,
            cipher=cipher,
            key_version=current_settings.content_encryption_key_version,
        )
        if not result.replayed:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_deliverable.approval.request_changes",
                entity_type="professional_deliverable",
                entity_uuid=result.access.artifact.uuid,
                metadata={
                    "event": "deliverable_changes_requested",
                    "status": result.access.artifact.lifecycle_status,
                    "record_count": len(result.event.comment_uuids_json or []),
                },
            )
        db.commit()
        return _approval_action_output(db, request_id=request_id, result=result)
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@router.post(
    "/{deliverable_uuid}/comments",
    response_model=DeliverableCommentMutationOut,
    status_code=201,
)
async def create_professional_deliverable_comment(
    deliverable_uuid: str,
    body: DeliverableCommentCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> DeliverableCommentMutationOut:
    await _require_ai_use(request, session_payload, current_settings)
    request_id = _request_id(request)
    try:
        result = create_deliverable_comment(
            db,
            deliverable_uuid=deliverable_uuid,
            body=body,
            actor_user_id=str(session_payload.user.id),
            idempotency_key=_idempotency_key(idempotency_key_header),
            cipher=cipher,
            key_version=current_settings.content_encryption_key_version,
        )
        if not result.replayed:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_deliverable.comment.create",
                entity_type="professional_deliverable",
                entity_uuid=result.access.artifact.uuid,
                metadata={"event": "deliverable_comment_created", "status": "open"},
            )
        db.commit()
        return DeliverableCommentMutationOut(
            request_id=request_id,
            deliverable_uuid=result.access.artifact.uuid,
            comment=comment_payload(
                db,
                comment=result.comment,
                cipher=cipher,
                access=result.access,
                actor_user_id=str(session_payload.user.id),
            ),
        )
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@router.get(
    "/{deliverable_uuid}/comments",
    response_model=DeliverableCommentListOut,
)
async def list_professional_deliverable_comments(
    deliverable_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
) -> DeliverableCommentListOut:
    await _require_ai_use(request, session_payload, current_settings)
    try:
        access, comments = list_deliverable_comments(
            db,
            deliverable_uuid=deliverable_uuid,
            actor_user_id=str(session_payload.user.id),
        )
        return DeliverableCommentListOut(
            request_id=_request_id(request),
            deliverable_uuid=access.artifact.uuid,
            items=[
                comment_payload(
                    db,
                    comment=comment,
                    cipher=cipher,
                    access=access,
                    actor_user_id=str(session_payload.user.id),
                )
                for comment in comments
            ],
            total=len(comments),
        )
    except ProfessionalDeliveryError as error:
        raise _http_error(error) from error


@comment_router.post(
    "/{comment_uuid}/replies",
    response_model=DeliverableCommentMutationOut,
    status_code=201,
)
async def reply_to_professional_deliverable_comment(
    comment_uuid: str,
    body: DeliverableCommentReplyIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> DeliverableCommentMutationOut:
    await _require_ai_use(request, session_payload, current_settings)
    request_id = _request_id(request)
    try:
        result = reply_to_deliverable_comment(
            db,
            comment_uuid=comment_uuid,
            body=body,
            actor_user_id=str(session_payload.user.id),
            idempotency_key=_idempotency_key(idempotency_key_header),
            cipher=cipher,
            key_version=current_settings.content_encryption_key_version,
        )
        if not result.replayed:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_deliverable.comment.reply",
                entity_type="professional_deliverable",
                entity_uuid=result.access.artifact.uuid,
                metadata={"event": "deliverable_comment_replied", "status": "open"},
            )
        db.commit()
        return DeliverableCommentMutationOut(
            request_id=request_id,
            deliverable_uuid=result.access.artifact.uuid,
            comment=comment_payload(
                db,
                comment=result.comment,
                cipher=cipher,
                access=result.access,
                actor_user_id=str(session_payload.user.id),
            ),
        )
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@comment_router.post(
    "/{comment_uuid}/resolve",
    response_model=DeliverableCommentMutationOut,
)
async def resolve_professional_deliverable_comment(
    comment_uuid: str,
    body: DeliverableCommentResolveIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> DeliverableCommentMutationOut:
    await _require_ai_use(request, session_payload, current_settings)
    request_id = _request_id(request)
    try:
        result = resolve_deliverable_comment(
            db,
            comment_uuid=comment_uuid,
            body=body,
            actor_user_id=str(session_payload.user.id),
            idempotency_key=_idempotency_key(idempotency_key_header),
            cipher=cipher,
        )
        if not result.replayed:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_deliverable.comment.resolve",
                entity_type="professional_deliverable",
                entity_uuid=result.access.artifact.uuid,
                metadata={
                    "event": "deliverable_comment_resolved",
                    "status": result.comment.status,
                },
            )
        db.commit()
        return DeliverableCommentMutationOut(
            request_id=request_id,
            deliverable_uuid=result.access.artifact.uuid,
            comment=comment_payload(
                db,
                comment=result.comment,
                cipher=cipher,
                access=result.access,
                actor_user_id=str(session_payload.user.id),
            ),
        )
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@router.post(
    "/{deliverable_uuid}/deliver",
    response_model=DeliverableDeliveryOut,
    status_code=201,
)
async def deliver_professional_deliverable(
    deliverable_uuid: str,
    body: DeliverableDeliverIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> DeliverableDeliveryOut:
    await _require_ai_use(request, session_payload, current_settings)
    request_id = _request_id(request)
    try:
        result = deliver_approved_deliverable(
            db,
            deliverable_uuid=deliverable_uuid,
            body=body,
            actor_user_id=str(session_payload.user.id),
            idempotency_key=_idempotency_key(idempotency_key_header),
            request_id=request_id,
            cipher=cipher,
            key_version=current_settings.content_encryption_key_version,
        )
        if not result.replayed:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_deliverable.delivery.create",
                entity_type="professional_deliverable",
                entity_uuid=result.access.artifact.uuid,
                metadata={
                    "event": "deliverable_delivered",
                    "status": result.access.artifact.lifecycle_status,
                },
            )
        db.commit()
        return DeliverableDeliveryOut(
            request_id=request_id,
            deliverable_uuid=result.access.artifact.uuid,
            lifecycle_status=result.access.artifact.lifecycle_status,
            row_version=result.access.artifact.row_version,
            delivery=delivery_record_payload(result=result, cipher=cipher),
        )
    except ProfessionalDeliveryError as error:
        if isinstance(error, ProfessionalDeliveryEvidenceInvalidatedError):
            _commit_evidence_invalidation(
                db,
                session_payload=session_payload,
                request=request,
                current_settings=current_settings,
                deliverable_uuid=deliverable_uuid,
                error=error,
            )
        else:
            db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@router.post(
    "/{deliverable_uuid}/archive",
    response_model=DeliverableApprovalActionOut,
)
async def archive_professional_deliverable(
    deliverable_uuid: str,
    body: DeliverableArchiveIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> DeliverableApprovalActionOut:
    await _require_ai_use(request, session_payload, current_settings)
    request_id = _request_id(request)
    try:
        result = archive_delivered_deliverable(
            db,
            deliverable_uuid=deliverable_uuid,
            body=body,
            actor_user_id=str(session_payload.user.id),
            idempotency_key=_idempotency_key(idempotency_key_header),
            request_id=request_id,
            cipher=cipher,
            key_version=current_settings.content_encryption_key_version,
        )
        if not result.replayed:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_deliverable.archive",
                entity_type="professional_deliverable",
                entity_uuid=result.access.artifact.uuid,
                metadata={
                    "event": "deliverable_archived",
                    "status": result.access.artifact.lifecycle_status,
                },
            )
        db.commit()
        return _approval_action_output(db, request_id=request_id, result=result)
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@router.post(
    "/{deliverable_uuid}/experience-candidates",
    response_model=ExperienceCandidateCreateOut,
    status_code=201,
)
async def create_professional_experience_candidate(
    deliverable_uuid: str,
    body: ExperienceCandidateCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> ExperienceCandidateCreateOut:
    await _require_ai_use(request, session_payload, current_settings)
    request_id = _request_id(request)
    try:
        result = create_experience_candidate(
            db,
            deliverable_uuid=deliverable_uuid,
            body=body,
            actor_user_id=str(session_payload.user.id),
            idempotency_key=_idempotency_key(idempotency_key_header),
            request_id=request_id,
            cipher=cipher,
            key_version=current_settings.content_encryption_key_version,
        )
        if not result.replayed:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_deliverable.experience_candidate.create",
                entity_type="professional_deliverable",
                entity_uuid=result.access.artifact.uuid,
                metadata={
                    "candidate_uuid": result.candidate.uuid,
                    "candidate_type": result.candidate.candidate_type,
                    "event": "deliverable_experience_candidate_submitted",
                    "status": result.candidate.status,
                    "version_uuid": result.version.uuid,
                },
            )
        db.commit()
        return ExperienceCandidateCreateOut(
            request_id=request_id,
            deliverable_uuid=result.access.artifact.uuid,
            candidate=experience_candidate_payload(
                access=result.access,
                version=result.version,
                candidate=result.candidate,
                cipher=cipher,
            ),
        )
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@router.post(
    "/{deliverable_uuid}/versions/{version_uuid}/exports",
    response_model=DeliverableExportOut,
    status_code=201,
)
async def create_professional_deliverable_export(
    deliverable_uuid: str,
    version_uuid: str,
    body: DeliverableExportCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> DeliverableExportOut:
    await _require_ai_use(request, session_payload, current_settings)
    request_id = _request_id(request)
    file_manager = ExportFileManager(current_settings.export_storage_dir)
    created_file_path: str | None = None
    try:
        result = create_deliverable_export(
            db,
            deliverable_uuid=deliverable_uuid,
            version_uuid=version_uuid,
            body=body,
            actor_user_id=str(session_payload.user.id),
            actor_name=session_payload.user.username,
            actor_department=session_payload.scope.department or "待确认",
            idempotency_key=_idempotency_key(idempotency_key_header),
            request_id=request_id,
            cipher=cipher,
            file_manager=file_manager,
        )
        created_file_path = result.created_file_path
        if not result.replayed:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_deliverable.export.create",
                entity_type="professional_deliverable",
                entity_uuid=result.access.artifact.uuid,
                metadata={
                    "event": "deliverable_export_created",
                    "status": result.export.status,
                    "watermarked": result.export.watermarked,
                },
            )
        db.commit()
        return DeliverableExportOut(
            **deliverable_export_payload(request_id=request_id, result=result)
        )
    except ProfessionalDeliveryError as error:
        db.rollback()
        if created_file_path is not None:
            file_manager.delete_docx(created_file_path)
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        if created_file_path is not None:
            file_manager.delete_docx(created_file_path)
        raise


@export_router.get("/{export_uuid}/download")
async def download_professional_deliverable_export(
    export_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    await _require_ai_use(request, session_payload, current_settings)
    try:
        result = get_deliverable_export_download(
            db,
            export_uuid=export_uuid,
            actor_user_id=str(session_payload.user.id),
            file_manager=ExportFileManager(current_settings.export_storage_dir),
        )
        write_request_audit(
            db,
            session_payload,
            request,
            current_settings,
            action="professional_deliverable.export.download",
            entity_type="professional_deliverable",
            entity_uuid=result.access.artifact.uuid,
            metadata={
                "event": "deliverable_export_downloaded",
                "status": result.export.status,
                "watermarked": result.export.watermarked,
            },
        )
        db.commit()
        return Response(
            content=result.content,
            media_type=DOCX_MEDIA_TYPE,
            headers={
                "Content-Disposition": content_disposition_for_download(
                    result.export.file_name
                )
            },
        )
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@router.post(
    "/{deliverable_uuid}/reviews",
    response_model=ReviewCreateOut,
    status_code=201,
)
async def create_professional_deliverable_review(
    deliverable_uuid: str,
    body: ReviewStartIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> ReviewCreateOut:
    await _require_ai_use(request, session_payload, current_settings)
    actor_user_id = str(session_payload.user.id)
    request_id = _request_id(request)
    try:
        result = create_deliverable_review(
            db,
            deliverable_uuid=deliverable_uuid,
            body=body,
            actor_user_id=actor_user_id,
            idempotency_key=_idempotency_key(idempotency_key_header),
            request_id=request_id,
            cipher=cipher,
        )
        if not result.replayed:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_deliverable.review.create",
                entity_type="professional_deliverable",
                entity_uuid=result.artifact.uuid,
                metadata={
                    "event": "deliverable_review_completed",
                    "status": result.run.status,
                    "record_count": len(result.issues),
                },
            )
        db.commit()
        return ReviewCreateOut(
            request_id=request_id,
            deliverable_uuid=result.artifact.uuid,
            lifecycle_status=result.artifact.lifecycle_status,
            row_version=result.artifact.row_version,
            review=review_run_payload(
                db,
                run=result.run,
                issues=result.issues,
            ),
        )
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@router.get(
    "/{deliverable_uuid}/reviews",
    response_model=ReviewHistoryOut,
)
async def list_professional_deliverable_reviews(
    deliverable_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> ReviewHistoryOut:
    await _require_ai_use(request, session_payload, current_settings)
    try:
        access = get_visible_deliverable(
            db,
            deliverable_uuid=deliverable_uuid,
            actor_user_id=str(session_payload.user.id),
        )
        runs, total = list_deliverable_reviews(
            db,
            artifact=access.artifact,
            page=page,
            page_size=page_size,
        )
        return ReviewHistoryOut(
            request_id=_request_id(request),
            deliverable_uuid=access.artifact.uuid,
            items=[
                review_run_payload(
                    db,
                    run=run,
                    issues=list_review_issues(db, run=run),
                )
                for run in runs
            ],
            total=total,
            page=page,
            page_size=page_size,
        )
    except ProfessionalDeliveryError as error:
        raise _http_error(error) from error


@review_issue_router.patch(
    "/{issue_uuid}",
    response_model=ReviewIssueUpdateOut,
)
async def update_professional_review_issue(
    issue_uuid: str,
    body: ReviewIssueUpdateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ReviewIssueUpdateOut:
    await _require_ai_use(request, session_payload, current_settings)
    try:
        result = update_review_issue(
            db,
            issue_uuid=issue_uuid,
            body=body,
            actor_user_id=str(session_payload.user.id),
        )
        write_request_audit(
            db,
            session_payload,
            request,
            current_settings,
            action="professional_deliverable.review_issue.update",
            entity_type="professional_deliverable",
            entity_uuid=result.access.artifact.uuid,
            metadata={
                "event": "review_issue_updated",
                "status": result.issue.status,
            },
        )
        db.commit()
        return ReviewIssueUpdateOut(
            request_id=_request_id(request),
            deliverable_uuid=result.access.artifact.uuid,
            issue=review_issue_payload(
                db,
                run=result.run,
                issue=result.issue,
            ),
        )
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@router.get("", response_model=DeliverableListOut)
async def list_professional_deliverables(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 50,
) -> DeliverableListOut:
    await _require_ai_use(request, session_payload, current_settings)
    accesses, total = list_visible_deliverables(
        db,
        actor_user_id=str(session_payload.user.id),
        page=page,
        page_size=page_size,
    )
    return DeliverableListOut(
        request_id=_request_id(request),
        items=[deliverable_summary_payload(db, access) for access in accesses],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{deliverable_uuid}", response_model=DeliverableDetailOut)
async def get_professional_deliverable(
    deliverable_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
) -> DeliverableDetailOut:
    await _require_ai_use(request, session_payload, current_settings)
    try:
        access = get_visible_deliverable(
            db,
            deliverable_uuid=deliverable_uuid,
            actor_user_id=str(session_payload.user.id),
        )
        return DeliverableDetailOut(
            **deliverable_detail_payload(
                db,
                access=access,
                cipher=cipher,
                request_id=_request_id(request),
            )
        )
    except ProfessionalDeliveryError as error:
        raise _http_error(error) from error


@router.post(
    "/{deliverable_uuid}/evidence/refresh",
    response_model=DeliverableEvidenceRefreshOut,
)
async def refresh_professional_deliverable_evidence(
    deliverable_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> DeliverableEvidenceRefreshOut:
    await _require_ai_use(request, session_payload, current_settings)
    actor_user_id = str(session_payload.user.id)
    request_id = _request_id(request)
    try:
        _idempotency_key(idempotency_key_header)
        access = get_visible_deliverable(
            db,
            deliverable_uuid=deliverable_uuid,
            actor_user_id=actor_user_id,
            lock=True,
        )
        artifact = access.artifact
        version = (
            db.get(WorkArtifactVersion, artifact.current_version_id)
            if artifact.current_version_id is not None
            else None
        )
        if version is None:
            raise ProfessionalDeliveryError(
                "DELIVERABLE_VERSION_NOT_AVAILABLE",
                "成果当前版本不可用",
                409,
            )
        refresh_result = refresh_deliverable_evidence_state(
            db,
            artifact=artifact,
            version=version,
            actor_user_id=actor_user_id,
        )
        notice = deliverable_source_change_notice(
            db,
            artifact=artifact,
            version=version,
        )
        if refresh_result.stale_evidence_uuids:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_deliverable.evidence.invalidate",
                entity_type="professional_deliverable",
                entity_uuid=artifact.uuid,
                metadata={
                    "event": "deliverable_source_change_detected",
                    "status": artifact.lifecycle_status,
                    "record_count": len(refresh_result.stale_evidence_uuids),
                    "historical_snapshot_preserved": bool(
                        notice
                        and notice["historical_snapshot_preserved"]
                    ),
                },
            )
        db.commit()
        return DeliverableEvidenceRefreshOut(
            request_id=request_id,
            deliverable_uuid=artifact.uuid,
            lifecycle_status=artifact.lifecycle_status,
            row_version=artifact.row_version,
            invalidated_evidence_uuids=list(
                refresh_result.stale_evidence_uuids
            ),
            source_change_notice=notice,
        )
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise
