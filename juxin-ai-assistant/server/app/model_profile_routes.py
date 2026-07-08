from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from .auth import get_session, require_action
from .config import Settings, get_settings
from .crypto import ContentCipher
from .database import get_db
from .schemas import (
    SessionPayload,
    UserModelProfileListOut,
    UserModelProfileOut,
    UserModelProfileUpsertIn,
)
from .user_model_profiles import (
    create_user_model_profile,
    delete_user_model_profile,
    list_user_model_profiles,
    set_default_user_model_profile,
    update_user_model_profile,
    user_model_profile_out,
)


router = APIRouter(prefix="/api/ai/model-profiles", tags=["model-profiles"])


def get_model_profile_cipher(
    current_settings: Annotated[Settings, Depends(get_settings)],
) -> ContentCipher:
    return ContentCipher(current_settings.content_encryption_key)


@router.get("", response_model=UserModelProfileListOut)
async def list_profiles(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> UserModelProfileListOut:
    await require_action("ai_assistant:use", request, session_payload, current_settings)
    items = [
        user_model_profile_out(profile)
        for profile in list_user_model_profiles(db, str(session_payload.user.id))
    ]
    return UserModelProfileListOut(items=items, total=len(items))


@router.post("", response_model=UserModelProfileOut, status_code=status.HTTP_201_CREATED)
async def create_profile(
    body: UserModelProfileUpsertIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_model_profile_cipher)],
) -> UserModelProfileOut:
    await require_action("ai_assistant:use", request, session_payload, current_settings)
    try:
        profile = create_user_model_profile(
            db,
            user_id=str(session_payload.user.id),
            body=body,
            cipher=cipher,
            settings=current_settings,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return user_model_profile_out(profile)


@router.put("/{profile_uuid}", response_model=UserModelProfileOut)
async def update_profile(
    profile_uuid: str,
    body: UserModelProfileUpsertIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_model_profile_cipher)],
) -> UserModelProfileOut:
    await require_action("ai_assistant:use", request, session_payload, current_settings)
    try:
        profile = update_user_model_profile(
            db,
            user_id=str(session_payload.user.id),
            profile_uuid=profile_uuid,
            body=body,
            cipher=cipher,
            settings=current_settings,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return user_model_profile_out(profile)


@router.post("/{profile_uuid}/default", response_model=UserModelProfileOut)
async def set_default_profile(
    profile_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> UserModelProfileOut:
    await require_action("ai_assistant:use", request, session_payload, current_settings)
    try:
        profile = set_default_user_model_profile(
            db,
            user_id=str(session_payload.user.id),
            profile_uuid=profile_uuid,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return user_model_profile_out(profile)


@router.delete("/{profile_uuid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_profile(
    profile_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    await require_action("ai_assistant:use", request, session_payload, current_settings)
    try:
        delete_user_model_profile(db, user_id=str(session_payload.user.id), profile_uuid=profile_uuid)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return Response(status_code=status.HTTP_204_NO_CONTENT)
