from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from .auth import get_session, require_action
from .config import Settings, get_settings
from .crypto import ContentCipher
from .database import get_db
from .knowledge_embedding import build_embedding_service
from .personal_reference_service import (
    prepare_personal_reference_generation,
    search_personal_reference_sources,
)
from .schemas import (
    PersonalReferenceGenerateIn,
    PersonalReferenceGenerateOut,
    PersonalReferenceSearchIn,
    PersonalReferenceSearchOut,
    SessionPayload,
)


router = APIRouter(prefix="/api/personal-reference", tags=["personal-reference"])


def get_personal_reference_cipher(
    current_settings: Annotated[Settings, Depends(get_settings)],
) -> ContentCipher:
    return ContentCipher(current_settings.content_encryption_key)


@router.post("/search", response_model=PersonalReferenceSearchOut)
async def search_personal_reference(
    body: PersonalReferenceSearchIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_personal_reference_cipher)],
) -> PersonalReferenceSearchOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    try:
        result = search_personal_reference_sources(
            db,
            sso_user_id=str(session_payload.user.id),
            body=body,
            cipher=cipher,
            embedding_service=build_embedding_service(db, current_settings),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return result


@router.post("/generate", response_model=PersonalReferenceGenerateOut, status_code=201)
async def generate_from_personal_reference(
    body: PersonalReferenceGenerateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_personal_reference_cipher)],
) -> PersonalReferenceGenerateOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    try:
        prepared = prepare_personal_reference_generation(
            db,
            sso_user_id=str(session_payload.user.id),
            body=body,
            cipher=cipher,
            embedding_service=build_embedding_service(db, current_settings),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return prepared
