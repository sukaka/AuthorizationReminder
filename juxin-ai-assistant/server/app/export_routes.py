from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import get_session, require_action
from .chat_word_export import DocxExportService
from .config import Settings, get_settings
from .crypto import ContentCipher
from .database import get_db
from .export_file_manager import (
    DOCX_MEDIA_TYPE,
    ExportFileManager,
    content_disposition_for_download,
)
from .models import ExportRecord
from .schemas import ExportContentWordIn, ExportWordIn, ExportWordOut, SessionPayload


router = APIRouter(prefix="/api/export", tags=["export"])


def get_export_content_cipher(
    current_settings: Annotated[Settings, Depends(get_settings)],
) -> ContentCipher:
    return ContentCipher(current_settings.content_encryption_key)


@router.post("/word", response_model=ExportWordOut, status_code=201)
async def export_word(
    body: ExportWordIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    cipher: Annotated[ContentCipher, Depends(get_export_content_cipher)],
) -> ExportWordOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    service = DocxExportService(
        file_manager=ExportFileManager(current_settings.export_storage_dir),
    )
    try:
        result = service.export_word(
            db,
            body=body,
            sso_user_id=str(session_payload.user.id),
            username=session_payload.user.username,
            department=session_payload.scope.department or "待确认",
            cipher=cipher,
        )
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


@router.post("/word/content", response_model=ExportWordOut, status_code=201)
async def export_content_word(
    body: ExportContentWordIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ExportWordOut:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    service = DocxExportService(
        file_manager=ExportFileManager(current_settings.export_storage_dir),
    )
    try:
        result = service.export_content_word(
            db,
            body=body,
            sso_user_id=str(session_payload.user.id),
            username=session_payload.user.username,
            department=session_payload.scope.department or "待确认",
        )
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


@router.get("/download/{file_id}")
async def download_word(
    file_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    await require_action(
        "ai_assistant:use",
        request,
        session_payload,
        current_settings,
    )
    record = db.scalar(
        select(ExportRecord).where(
            ExportRecord.uuid == file_id,
            ExportRecord.created_by == str(session_payload.user.id),
        )
    )
    if record is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="导出文件不存在")
    content = ExportFileManager(current_settings.export_storage_dir).read_docx(record.file_path)
    return Response(
        content=content,
        media_type=DOCX_MEDIA_TYPE,
        headers={
            "Content-Disposition": content_disposition_for_download(record.file_name),
        },
    )
