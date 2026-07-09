from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from .auth import get_session, require_action
from .config import Settings, get_settings
from .crypto import ContentCipher
from .database import get_db
from .schemas import (
    SaveChatMessageArtifactIn,
    SessionPayload,
    WorkArtifactDetailOut,
    WorkArtifactItemOut,
    WorkArtifactListOut,
)
from .work_artifacts import (
    create_chat_message_artifact,
    delete_work_artifact,
    get_work_artifact_detail,
    list_work_artifacts,
    work_artifact_payload,
)


router = APIRouter(prefix="/api/ai/work-artifacts", tags=["work-artifacts"])


def get_artifact_content_cipher(
    current_settings: Annotated[Settings, Depends(get_settings)],
) -> ContentCipher:
    return ContentCipher(current_settings.content_encryption_key)


@router.get("", response_model=WorkArtifactListOut)
async def work_artifacts(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    artifact_type: str | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 100,
) -> WorkArtifactListOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    items, total = list_work_artifacts(
        db,
        owner_user_id=str(session_payload.user.id),
        artifact_type=artifact_type,
        page=page,
        page_size=page_size,
    )
    return WorkArtifactListOut(
        items=[WorkArtifactItemOut(**work_artifact_payload(item)) for item in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/chat-message", response_model=WorkArtifactItemOut, status_code=201)
async def save_chat_message_artifact(
    body: SaveChatMessageArtifactIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> WorkArtifactItemOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    try:
        artifact = create_chat_message_artifact(
            db,
            owner_user_id=str(session_payload.user.id),
            conversation_id=body.conversation_id,
            message_id=body.message_id,
            title=body.title,
        )
        db.commit()
        return WorkArtifactItemOut(**work_artifact_payload(artifact))
    except Exception:
        db.rollback()
        raise


@router.get("/{artifact_uuid}", response_model=WorkArtifactDetailOut)
async def work_artifact_detail(
    artifact_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_artifact_content_cipher)],
) -> WorkArtifactDetailOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    return WorkArtifactDetailOut(**get_work_artifact_detail(
        db,
        owner_user_id=str(session_payload.user.id),
        artifact_uuid=artifact_uuid,
        cipher=cipher,
    ))


@router.delete("/{artifact_uuid}", status_code=204)
async def remove_work_artifact(
    artifact_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> None:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    try:
        delete_work_artifact(
            db,
            owner_user_id=str(session_payload.user.id),
            artifact_uuid=artifact_uuid,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
