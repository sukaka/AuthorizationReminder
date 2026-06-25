import hashlib
import uuid as uuid_lib

from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from .crypto import ContentCipher
from .models import GenerationAttachment, Task


MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
SUPPORTED_TEXT_SUFFIXES = {".txt", ".md"}
UNSUPPORTED_TYPE_MESSAGE = "当前仅支持 txt、md、docx、pdf 文件"


def _safe_file_name(raw_name: str | None) -> str:
    file_name = (raw_name or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    if not file_name:
        raise HTTPException(status_code=422, detail="文件名不能为空")
    return file_name


def _file_suffix(file_name: str) -> str:
    dot_index = file_name.rfind(".")
    return file_name[dot_index:].lower() if dot_index >= 0 else ""


async def create_attachment(
    db: Session,
    sso_user_id: str,
    task_uuid: str,
    file: UploadFile,
    cipher: ContentCipher,
    key_version: str,
) -> tuple[GenerationAttachment, int]:
    task = db.scalar(
        select(Task).where(Task.uuid == task_uuid, Task.status == "ACTIVE")
    )
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在或未启用")

    file_name = _safe_file_name(file.filename)
    suffix = _file_suffix(file_name)
    if suffix not in SUPPORTED_TEXT_SUFFIXES:
        raise HTTPException(status_code=415, detail=UNSUPPORTED_TYPE_MESSAGE)

    content = await file.read()
    if len(content) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=413, detail="附件大小不能超过 20 MB")

    try:
        extracted_text = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=422, detail="文本附件必须使用 UTF-8 编码") from exc

    attachment_uuid = str(uuid_lib.uuid4())
    encrypted = cipher.encrypt_json(
        {"text": extracted_text},
        attachment_uuid.encode(),
    )
    attachment = GenerationAttachment(
        uuid=attachment_uuid,
        sso_user_id=sso_user_id,
        task_id=task.id,
        file_name=file_name,
        file_type=suffix.lstrip("."),
        file_size=len(content),
        content_sha256=hashlib.sha256(content).hexdigest(),
        extracted_text_ciphertext=encrypted.ciphertext,
        extracted_text_nonce=encrypted.nonce,
        key_version=key_version,
        status="READY",
        error_code="",
    )
    db.add(attachment)
    db.commit()
    db.refresh(attachment)
    return attachment, len(extracted_text)
