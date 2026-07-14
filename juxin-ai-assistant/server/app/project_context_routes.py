from __future__ import annotations

import uuid as uuid_lib
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from .admin.route_common import write_request_audit
from .auth import get_session, require_action
from .config import Settings, get_settings
from .crypto import ContentCipher, EncryptedPayload
from .database import get_db
from .models import (
    ChatMessage,
    ChatMessageSource,
    ChatSession,
    KnowledgeBase,
    KnowledgeFile,
    WorkArtifact,
)
from .project_access import require_project_access, require_project_manager
from .project_context_models import ProjectArtifact, ProjectFile, ProjectMemory
from .schemas import SessionPayload


router = APIRouter(prefix="/api/ai/projects", tags=["project-context"])


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProjectMemoryCreateIn(StrictModel):
    memory_type: str = Field(min_length=1, max_length=48)
    title: str = Field(min_length=1, max_length=160)
    content: str = Field(min_length=1, max_length=20000)
    priority: int = Field(default=0, ge=0, le=100)
    tags: list[str] = Field(default_factory=list, max_length=30)
    source: Literal["human", "ai_suggestion", "conversation_migration"] = "human"

    @field_validator("memory_type", "title", "content", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ProjectMemoryConfirmIn(StrictModel):
    change_summary: str = Field(default="", max_length=2000)


class ProjectMemoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    memory_uuid: str
    memory_type: str
    title: str
    content: str
    priority: int
    tags: list[str]
    status: str
    source: str
    confirmation_status: str
    created_by: str
    confirmed_by: str | None
    confirmed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ProjectFileOut(BaseModel):
    file_uuid: str
    project_file_uuid: str
    file_name: str
    file_type: str
    category: str
    summary: str
    status: str
    linked_by: str
    created_at: datetime


class ProjectArtifactOut(BaseModel):
    artifact_uuid: str
    project_artifact_uuid: str
    title: str
    artifact_type: str
    content_summary: str
    file_name: str
    status: str
    linked_by: str
    created_at: datetime


class SessionMemoryDraft(StrictModel):
    memory_type: str = Field(min_length=1, max_length=48)
    title: str = Field(min_length=1, max_length=160)
    content: str = Field(min_length=1, max_length=20000)
    priority: int = Field(default=0, ge=0, le=100)
    tags: list[str] = Field(default_factory=list, max_length=30)


class SessionMoveIn(StrictModel):
    move_attachments: bool = False
    move_artifacts: bool = False
    extract_project_memory: bool = False
    keep_personal_copy: bool = False
    memory_drafts: list[SessionMemoryDraft] = Field(default_factory=list, max_length=20)


class SessionMoveOut(BaseModel):
    session_uuid: str
    project_uuid: str
    kept_personal_copy: bool
    moved_attachment_count: int
    moved_artifact_count: int
    extracted_memory_count: int


class PersonalArtifactCopyIn(StrictModel):
    sanitized_title: str = Field(min_length=1, max_length=255)
    sanitized_content_summary: str = Field(min_length=1, max_length=20000)


class PersonalArtifactCopyOut(BaseModel):
    artifact_id: int
    artifact_uuid: str
    sanitized: bool


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


def _project_member(
    db: Session,
    project_uuid: str,
    session_payload: SessionPayload,
):
    return require_project_access(db, project_uuid, str(session_payload.user.id))


def _memory_out(row: ProjectMemory) -> ProjectMemoryOut:
    return ProjectMemoryOut(
        memory_uuid=row.uuid,
        memory_type=row.memory_type,
        title=row.title,
        content=row.content,
        priority=row.priority,
        tags=list(row.tags_json or []),
        status=row.status,
        source=row.source,
        confirmation_status=row.confirmation_status,
        created_by=row.created_by,
        confirmed_by=row.confirmed_by,
        confirmed_at=row.confirmed_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _audit(
    db: Session,
    session_payload: SessionPayload,
    request: Request,
    current_settings: Settings,
    *,
    action: str,
    entity_uuid: str,
    project_uuid: str,
    metadata: dict | None = None,
) -> None:
    write_request_audit(
        db,
        session_payload,
        request,
        current_settings,
        action=action,
        entity_type="project",
        entity_uuid=project_uuid,
        metadata={"resource_uuid": entity_uuid, **(metadata or {})},
    )


@router.get("/{project_uuid}/memories", response_model=list[ProjectMemoryOut])
async def list_project_memories(
    project_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ProjectMemoryOut]:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _project_member(db, project_uuid, session_payload)
    rows = db.scalars(
        select(ProjectMemory)
        .where(ProjectMemory.project_id == project.id, ProjectMemory.status == "active")
        .order_by(ProjectMemory.priority.desc(), ProjectMemory.created_at.desc())
    ).all()
    return [_memory_out(row) for row in rows]


@router.post("/{project_uuid}/memories", response_model=ProjectMemoryOut, status_code=201)
async def create_project_memory(
    project_uuid: str,
    body: ProjectMemoryCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ProjectMemoryOut:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _project_member(db, project_uuid, session_payload)
    confirmation_status = "pending_confirmation" if body.source != "human" else "active"
    row = ProjectMemory(
        project_id=project.id,
        memory_type=body.memory_type,
        title=body.title,
        content=body.content,
        priority=body.priority,
        tags_json=body.tags,
        source=body.source,
        confirmation_status=confirmation_status,
        created_by=str(session_payload.user.id),
    )
    db.add(row)
    db.flush()
    _audit(
        db,
        session_payload,
        request,
        current_settings,
        action="project.memory.create",
        entity_uuid=row.uuid,
        project_uuid=project.uuid,
        metadata={"confirmation_status": confirmation_status},
    )
    db.commit()
    db.refresh(row)
    return _memory_out(row)


@router.post(
    "/{project_uuid}/memories/{memory_uuid}/confirm",
    response_model=ProjectMemoryOut,
)
async def confirm_project_memory(
    project_uuid: str,
    memory_uuid: str,
    body: ProjectMemoryConfirmIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ProjectMemoryOut:
    await _require_ai_use(request, session_payload, current_settings)
    project, member = _project_member(db, project_uuid, session_payload)
    require_project_manager(member)
    row = db.scalar(
        select(ProjectMemory).where(
            ProjectMemory.uuid == memory_uuid,
            ProjectMemory.project_id == project.id,
            ProjectMemory.status == "active",
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="项目记忆不存在")
    row.confirmation_status = "active"
    row.confirmed_by = str(session_payload.user.id)
    row.confirmed_at = datetime.now(UTC).replace(tzinfo=None)
    _audit(
        db,
        session_payload,
        request,
        current_settings,
        action="project.memory.confirm",
        entity_uuid=row.uuid,
        project_uuid=project.uuid,
        metadata={"change_summary": body.change_summary},
    )
    db.commit()
    db.refresh(row)
    return _memory_out(row)


@router.get("/{project_uuid}/files", response_model=list[ProjectFileOut])
async def list_project_files(
    project_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ProjectFileOut]:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _project_member(db, project_uuid, session_payload)
    rows = db.execute(
        select(ProjectFile, KnowledgeFile)
        .join(KnowledgeFile, KnowledgeFile.id == ProjectFile.knowledge_file_id)
        .where(ProjectFile.project_id == project.id, ProjectFile.status == "active")
        .order_by(ProjectFile.created_at.desc())
    ).all()
    return [
        ProjectFileOut(
            file_uuid=file.uuid,
            project_file_uuid=link.uuid,
            file_name=file.file_name,
            file_type=file.file_type,
            category=link.category or file.category,
            summary=file.summary,
            status=file.status,
            linked_by=link.linked_by,
            created_at=link.created_at,
        )
        for link, file in rows
    ]


@router.post("/{project_uuid}/files/{file_uuid}", response_model=ProjectFileOut, status_code=201)
async def link_project_file(
    project_uuid: str,
    file_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ProjectFileOut:
    await _require_ai_use(request, session_payload, current_settings)
    project, member = _project_member(db, project_uuid, session_payload)
    require_project_manager(member)
    file = db.scalar(select(KnowledgeFile).where(KnowledgeFile.uuid == file_uuid))
    if file is None or file.status == "DELETED":
        raise HTTPException(status_code=404, detail="知识文件不存在")
    base = db.get(KnowledgeBase, file.knowledge_base_id) if file.knowledge_base_id else None
    if base and base.scope == "project" and base.project_id != project.uuid:
        raise HTTPException(status_code=403, detail="不能跨项目关联知识文件")
    if file.owner_user_id != str(session_payload.user.id) and not (
        file.review_status == "approved" and file.permission_scope in {"company", "department"}
    ):
        raise HTTPException(status_code=403, detail="无权关联该知识文件")
    existing = db.scalar(
        select(ProjectFile).where(ProjectFile.knowledge_file_id == file.id)
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="知识文件已关联到项目")
    link = ProjectFile(
        project_id=project.id,
        knowledge_file_id=file.id,
        category=file.category or "项目资料",
        linked_by=str(session_payload.user.id),
    )
    db.add(link)
    db.flush()
    _audit(
        db,
        session_payload,
        request,
        current_settings,
        action="project.file.link",
        entity_uuid=file.uuid,
        project_uuid=project.uuid,
    )
    db.commit()
    db.refresh(link)
    return ProjectFileOut(
        file_uuid=file.uuid,
        project_file_uuid=link.uuid,
        file_name=file.file_name,
        file_type=file.file_type,
        category=link.category,
        summary=file.summary,
        status=file.status,
        linked_by=link.linked_by,
        created_at=link.created_at,
    )


@router.get("/{project_uuid}/artifacts", response_model=list[ProjectArtifactOut])
async def list_project_artifacts(
    project_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> list[ProjectArtifactOut]:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _project_member(db, project_uuid, session_payload)
    rows = db.execute(
        select(ProjectArtifact, WorkArtifact)
        .join(WorkArtifact, WorkArtifact.id == ProjectArtifact.artifact_id)
        .where(ProjectArtifact.project_id == project.id, ProjectArtifact.status == "active")
        .order_by(ProjectArtifact.created_at.desc())
    ).all()
    return [
        ProjectArtifactOut(
            artifact_uuid=artifact.uuid,
            project_artifact_uuid=link.uuid,
            title=artifact.title,
            artifact_type=artifact.artifact_type,
            content_summary=artifact.content_summary,
            file_name=artifact.file_name,
            status=artifact.status,
            linked_by=link.linked_by,
            created_at=link.created_at,
        )
        for link, artifact in rows
    ]


@router.post("/{project_uuid}/artifacts/{artifact_uuid}", response_model=ProjectArtifactOut, status_code=201)
async def link_project_artifact(
    project_uuid: str,
    artifact_uuid: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> ProjectArtifactOut:
    await _require_ai_use(request, session_payload, current_settings)
    project, member = _project_member(db, project_uuid, session_payload)
    require_project_manager(member)
    artifact = db.scalar(select(WorkArtifact).where(WorkArtifact.uuid == artifact_uuid))
    if artifact is None or artifact.status != "active":
        raise HTTPException(status_code=404, detail="项目成果不存在")
    if artifact.owner_user_id != str(session_payload.user.id):
        raise HTTPException(status_code=403, detail="无权关联该项目成果")
    existing = db.scalar(select(ProjectArtifact).where(ProjectArtifact.artifact_id == artifact.id))
    if existing is not None:
        raise HTTPException(status_code=409, detail="项目成果已关联到项目")
    link = ProjectArtifact(
        project_id=project.id,
        artifact_id=artifact.id,
        linked_by=str(session_payload.user.id),
    )
    db.add(link)
    db.flush()
    _audit(
        db,
        session_payload,
        request,
        current_settings,
        action="project.artifact.link",
        entity_uuid=artifact.uuid,
        project_uuid=project.uuid,
    )
    db.commit()
    db.refresh(link)
    return ProjectArtifactOut(
        artifact_uuid=artifact.uuid,
        project_artifact_uuid=link.uuid,
        title=artifact.title,
        artifact_type=artifact.artifact_type,
        content_summary=artifact.content_summary,
        file_name=artifact.file_name,
        status=artifact.status,
        linked_by=link.linked_by,
        created_at=link.created_at,
    )


def _clone_chat_session(
    db: Session,
    source: ChatSession,
    project_uuid: str,
    cipher: ContentCipher,
) -> ChatSession:
    clone = ChatSession(
        sso_user_id=source.sso_user_id,
        workspace_type="project",
        project_uuid=project_uuid,
        title=f"{source.title}（项目副本）",
        mode=source.mode,
        status=source.status,
    )
    db.add(clone)
    db.flush()
    messages = db.scalars(
        select(ChatMessage).where(ChatMessage.session_id == source.id).order_by(ChatMessage.id)
    ).all()
    message_map: dict[int, ChatMessage] = {}
    for message in messages:
        new_uuid = str(uuid_lib.uuid4())
        ciphertext = message.content_ciphertext
        nonce = message.content_nonce
        if ciphertext is not None and nonce is not None:
            payload = cipher.decrypt_json(
                EncryptedPayload(ciphertext=ciphertext, nonce=nonce),
                message.uuid.encode(),
            )
            encrypted = cipher.encrypt_json(payload, new_uuid.encode())
            ciphertext = encrypted.ciphertext
            nonce = encrypted.nonce
        copied = ChatMessage(
            uuid=new_uuid,
            session_id=clone.id,
            sso_user_id=message.sso_user_id,
            role=message.role,
            content_ciphertext=ciphertext,
            content_nonce=nonce,
            key_version=message.key_version,
            status=message.status,
            model_display_name=message.model_display_name,
            model_id=message.model_id,
            usage_json=message.usage_json,
            latency_ms=message.latency_ms,
            completion_token_hash=message.completion_token_hash,
            error_code=message.error_code,
            error_message_safe=message.error_message_safe,
            finished_at=message.finished_at,
        )
        db.add(copied)
        db.flush()
        message_map[message.id] = copied
    for source_row in db.scalars(
        select(ChatMessageSource).where(
            ChatMessageSource.message_id.in_(message_map.keys())
        )
    ).all():
        copied_message = message_map[source_row.message_id]
        db.add(
            ChatMessageSource(
                message_id=copied_message.id,
                source_type=source_row.source_type,
                source_uuid=source_row.source_uuid,
                title=source_row.title,
                file_name=source_row.file_name,
                chunk_id=source_row.chunk_id,
                page_number=source_row.page_number,
                section_title=source_row.section_title,
                chunk_index=source_row.chunk_index,
                score=source_row.score,
            )
        )
    return clone


@router.post("/{project_uuid}/sessions/{session_uuid}/move", response_model=SessionMoveOut)
async def move_personal_session(
    project_uuid: str,
    session_uuid: str,
    body: SessionMoveIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> SessionMoveOut:
    await _require_ai_use(request, session_payload, current_settings)
    project, member = _project_member(db, project_uuid, session_payload)
    require_project_manager(member)
    user_id = str(session_payload.user.id)
    source_session = db.scalar(
        select(ChatSession).where(
            ChatSession.uuid == session_uuid,
            ChatSession.sso_user_id == user_id,
            ChatSession.deleted_at.is_(None),
        )
    )
    if source_session is None:
        raise HTTPException(status_code=404, detail="个人会话不存在")
    if source_session.workspace_type != "personal" or source_session.project_uuid is not None:
        raise HTTPException(status_code=409, detail="仅支持迁移个人会话")

    target_session = source_session
    if body.keep_personal_copy:
        target_session = _clone_chat_session(
            db,
            source_session,
            project.uuid,
            ContentCipher(current_settings.content_encryption_key),
        )
    else:
        source_session.workspace_type = "project"
        source_session.project_uuid = project.uuid

    moved_attachment_count = 0
    if body.move_attachments:
        files = db.scalars(
            select(KnowledgeFile).where(
                KnowledgeFile.conversation_id == source_session.uuid,
                KnowledgeFile.owner_user_id == user_id,
            )
        ).all()
        for file in files:
            if db.scalar(select(ProjectFile).where(ProjectFile.knowledge_file_id == file.id)):
                continue
            db.add(
                ProjectFile(
                    project_id=project.id,
                    knowledge_file_id=file.id,
                    category=file.category or "项目资料",
                    linked_by=user_id,
                )
            )
            moved_attachment_count += 1

    moved_artifact_count = 0
    if body.move_artifacts:
        artifacts = db.scalars(
            select(WorkArtifact).where(
                WorkArtifact.conversation_id == source_session.uuid,
                WorkArtifact.owner_user_id == user_id,
                WorkArtifact.status == "active",
            )
        ).all()
        for artifact in artifacts:
            if db.scalar(select(ProjectArtifact).where(ProjectArtifact.artifact_id == artifact.id)):
                continue
            db.add(
                ProjectArtifact(
                    project_id=project.id,
                    artifact_id=artifact.id,
                    linked_by=user_id,
                )
            )
            moved_artifact_count += 1

    extracted_memory_count = 0
    if body.extract_project_memory:
        for draft in body.memory_drafts:
            db.add(
                ProjectMemory(
                    project_id=project.id,
                    memory_type=draft.memory_type,
                    title=draft.title,
                    content=draft.content,
                    priority=draft.priority,
                    tags_json=draft.tags,
                    source="conversation_migration",
                    confirmation_status="pending_confirmation",
                    created_by=user_id,
                )
            )
            extracted_memory_count += 1

    db.flush()
    _audit(
        db,
        session_payload,
        request,
        current_settings,
        action="project.session.move",
        entity_uuid=target_session.uuid,
        project_uuid=project.uuid,
        metadata={
            "source_session_uuid": source_session.uuid,
            "keep_personal_copy": body.keep_personal_copy,
            "moved_attachment_count": moved_attachment_count,
            "moved_artifact_count": moved_artifact_count,
            "extracted_memory_count": extracted_memory_count,
        },
    )
    db.commit()
    return SessionMoveOut(
        session_uuid=target_session.uuid,
        project_uuid=project.uuid,
        kept_personal_copy=body.keep_personal_copy,
        moved_attachment_count=moved_attachment_count,
        moved_artifact_count=moved_artifact_count,
        extracted_memory_count=extracted_memory_count,
    )


@router.post(
    "/{project_uuid}/artifacts/{artifact_uuid}/copy-to-personal",
    response_model=PersonalArtifactCopyOut,
    status_code=201,
)
async def copy_project_artifact_to_personal(
    project_uuid: str,
    artifact_uuid: str,
    body: PersonalArtifactCopyIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> PersonalArtifactCopyOut:
    await _require_ai_use(request, session_payload, current_settings)
    project, _member = _project_member(db, project_uuid, session_payload)
    artifact = db.scalar(select(WorkArtifact).where(WorkArtifact.uuid == artifact_uuid))
    if artifact is None or artifact.owner_user_id != str(session_payload.user.id):
        raise HTTPException(status_code=404, detail="项目成果不存在")
    link = db.scalar(
        select(ProjectArtifact).where(
            ProjectArtifact.project_id == project.id,
            ProjectArtifact.artifact_id == artifact.id,
            ProjectArtifact.status == "active",
        )
    )
    if link is None:
        raise HTTPException(status_code=404, detail="项目成果不存在")
    copied = WorkArtifact(
        owner_user_id=str(session_payload.user.id),
        conversation_id="",
        message_id="",
        title=body.sanitized_title,
        artifact_type=artifact.artifact_type,
        source_scope="project_copy_sanitized",
        source_summary_json=[],
        content_summary=body.sanitized_content_summary,
        file_name="",
        file_path_or_blob_ref="",
        status="active",
    )
    db.add(copied)
    db.flush()
    _audit(
        db,
        session_payload,
        request,
        current_settings,
        action="project.artifact.copy_to_personal",
        entity_uuid=artifact.uuid,
        project_uuid=project.uuid,
        metadata={"sanitized": True, "copied_artifact_uuid": copied.uuid},
    )
    db.commit()
    db.refresh(copied)
    return PersonalArtifactCopyOut(
        artifact_id=copied.id,
        artifact_uuid=copied.uuid,
        sanitized=True,
    )
