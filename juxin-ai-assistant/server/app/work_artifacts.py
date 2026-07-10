from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from .crypto import ContentCipher, EncryptedPayload
from .models import (
    ChatMessage,
    ChatMessageSource,
    ChatSession,
    ExportRecord,
    WorkArtifact,
    WorkArtifactVersion,
)


def source_summary_for_messages(db: Session, message_ids: list[int]) -> list[dict[str, object]]:
    if not message_ids:
        return []
    sources = db.scalars(
        select(ChatMessageSource)
        .where(ChatMessageSource.message_id.in_(message_ids))
        .order_by(ChatMessageSource.id.asc())
    )
    seen: set[tuple[str, str, int | None, str]] = set()
    summary: list[dict[str, object]] = []
    for source in sources:
        key = (source.source_type, source.file_name, source.page_number, source.section_title)
        if key in seen:
            continue
        seen.add(key)
        summary.append({
            "source_type": source.source_type,
            "file_name": source.file_name,
            "page_number": source.page_number,
            "section_title": source.section_title,
        })
    return summary


def create_word_export_artifact(
    db: Session,
    *,
    owner_user_id: str,
    conversation_id: str,
    message_id: str,
    title: str,
    export_record: ExportRecord,
    source_summary: list[dict[str, object]],
) -> WorkArtifact:
    artifact = db.scalar(
        select(WorkArtifact).where(
            WorkArtifact.owner_user_id == owner_user_id,
            WorkArtifact.conversation_id == conversation_id,
            WorkArtifact.message_id == message_id,
            WorkArtifact.artifact_type == "word_document",
            WorkArtifact.status != "deleted",
        )
    )
    if artifact is None:
        artifact = WorkArtifact(
            owner_user_id=owner_user_id,
            conversation_id=conversation_id,
            message_id=message_id,
            title=_safe_title(title, "Word 文档"),
            artifact_type="word_document",
            source_scope="chat",
            version=1,
            status="active",
        )
        db.add(artifact)
    else:
        artifact.version += 1
    artifact.export_record_uuid = export_record.uuid
    artifact.source_summary_json = source_summary
    artifact.content_summary = "Word 文档已生成，可下载或基于原会话继续整理。"
    artifact.file_name = export_record.file_name
    artifact.file_path_or_blob_ref = export_record.file_path
    db.flush()
    db.add(WorkArtifactVersion(
        artifact_id=artifact.id,
        version=artifact.version,
        source="word_export",
        source_ref=export_record.uuid,
        file_name=export_record.file_name,
        file_path_or_blob_ref=export_record.file_path,
        source_summary_json=source_summary,
        content_summary=artifact.content_summary,
        status="active",
    ))
    db.flush()
    return artifact


def create_chat_message_artifact(
    db: Session,
    *,
    owner_user_id: str,
    conversation_id: str,
    message_id: str,
    title: str,
) -> WorkArtifact:
    message = _get_owned_assistant_message(db, owner_user_id, conversation_id, message_id)
    source_summary = source_summary_for_messages(db, [message.id])
    artifact = WorkArtifact(
        owner_user_id=owner_user_id,
        conversation_id=conversation_id,
        message_id=message.uuid,
        title=_safe_title(title, "聊天回答"),
        artifact_type="ordinary_answer",
        source_scope="chat",
        source_summary_json=source_summary,
        content_summary=f"聊天回答已保存，包含 {len(source_summary)} 个引用来源。",
        version=1,
        status="active",
    )
    db.add(artifact)
    db.flush()
    db.add(WorkArtifactVersion(
        artifact_id=artifact.id,
        version=1,
        source="chat_message",
        source_ref=message.uuid,
        source_summary_json=source_summary,
        content_summary=artifact.content_summary,
        status="active",
    ))
    db.flush()
    return artifact


def list_work_artifacts(
    db: Session,
    *,
    owner_user_id: str,
    page: int,
    page_size: int,
    artifact_type: str | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
) -> tuple[list[WorkArtifact], int]:
    statement = select(WorkArtifact).where(
        WorkArtifact.owner_user_id == owner_user_id,
        WorkArtifact.status != "deleted",
    )
    count_statement = select(func.count(WorkArtifact.id)).where(
        WorkArtifact.owner_user_id == owner_user_id,
        WorkArtifact.status != "deleted",
    )
    if artifact_type:
        statement = statement.where(WorkArtifact.artifact_type == artifact_type)
        count_statement = count_statement.where(WorkArtifact.artifact_type == artifact_type)
    if created_from:
        statement = statement.where(WorkArtifact.created_at >= created_from)
        count_statement = count_statement.where(WorkArtifact.created_at >= created_from)
    if created_to:
        statement = statement.where(WorkArtifact.created_at <= created_to)
        count_statement = count_statement.where(WorkArtifact.created_at <= created_to)
    total = db.scalar(count_statement) or 0
    items = list(db.scalars(
        statement
        .order_by(WorkArtifact.updated_at.desc(), WorkArtifact.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ))
    return items, total


def get_work_artifact_detail(
    db: Session,
    *,
    owner_user_id: str,
    artifact_uuid: str,
    cipher: ContentCipher,
) -> dict[str, object]:
    artifact = get_owned_work_artifact(db, owner_user_id, artifact_uuid)
    versions = list(db.scalars(
        select(WorkArtifactVersion)
        .where(WorkArtifactVersion.artifact_id == artifact.id)
        .order_by(WorkArtifactVersion.version.desc(), WorkArtifactVersion.id.desc())
    ))
    content = None
    if artifact.artifact_type == "ordinary_answer" and artifact.message_id:
        message = _get_owned_assistant_message(
            db,
            owner_user_id,
            artifact.conversation_id,
            artifact.message_id,
        )
        content = _decrypt_message_content(cipher, message)
    payload = work_artifact_payload(artifact)
    payload.update({
        "content": content,
        "download_url": (
            f"/api/export/download/{artifact.export_record_uuid}"
            if artifact.export_record_uuid else None
        ),
        "versions": [work_artifact_version_payload(version) for version in versions],
    })
    return payload


def delete_work_artifact(db: Session, *, owner_user_id: str, artifact_uuid: str) -> None:
    artifact = get_owned_work_artifact(db, owner_user_id, artifact_uuid, lock=True)
    artifact.status = "deleted"
    db.flush()


def get_owned_work_artifact(
    db: Session,
    owner_user_id: str,
    artifact_uuid: str,
    *,
    lock: bool = False,
) -> WorkArtifact:
    statement: Select = select(WorkArtifact).where(
        WorkArtifact.uuid == artifact_uuid,
        WorkArtifact.owner_user_id == owner_user_id,
        WorkArtifact.status != "deleted",
    )
    if lock:
        statement = statement.with_for_update()
    artifact = db.scalar(statement)
    if artifact is None:
        raise HTTPException(status_code=404, detail="工作成果不存在")
    return artifact


def work_artifact_payload(artifact: WorkArtifact) -> dict[str, object]:
    return {
        "artifact_uuid": artifact.uuid,
        "conversation_id": artifact.conversation_id,
        "message_id": artifact.message_id,
        "title": artifact.title,
        "artifact_type": artifact.artifact_type,
        "source_scope": artifact.source_scope,
        "source_summary": artifact.source_summary_json or [],
        "content_summary": artifact.content_summary,
        "file_name": artifact.file_name,
        "version": artifact.version,
        "status": artifact.status,
        "created_at": artifact.created_at,
        "updated_at": artifact.updated_at,
    }


def work_artifact_version_payload(version: WorkArtifactVersion) -> dict[str, object]:
    return {
        "version_uuid": version.uuid,
        "version": version.version,
        "source": version.source,
        "source_ref": version.source_ref,
        "file_name": version.file_name,
        "source_summary": version.source_summary_json or [],
        "content_summary": version.content_summary,
        "created_at": version.created_at,
    }


def _get_owned_assistant_message(
    db: Session,
    owner_user_id: str,
    conversation_id: str,
    message_id: str,
) -> ChatMessage:
    row = db.execute(
        select(ChatMessage, ChatSession)
        .join(ChatSession, ChatSession.id == ChatMessage.session_id)
        .where(
            ChatSession.uuid == conversation_id,
            ChatSession.sso_user_id == owner_user_id,
            ChatSession.status.in_(["active", "archived"]),
            ChatMessage.uuid == message_id,
            ChatMessage.sso_user_id == owner_user_id,
            ChatMessage.role == "assistant",
            ChatMessage.status == "COMPLETED",
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="可保存的聊天回答不存在")
    message, _session = row
    return message


def _decrypt_message_content(cipher: ContentCipher, message: ChatMessage) -> str:
    if message.content_ciphertext is None or message.content_nonce is None:
        return ""
    payload = cipher.decrypt_json(
        EncryptedPayload(
            ciphertext=message.content_ciphertext,
            nonce=message.content_nonce,
        ),
        message.uuid.encode(),
    )
    return str(payload.get("content", ""))


def _safe_title(value: str, fallback: str) -> str:
    title = (value or "").strip()
    return title[:80] or fallback
