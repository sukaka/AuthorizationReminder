from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request
from sqlalchemy.orm import Session

from ..admin.route_common import write_request_audit
from ..auth import get_session
from ..config import Settings, get_settings
from ..crypto import ContentCipher
from ..database import get_db
from ..schemas import SessionPayload
from .fact_schemas import (
    EvidenceAttachIn,
    EvidencePreviewOut,
    EvidenceRevokeIn,
    EvidenceRevokeOut,
    EvidenceSearchOut,
    FactEvidenceMutationOut,
    FactExtractIn,
    FactListOut,
    FactMutationOut,
    FactPatchIn,
)
from .fact_service import (
    attach_evidence_to_fact,
    evidence_payload,
    extract_version_facts,
    fact_payload,
    get_evidence_preview,
    link_payload,
    list_version_facts,
    revoke_evidence,
    search_evidence_candidates,
    update_fact,
)
from .routes import (
    _http_error,
    _idempotency_key,
    _request_id,
    _require_ai_use,
    get_deliverable_content_cipher,
)
from .service import ProfessionalDeliveryError


deliverable_fact_router = APIRouter(
    prefix="/api/ai/deliverables",
    tags=["professional-deliverable-facts"],
)
fact_router = APIRouter(
    prefix="/api/ai/facts",
    tags=["professional-deliverable-facts"],
)
evidence_router = APIRouter(
    prefix="/api/ai/evidence",
    tags=["professional-deliverable-evidence"],
)


def _fact_list_output(
    *,
    request_id: str,
    artifact,
    version,
    facts,
    cipher: ContentCipher,
) -> FactListOut:
    items = [
        fact_payload(
            artifact=artifact,
            version=version,
            fact=fact,
            cipher=cipher,
        )
        for fact in facts
    ]
    return FactListOut(
        request_id=request_id,
        deliverable_uuid=artifact.uuid,
        version_uuid=version.uuid,
        content_hash=version.content_hash,
        items=items,
        total=len(items),
    )


@deliverable_fact_router.post(
    "/{deliverable_uuid}/versions/{version_uuid}/facts/extract",
    response_model=FactListOut,
    status_code=201,
)
async def extract_professional_deliverable_facts(
    deliverable_uuid: str,
    version_uuid: str,
    body: FactExtractIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> FactListOut:
    await _require_ai_use(request, session_payload, current_settings)
    request_id = _request_id(request)
    try:
        result = extract_version_facts(
            db,
            deliverable_uuid=deliverable_uuid,
            version_uuid=version_uuid,
            content_hash=body.content_hash,
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
                action="professional_deliverable.facts.extract",
                entity_type="professional_deliverable",
                entity_uuid=result.artifact.uuid,
                metadata={
                    "event": "deliverable_facts_extracted",
                    "version_uuid": result.version.uuid,
                    "fact_count": len(result.facts),
                },
            )
        db.commit()
        return _fact_list_output(
            request_id=request_id,
            artifact=result.artifact,
            version=result.version,
            facts=result.facts,
            cipher=cipher,
        )
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@deliverable_fact_router.get(
    "/{deliverable_uuid}/versions/{version_uuid}/facts",
    response_model=FactListOut,
)
async def list_professional_deliverable_facts(
    deliverable_uuid: str,
    version_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
) -> FactListOut:
    await _require_ai_use(request, session_payload, current_settings)
    try:
        artifact, version, facts = list_version_facts(
            db,
            deliverable_uuid=deliverable_uuid,
            version_uuid=version_uuid,
            actor_user_id=str(session_payload.user.id),
        )
        return _fact_list_output(
            request_id=_request_id(request),
            artifact=artifact,
            version=version,
            facts=facts,
            cipher=cipher,
        )
    except ProfessionalDeliveryError as error:
        raise _http_error(error) from error


@fact_router.patch("/{fact_uuid}", response_model=FactMutationOut)
async def update_professional_deliverable_fact(
    fact_uuid: str,
    body: FactPatchIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> FactMutationOut:
    await _require_ai_use(request, session_payload, current_settings)
    try:
        result = update_fact(
            db,
            fact_uuid=fact_uuid,
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
                action="professional_deliverable.fact.update",
                entity_type="professional_deliverable_fact",
                entity_uuid=result.fact.uuid,
                metadata={
                    "event": "deliverable_fact_updated",
                    "version_uuid": result.version.uuid,
                    "status": result.fact.status,
                },
            )
        db.commit()
        return FactMutationOut(
            request_id=_request_id(request),
            fact=fact_payload(
                artifact=result.artifact,
                version=result.version,
                fact=result.fact,
                cipher=cipher,
            ),
        )
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@evidence_router.get("/search", response_model=EvidenceSearchOut)
async def search_professional_deliverable_evidence(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    deliverable_uuid: Annotated[str, Query(min_length=1)],
    version_uuid: Annotated[str, Query(min_length=1)],
    q: Annotated[str, Query(min_length=1, max_length=500)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> EvidenceSearchOut:
    await _require_ai_use(request, session_payload, current_settings)
    try:
        artifact, version, items = search_evidence_candidates(
            db,
            deliverable_uuid=deliverable_uuid,
            version_uuid=version_uuid,
            actor_user_id=str(session_payload.user.id),
            query=q,
            limit=limit,
            cipher=cipher,
        )
        return EvidenceSearchOut(
            request_id=_request_id(request),
            deliverable_uuid=artifact.uuid,
            version_uuid=version.uuid,
            items=items,
            total=len(items),
        )
    except ProfessionalDeliveryError as error:
        raise _http_error(error) from error


@fact_router.post(
    "/{fact_uuid}/evidence",
    response_model=FactEvidenceMutationOut,
    status_code=201,
)
async def attach_professional_deliverable_evidence(
    fact_uuid: str,
    body: EvidenceAttachIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> FactEvidenceMutationOut:
    await _require_ai_use(request, session_payload, current_settings)
    try:
        result = attach_evidence_to_fact(
            db,
            fact_uuid=fact_uuid,
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
                action="professional_deliverable.evidence.attach",
                entity_type="professional_deliverable_fact",
                entity_uuid=result.fact.uuid,
                metadata={
                    "event": "deliverable_evidence_attached",
                    "version_uuid": result.version.uuid,
                    "evidence_uuid": result.evidence.uuid,
                    "relation": result.link.relation,
                },
            )
        db.commit()
        return FactEvidenceMutationOut(
            request_id=_request_id(request),
            fact=fact_payload(
                artifact=result.artifact,
                version=result.version,
                fact=result.fact,
                cipher=cipher,
            ),
            evidence=evidence_payload(
                db,
                artifact=result.artifact,
                version=result.version,
                evidence=result.evidence,
                cipher=cipher,
            ),
            link=link_payload(
                result.link,
                fact=result.fact,
                evidence=result.evidence,
            ),
        )
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@evidence_router.post("/{evidence_uuid}/revoke", response_model=EvidenceRevokeOut)
async def revoke_professional_deliverable_evidence(
    evidence_uuid: str,
    body: EvidenceRevokeIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
    idempotency_key_header: Annotated[
        str | None,
        Header(alias="Idempotency-Key"),
    ] = None,
) -> EvidenceRevokeOut:
    await _require_ai_use(request, session_payload, current_settings)
    try:
        result = revoke_evidence(
            db,
            evidence_uuid=evidence_uuid,
            reason=body.reason,
            actor_user_id=str(session_payload.user.id),
            idempotency_key=_idempotency_key(idempotency_key_header),
        )
        if not result.replayed:
            write_request_audit(
                db,
                session_payload,
                request,
                current_settings,
                action="professional_deliverable.evidence.revoke",
                entity_type="professional_deliverable_evidence",
                entity_uuid=result.evidence.uuid,
                metadata={
                    "event": "deliverable_evidence_revoked",
                    "version_uuid": result.version.uuid,
                    "status": result.evidence.status,
                },
            )
        db.commit()
        return EvidenceRevokeOut(
            request_id=_request_id(request),
            deliverable_uuid=result.artifact.uuid,
            lifecycle_status=result.artifact.lifecycle_status,
            row_version=result.artifact.row_version,
            evidence=evidence_payload(
                db,
                artifact=result.artifact,
                version=result.version,
                evidence=result.evidence,
                cipher=cipher,
            ),
        )
    except ProfessionalDeliveryError as error:
        db.rollback()
        raise _http_error(error) from error
    except Exception:
        db.rollback()
        raise


@evidence_router.get("/{evidence_uuid}/preview", response_model=EvidencePreviewOut)
async def preview_professional_deliverable_evidence(
    evidence_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_deliverable_content_cipher)],
) -> EvidencePreviewOut:
    await _require_ai_use(request, session_payload, current_settings)
    try:
        artifact, version, evidence = get_evidence_preview(
            db,
            evidence_uuid=evidence_uuid,
            actor_user_id=str(session_payload.user.id),
        )
        return EvidencePreviewOut(
            request_id=_request_id(request),
            evidence=evidence_payload(
                db,
                artifact=artifact,
                version=version,
                evidence=evidence,
                cipher=cipher,
            ),
        )
    except ProfessionalDeliveryError as error:
        raise _http_error(error) from error
