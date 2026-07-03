from datetime import datetime
from pathlib import Path
import re
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from .auth import get_session, require_action
from .config import Settings, get_settings
from .crypto import ContentCipher, EncryptedPayload
from .context.context_builder import ContextBuilder
from .context.mode_knowledge_filters import merge_mode_knowledge_filters
from .database import get_db
from .knowledge_files import (
    _safe_file_name,
    create_knowledge_file_from_bytes,
    reparse_knowledge_file_from_existing_chunks,
)
from .knowledge_search import RetrievedKnowledgeChunk, search_knowledge_chunks
from .agent_loop.task_analyzer import TaskAnalyzer
from .models import (
    KnowledgeBase,
    KnowledgeCategory,
    KnowledgeChunk,
    KnowledgeDocumentType,
    KnowledgeFile,
    KnowledgeReviewLog,
    KnowledgeSearchLog,
    WebCapture,
)
from .schemas import (
    KnowledgeBaseCreateIn,
    KnowledgeBaseListOut,
    KnowledgeBaseOut,
    KnowledgeBasePatchIn,
    KnowledgeCategoryCreateIn,
    KnowledgeCategoryListOut,
    KnowledgeCategoryOut,
    KnowledgeCategoryPatchIn,
    KnowledgeDocumentTypeCreateIn,
    KnowledgeDocumentTypeListOut,
    KnowledgeDocumentTypeOut,
    KnowledgeDocumentTypePatchIn,
    KnowledgeAskOut,
    KnowledgeFileAskIn,
    KnowledgeFileClassifyIn,
    KnowledgeFileClassifyOut,
    KnowledgeFileOut,
    KnowledgeFileListOut,
    KnowledgeFilePatchIn,
    KnowledgeFilePreviewChunkOut,
    KnowledgeFilePreviewOut,
    KnowledgeQueryIn,
    KnowledgeReviewDecisionIn,
    KnowledgeReviewHistoryOut,
    KnowledgeReviewLogOut,
    KnowledgeReviewSubmitIn,
    KnowledgeSearchOut,
    KnowledgeSourceOut,
    SessionPayload,
)


router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


DEFAULT_KNOWLEDGE_CATEGORIES = [
    "公司制度",
    "产品资料",
    "项目交付",
    "销售商务",
    "行政人力",
    "安全运维",
    "模板范本",
    "会议纪要",
    "个人素材",
    "其他",
]

DEFAULT_KNOWLEDGE_DOCUMENT_TYPES = [
    "产品白皮书",
    "解决方案",
    "投标模板",
    "交付说明",
    "测试报告",
    "安全服务报告",
    "会议记录",
    "提示词手册",
    "其他",
]

KNOWLEDGE_DOWNLOAD_MEDIA_TYPES = {
    "txt": "text/plain; charset=utf-8",
    "md": "text/markdown; charset=utf-8",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


def _is_admin(session_payload: SessionPayload) -> bool:
    return session_payload.user.role.strip().lower() == "admin"


def _base_out(base: KnowledgeBase) -> KnowledgeBaseOut:
    return KnowledgeBaseOut(
        base_id=base.uuid,
        name=base.name,
        description=base.description,
        scope=base.scope,
        owner_user_id=base.owner_user_id,
        department_id=base.department_id,
        project_id=base.project_id,
        created_by=base.created_by,
        created_at=base.created_at,
        updated_at=base.updated_at,
    )


def _category_out(db: Session, category: KnowledgeCategory) -> KnowledgeCategoryOut:
    parent_uuid = ""
    parent_name = ""
    if category.parent_id is not None:
        parent = db.scalar(
            select(KnowledgeCategory).where(KnowledgeCategory.id == category.parent_id)
        )
        if parent is not None:
            parent_uuid = parent.uuid
            parent_name = parent.name
    file_count = db.scalar(
        select(func.count(KnowledgeFile.id)).where(
            KnowledgeFile.category == category.name,
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    ) or 0
    return KnowledgeCategoryOut(
        category_id=category.uuid,
        name=category.name,
        parent_category_id=parent_uuid,
        parent_name=parent_name,
        scope=category.scope,
        sort_order=category.sort_order,
        status=category.status,
        file_count=int(file_count),
        created_at=category.created_at,
        updated_at=category.updated_at,
    )


def _document_type_out(db: Session, document_type: KnowledgeDocumentType) -> KnowledgeDocumentTypeOut:
    file_count = db.scalar(
        select(func.count(KnowledgeFile.id)).where(
            KnowledgeFile.document_type == document_type.name,
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    ) or 0
    return KnowledgeDocumentTypeOut(
        document_type_id=document_type.uuid,
        name=document_type.name,
        sort_order=document_type.sort_order,
        status=document_type.status,
        file_count=int(file_count),
        created_at=document_type.created_at,
        updated_at=document_type.updated_at,
    )


def _normalize_category_name(name: str) -> str:
    return " ".join(name.strip().split())[:64]


def _normalize_document_type_name(name: str) -> str:
    return " ".join(name.strip().split())[:64]


def _ensure_default_categories(db: Session) -> None:
    existing_names = set(
        db.scalars(
            select(KnowledgeCategory.name).where(KnowledgeCategory.deleted_at.is_(None))
        )
    )
    missing_categories = [
        KnowledgeCategory(
            name=name,
            scope="company",
            sort_order=index * 10,
            status="ACTIVE",
            created_by="system",
        )
        for index, name in enumerate(DEFAULT_KNOWLEDGE_CATEGORIES, start=1)
        if name not in existing_names
    ]
    if missing_categories:
        db.add_all(missing_categories)
        db.commit()


def _ensure_default_document_types(db: Session) -> None:
    existing_names = set(
        db.scalars(
            select(KnowledgeDocumentType.name).where(KnowledgeDocumentType.deleted_at.is_(None))
        )
    )
    missing_document_types = [
        KnowledgeDocumentType(
            name=name,
            sort_order=index * 10,
            status="ACTIVE",
            created_by="system",
        )
        for index, name in enumerate(DEFAULT_KNOWLEDGE_DOCUMENT_TYPES, start=1)
        if name not in existing_names
    ]
    if missing_document_types:
        db.add_all(missing_document_types)
        db.commit()


def _category_by_uuid(db: Session, category_id: str) -> KnowledgeCategory | None:
    return db.scalar(
        select(KnowledgeCategory).where(
            KnowledgeCategory.uuid == category_id.strip(),
            KnowledgeCategory.deleted_at.is_(None),
        )
    )


def _document_type_by_uuid(db: Session, document_type_id: str) -> KnowledgeDocumentType | None:
    return db.scalar(
        select(KnowledgeDocumentType).where(
            KnowledgeDocumentType.uuid == document_type_id.strip(),
            KnowledgeDocumentType.deleted_at.is_(None),
        )
    )


def _category_name_exists(
    db: Session,
    name: str,
    *,
    exclude_id: int | None = None,
) -> bool:
    filters = [
        KnowledgeCategory.name == name,
        KnowledgeCategory.deleted_at.is_(None),
    ]
    if exclude_id is not None:
        filters.append(KnowledgeCategory.id != exclude_id)
    return db.scalar(select(KnowledgeCategory.id).where(*filters)) is not None


def _document_type_name_exists(
    db: Session,
    name: str,
    *,
    exclude_id: int | None = None,
) -> bool:
    filters = [
        KnowledgeDocumentType.name == name,
        KnowledgeDocumentType.deleted_at.is_(None),
    ]
    if exclude_id is not None:
        filters.append(KnowledgeDocumentType.id != exclude_id)
    return db.scalar(select(KnowledgeDocumentType.id).where(*filters)) is not None


def _file_out(db: Session, file_record: KnowledgeFile) -> KnowledgeFileOut:
    knowledge_base_uuid = ""
    if file_record.knowledge_base_id is not None:
        knowledge_base_uuid = db.scalar(
            select(KnowledgeBase.uuid).where(KnowledgeBase.id == file_record.knowledge_base_id)
        ) or ""
    chunk_count = db.scalar(
        select(func.count(KnowledgeChunk.id)).where(
            KnowledgeChunk.file_id == file_record.id,
            KnowledgeChunk.status == "READY",
        )
    ) or 0
    return KnowledgeFileOut(
        file_uuid=file_record.uuid,
        knowledge_base_id=knowledge_base_uuid,
        file_name=file_record.file_name,
        file_type=file_record.file_type,
        file_size=file_record.file_size,
        visibility=file_record.visibility,
        status=file_record.status,
        chunk_count=int(chunk_count),
        created_at=file_record.created_at,
        source_type=file_record.source_type,
        source_origin=file_record.source_origin,
        web_capture_id=file_record.web_capture_id,
        source_url=file_record.source_url,
        usage_type=file_record.usage_type,
        review_status=file_record.review_status,
        rag_enabled=file_record.rag_enabled,
        reference_enabled=file_record.reference_enabled,
        rag_scope=file_record.rag_scope,
        permission_scope=file_record.permission_scope,
        category=file_record.category,
        document_type=file_record.document_type,
        tags=list(file_record.tags_json or []),
        parse_status=file_record.parse_status,
        index_status=file_record.index_status,
    )


def _split_tags(raw_tags: str) -> list[str]:
    tags: list[str] = []
    for tag in re.split(r"[,，\n]", raw_tags or ""):
        value = tag.strip()
        if value:
            tags.append(value[:64])
    return tags[:20]


def _dedupe_tags(tags: list[str]) -> list[str]:
    deduped: list[str] = []
    for tag in tags:
        value = tag.strip()[:64]
        if value and value not in deduped:
            deduped.append(value)
    return deduped[:20]


def _classify_file(file_record: KnowledgeFile) -> tuple[str, str, list[str]]:
    text = " ".join([
        file_record.file_name,
        file_record.summary,
        file_record.category,
        file_record.document_type,
        " ".join(file_record.tags_json or []),
    ])
    rules = [
        (("会议", "纪要", "待办"), "会议纪要", "会议纪要", ["会议纪要"]),
        (("投标", "标书", "商务"), "商务投标", "投标文件", ["商务投标"]),
        (("部署", "安装", "交付", "验收"), "产品交付", "安装部署手册", ["产品交付"]),
        (("巡检", "漏洞", "日志", "加固", "运维"), "安全运维", "巡检报告", ["安全运维"]),
        (("风险", "评估"), "风险评估", "风险评估报告", ["风险评估"]),
        (("应急", "处置", "响应"), "应急响应", "应急响应报告", ["应急响应"]),
        (("渗透", "漏洞验证"), "渗透测试", "测试报告", ["渗透测试"]),
        (("测试", "用例", "缺陷"), "软件测试", "测试报告", ["软件测试"]),
        (("等保", "合规"), "等保合规", "报告模板", ["等保合规"]),
        (("白皮书", "产品", "彩页"), "产品资料", "产品白皮书", ["产品资料"]),
    ]
    category = file_record.category or "其他"
    document_type = file_record.document_type or "其他"
    suggested_tags: list[str] = []
    for keywords, rule_category, rule_type, rule_tags in rules:
        if any(keyword in text for keyword in keywords):
            category = rule_category
            document_type = rule_type
            suggested_tags.extend(rule_tags)
            break
    if file_record.usage_type == "personal_reference":
        suggested_tags.append("个人资料")
    if file_record.usage_type == "session_attachment":
        suggested_tags.append("当前会话附件")
    if "客户" in text:
        suggested_tags.append("客户资料")
    return category, document_type, _dedupe_tags([*(file_record.tags_json or []), *suggested_tags])


def _can_view_base(base: KnowledgeBase, *, user_id: str, is_admin: bool) -> bool:
    return is_admin or base.scope == "company" or base.owner_user_id == user_id


def _can_manage_base(base: KnowledgeBase, *, user_id: str, is_admin: bool) -> bool:
    return is_admin or (base.scope == "personal" and base.owner_user_id == user_id)


def _can_view_file(file_record: KnowledgeFile, *, user_id: str, is_admin: bool) -> bool:
    return (
        is_admin
        or file_record.owner_user_id == user_id
        or (
            file_record.usage_type == "official_knowledge"
            and file_record.review_status in {"approved", "official"}
            and file_record.permission_scope in {"company", "department", "project", "admin"}
        )
    )


def _can_manage_file(file_record: KnowledgeFile, *, user_id: str, is_admin: bool) -> bool:
    return is_admin or (
        file_record.owner_user_id == user_id
        and file_record.usage_type in {"personal_reference", "session_attachment"}
    )


def _content_cipher(current_settings: Settings) -> ContentCipher:
    return ContentCipher(current_settings.content_encryption_key)


def _content_disposition_for_download(file_name: str) -> str:
    safe_name = re.split(r"[/\\]+", file_name or "")[-1].strip() or "knowledge-file"
    safe_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", safe_name)[:180].strip(" .")
    safe_name = safe_name or "knowledge-file"
    ascii_name = safe_name.encode("ascii", "ignore").decode("ascii").strip()
    ascii_name = ascii_name or "knowledge-file"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(safe_name)}"


def _download_media_type(file_type: str | None) -> str:
    normalized = (file_type or "").strip().lower().lstrip(".")
    return KNOWLEDGE_DOWNLOAD_MEDIA_TYPES.get(normalized, "application/octet-stream")


def _stored_original_path(file_record: KnowledgeFile, *, storage_root: str) -> Path:
    if not file_record.file_path:
        raise HTTPException(status_code=404, detail="原始文件不存在")
    root = Path(storage_root).expanduser().resolve()
    stored_path = Path(file_record.file_path).expanduser().resolve()
    try:
        stored_path.relative_to(root)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="原始文件不存在") from exc
    if not stored_path.is_file():
        raise HTTPException(status_code=404, detail="原始文件不存在")
    return stored_path


def _remove_stored_original_file(file_record: KnowledgeFile, *, storage_root: str) -> None:
    if not file_record.file_path:
        return
    root = Path(storage_root).expanduser().resolve()
    stored_path = Path(file_record.file_path).expanduser().resolve()
    try:
        stored_path.relative_to(root)
    except ValueError:
        return
    if stored_path.is_file():
        stored_path.unlink()


def _filter_values(body: KnowledgeQueryIn, key: str) -> list[str]:
    value = body.filters.get(key, [])
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _knowledge_source_out(chunk: RetrievedKnowledgeChunk) -> KnowledgeSourceOut:
    return KnowledgeSourceOut(
        source_kind=chunk.source_kind,
        file_id=chunk.file_uuid,
        file_name=chunk.file_name,
        page_number=chunk.page_number,
        section_title=chunk.section_title,
        chunk_id=chunk.chunk_id,
        score=chunk.score,
        snippet=chunk.chunk_text[:300],
    )


def _source_kind_for_file(file_record: KnowledgeFile) -> str:
    if file_record.usage_type == "official_knowledge":
        return "official_knowledge"
    if file_record.usage_type == "session_attachment":
        return "session_attachment"
    return "personal_reference"


def _chunks_for_file(
    db: Session,
    *,
    file_record: KnowledgeFile,
    cipher: ContentCipher,
    top_k: int | None = 8,
    chunk_id: str = "",
) -> list[RetrievedKnowledgeChunk]:
    limit = max(1, min(int(top_k or 8), 20))
    filters = [
        KnowledgeChunk.file_id == file_record.id,
        KnowledgeChunk.status == "READY",
        KnowledgeChunk.deleted_at.is_(None),
    ]
    if chunk_id:
        filters.append(KnowledgeChunk.chunk_id == chunk_id)
    rows = list(
        db.scalars(
            select(KnowledgeChunk)
            .where(*filters)
            .order_by(KnowledgeChunk.chunk_index.asc(), KnowledgeChunk.id.asc())
            .limit(limit)
        )
    )
    if chunk_id and not rows:
        raise HTTPException(status_code=404, detail="知识文件片段不存在或无权访问")
    chunks: list[RetrievedKnowledgeChunk] = []
    source_kind = _source_kind_for_file(file_record)
    for chunk in rows:
        payload = cipher.decrypt_json(
            EncryptedPayload(
                ciphertext=chunk.chunk_text_ciphertext,
                nonce=chunk.chunk_text_nonce,
            ),
            chunk.chunk_id.encode(),
        )
        chunks.append(
            RetrievedKnowledgeChunk(
                chunk_id=chunk.chunk_id,
                file_uuid=file_record.uuid,
                file_name=file_record.file_name,
                chunk_text=str(payload.get("text", "")),
                page_number=chunk.page_number,
                section_title=chunk.section_title,
                chunk_index=chunk.chunk_index,
                score=1,
                source_kind=source_kind,
            )
        )
    return chunks


def _file_action_notice(file_record: KnowledgeFile) -> str:
    if file_record.usage_type == "official_knowledge":
        return "本次内容仅依据所选正式知识库文档生成；来源需显示文件名、章节或页码。"
    if file_record.usage_type == "session_attachment":
        return "该内容参考当前会话附件生成，仅供本次会话使用。"
    return "该内容参考用户个人上传资料生成，仅供当前用户使用。"


def _mark_file_used(file_record: KnowledgeFile) -> None:
    file_record.usage_count = (file_record.usage_count or 0) + 1
    file_record.last_used_at = datetime.now()


def _file_action_messages(
    *,
    body: KnowledgeFileAskIn,
    file_record: KnowledgeFile,
    chunks: list[RetrievedKnowledgeChunk],
    question: str,
):
    analysis = TaskAnalyzer().analyze(question, body.mode)
    official_chunks = chunks if file_record.usage_type == "official_knowledge" else []
    personal_chunks = chunks if file_record.usage_type != "official_knowledge" else []
    return ContextBuilder().build_messages(
        mode=analysis.mode,
        current_user_message=question,
        knowledge_chunks=official_chunks,
        personal_reference_chunks=personal_chunks,
        recent_messages=[],
        require_knowledge_evidence=file_record.usage_type == "official_knowledge",
    )


def _official_chunks(
    db: Session,
    *,
    user_id: str,
    body: KnowledgeQueryIn,
    cipher: ContentCipher,
) -> list[RetrievedKnowledgeChunk]:
    categories, document_types = merge_mode_knowledge_filters(
        mode=body.mode,
        categories=_filter_values(body, "category"),
        document_types=_filter_values(body, "document_type"),
    )
    return search_knowledge_chunks(
        db,
        sso_user_id=user_id,
        query=body.question,
        cipher=cipher,
        top_k=body.top_k,
        knowledge_base_ids=body.knowledge_base_ids,
        categories=categories,
        document_types=document_types,
    )


def _add_search_log(
    db: Session,
    *,
    user_id: str,
    body: KnowledgeQueryIn,
    chunks: list[RetrievedKnowledgeChunk],
    search_type: str = "official_rag",
) -> None:
    db.add(
        KnowledgeSearchLog(
            user_id=user_id,
            question=body.question[:20_000],
            mode=body.mode,
            search_type=search_type,
            knowledge_base_ids_json=list(body.knowledge_base_ids),
            filters_json=dict(body.filters),
            retrieved_chunk_ids_json=[chunk.chunk_id for chunk in chunks],
            answer_message_id="",
        )
    )


def _add_review_log(
    db: Session,
    *,
    file_record: KnowledgeFile,
    user_id: str,
    reviewer_id: str = "",
    action: str,
    old_status: str,
    new_status: str,
    comment: str = "",
) -> None:
    db.add(
        KnowledgeReviewLog(
            file_id=file_record.id,
            user_id=user_id,
            reviewer_id=reviewer_id,
            action=action,
            old_status=old_status,
            new_status=new_status,
            comment=comment,
        )
    )


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


@router.post("/search", response_model=KnowledgeSearchOut)
async def search_knowledge(
    body: KnowledgeQueryIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeSearchOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    chunks = _official_chunks(
        db,
        user_id=user_id,
        body=body,
        cipher=_content_cipher(current_settings),
    )
    _add_search_log(db, user_id=user_id, body=body, chunks=chunks)
    db.commit()
    sources = [_knowledge_source_out(chunk) for chunk in chunks] if body.include_sources else []
    return KnowledgeSearchOut(sources=sources, total=len(chunks))


@router.post("/ask", response_model=KnowledgeAskOut)
async def ask_knowledge(
    body: KnowledgeQueryIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeAskOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    chunks = _official_chunks(
        db,
        user_id=user_id,
        body=body,
        cipher=_content_cipher(current_settings),
    )
    _add_search_log(db, user_id=user_id, body=body, chunks=chunks)
    db.commit()
    if not chunks:
        return KnowledgeAskOut(
            answer="当前正式知识库中未找到明确依据",
            messages=[],
            sources=[],
            notice="正式知识库未检索到可引用资料，不能编造产品、方案、参数或承诺。",
        )
    analysis = TaskAnalyzer().analyze(body.question, body.mode)
    messages = ContextBuilder().build_messages(
        mode=analysis.mode,
        current_user_message=body.question,
        knowledge_chunks=chunks,
        personal_reference_chunks=[],
        recent_messages=[],
        require_knowledge_evidence=True,
    )
    sources = [_knowledge_source_out(chunk) for chunk in chunks] if body.include_sources else []
    return KnowledgeAskOut(
        answer="",
        messages=messages,
        sources=sources,
        notice="本次回答应仅依据正式知识库资料生成；来源需显示文件名、章节或页码。",
    )


@router.post("/files/{file_id}/ask", response_model=KnowledgeAskOut)
async def ask_knowledge_file(
    file_id: str,
    body: KnowledgeFileAskIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeAskOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    is_admin = _is_admin(session_payload)
    file_record = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_id,
            KnowledgeFile.status == "READY",
            KnowledgeFile.deleted_at.is_(None),
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    )
    if file_record is None or not _can_view_file(file_record, user_id=user_id, is_admin=is_admin):
        raise HTTPException(status_code=404, detail="知识文件不存在或无权访问")
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="question 不能为空")
    chunks = _chunks_for_file(
        db,
        file_record=file_record,
        cipher=_content_cipher(current_settings),
        top_k=body.top_k,
    )
    if chunks:
        _mark_file_used(file_record)
    _add_search_log(
        db,
        user_id=user_id,
        body=KnowledgeQueryIn(question=question, mode=body.mode, top_k=body.top_k),
        chunks=chunks,
        search_type=_source_kind_for_file(file_record),
    )
    db.commit()
    messages = _file_action_messages(
        body=body,
        file_record=file_record,
        chunks=chunks,
        question=question,
    )
    sources = [_knowledge_source_out(chunk) for chunk in chunks] if body.include_sources else []
    return KnowledgeAskOut(
        answer="",
        messages=messages,
        sources=sources,
        notice=_file_action_notice(file_record),
    )


@router.post("/files/{file_id}/summary", response_model=KnowledgeAskOut)
async def summarize_knowledge_file(
    file_id: str,
    body: KnowledgeFileAskIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeAskOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    is_admin = _is_admin(session_payload)
    file_record = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_id,
            KnowledgeFile.status == "READY",
            KnowledgeFile.deleted_at.is_(None),
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    )
    if file_record is None or not _can_view_file(file_record, user_id=user_id, is_admin=is_admin):
        raise HTTPException(status_code=404, detail="知识文件不存在或无权访问")
    question = body.question.strip() or "请总结这个文档，提炼核心内容、待办事项、风险提醒和下一步建议。"
    chunks = _chunks_for_file(
        db,
        file_record=file_record,
        cipher=_content_cipher(current_settings),
        top_k=body.top_k,
    )
    if chunks:
        _mark_file_used(file_record)
    _add_search_log(
        db,
        user_id=user_id,
        body=KnowledgeQueryIn(question=question, mode=body.mode, top_k=body.top_k),
        chunks=chunks,
        search_type=_source_kind_for_file(file_record),
    )
    db.commit()
    messages = _file_action_messages(
        body=body,
        file_record=file_record,
        chunks=chunks,
        question=question,
    )
    sources = [_knowledge_source_out(chunk) for chunk in chunks] if body.include_sources else []
    return KnowledgeAskOut(
        answer="",
        messages=messages,
        sources=sources,
        notice=_file_action_notice(file_record),
    )


@router.post("/bases", response_model=KnowledgeBaseOut, status_code=201)
async def create_knowledge_base(
    body: KnowledgeBaseCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeBaseOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    is_admin = _is_admin(session_payload)
    if body.scope != "personal" and not is_admin:
        raise HTTPException(status_code=403, detail="普通用户只能创建个人知识库")

    owner_user_id = user_id if body.scope == "personal" else ""
    base = KnowledgeBase(
        name=body.name.strip(),
        description=body.description.strip(),
        scope=body.scope,
        owner_user_id=owner_user_id,
        department_id=body.department_id.strip(),
        project_id=body.project_id.strip(),
        created_by=user_id,
    )
    db.add(base)
    db.commit()
    db.refresh(base)
    return _base_out(base)


@router.get("/bases", response_model=KnowledgeBaseListOut)
async def list_knowledge_bases(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeBaseListOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    is_admin = _is_admin(session_payload)
    filters = [KnowledgeBase.deleted_at.is_(None)]
    if not is_admin:
        filters.append(
            or_(
                KnowledgeBase.scope == "company",
                KnowledgeBase.owner_user_id == user_id,
            )
        )
    rows = list(
        db.scalars(
            select(KnowledgeBase)
            .where(*filters)
            .order_by(KnowledgeBase.scope.asc(), KnowledgeBase.created_at.desc(), KnowledgeBase.id.desc())
        )
    )
    items = [_base_out(row) for row in rows]
    return KnowledgeBaseListOut(items=items, total=len(items))


@router.get("/categories", response_model=KnowledgeCategoryListOut)
async def list_knowledge_categories(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    include_disabled: bool = False,
) -> KnowledgeCategoryListOut:
    await _require_use(request, session_payload, current_settings)
    is_admin = _is_admin(session_payload)
    _ensure_default_categories(db)
    filters = [KnowledgeCategory.deleted_at.is_(None)]
    if not is_admin or not include_disabled:
        filters.append(KnowledgeCategory.status == "ACTIVE")
    rows = list(
        db.scalars(
            select(KnowledgeCategory)
            .where(*filters)
            .order_by(
                KnowledgeCategory.sort_order.asc(),
                KnowledgeCategory.created_at.asc(),
                KnowledgeCategory.id.asc(),
            )
        )
    )
    return KnowledgeCategoryListOut(
        items=[_category_out(db, row) for row in rows],
        total=len(rows),
    )


@router.post("/categories", response_model=KnowledgeCategoryOut, status_code=201)
async def create_knowledge_category(
    body: KnowledgeCategoryCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeCategoryOut:
    await _require_use(request, session_payload, current_settings)
    if not _is_admin(session_payload):
        raise HTTPException(status_code=403, detail="只有管理员可以管理资料分类")
    name = _normalize_category_name(body.name)
    if not name:
        raise HTTPException(status_code=422, detail="分类名称不能为空")
    if _category_name_exists(db, name):
        raise HTTPException(status_code=409, detail="资料分类已存在")
    parent: KnowledgeCategory | None = None
    if body.parent_category_id.strip():
        parent = _category_by_uuid(db, body.parent_category_id)
        if parent is None:
            raise HTTPException(status_code=404, detail="上级分类不存在")
    category = KnowledgeCategory(
        name=name,
        parent_id=parent.id if parent is not None else None,
        scope=body.scope,
        sort_order=body.sort_order,
        status=body.status,
        created_by=str(session_payload.user.id),
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    return _category_out(db, category)


@router.patch("/categories/{category_id}", response_model=KnowledgeCategoryOut)
async def update_knowledge_category(
    category_id: str,
    body: KnowledgeCategoryPatchIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeCategoryOut:
    await _require_use(request, session_payload, current_settings)
    if not _is_admin(session_payload):
        raise HTTPException(status_code=403, detail="只有管理员可以管理资料分类")
    category = _category_by_uuid(db, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="资料分类不存在")

    old_name = category.name
    if body.name is not None:
        name = _normalize_category_name(body.name)
        if not name:
            raise HTTPException(status_code=422, detail="分类名称不能为空")
        if _category_name_exists(db, name, exclude_id=category.id):
            raise HTTPException(status_code=409, detail="资料分类已存在")
        category.name = name
    if body.parent_category_id is not None:
        parent_id = body.parent_category_id.strip()
        if not parent_id:
            category.parent_id = None
        else:
            parent = _category_by_uuid(db, parent_id)
            if parent is None:
                raise HTTPException(status_code=404, detail="上级分类不存在")
            if parent.id == category.id:
                raise HTTPException(status_code=422, detail="上级分类不能选择自己")
            category.parent_id = parent.id
    if body.scope is not None:
        category.scope = body.scope
    if body.sort_order is not None:
        category.sort_order = body.sort_order
    if body.status is not None:
        category.status = body.status

    if category.name != old_name:
        db.execute(
            update(KnowledgeFile)
            .where(KnowledgeFile.category == old_name)
            .values(category=category.name)
        )
    db.commit()
    db.refresh(category)
    return _category_out(db, category)


@router.delete("/categories/{category_id}", status_code=204)
async def delete_knowledge_category(
    category_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    await _require_use(request, session_payload, current_settings)
    if not _is_admin(session_payload):
        raise HTTPException(status_code=403, detail="只有管理员可以管理资料分类")
    category = _category_by_uuid(db, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="资料分类不存在")
    child_count = db.scalar(
        select(func.count(KnowledgeCategory.id)).where(
            KnowledgeCategory.parent_id == category.id,
            KnowledgeCategory.deleted_at.is_(None),
        )
    ) or 0
    if child_count:
        raise HTTPException(status_code=409, detail="该分类下还有子分类，请先调整子分类")
    file_count = db.scalar(
        select(func.count(KnowledgeFile.id)).where(
            KnowledgeFile.category == category.name,
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    ) or 0
    if file_count:
        raise HTTPException(status_code=409, detail="该分类下还有资料，请先移动资料或停用分类")
    category.deleted_at = datetime.now()
    db.commit()
    return Response(status_code=204)


@router.get("/document-types", response_model=KnowledgeDocumentTypeListOut)
async def list_knowledge_document_types(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    include_disabled: bool = False,
) -> KnowledgeDocumentTypeListOut:
    await _require_use(request, session_payload, current_settings)
    is_admin = _is_admin(session_payload)
    _ensure_default_document_types(db)
    filters = [KnowledgeDocumentType.deleted_at.is_(None)]
    if not is_admin or not include_disabled:
        filters.append(KnowledgeDocumentType.status == "ACTIVE")
    rows = list(
        db.scalars(
            select(KnowledgeDocumentType)
            .where(*filters)
            .order_by(
                KnowledgeDocumentType.sort_order.asc(),
                KnowledgeDocumentType.created_at.asc(),
                KnowledgeDocumentType.id.asc(),
            )
        )
    )
    return KnowledgeDocumentTypeListOut(
        items=[_document_type_out(db, row) for row in rows],
        total=len(rows),
    )


@router.post("/document-types", response_model=KnowledgeDocumentTypeOut, status_code=201)
async def create_knowledge_document_type(
    body: KnowledgeDocumentTypeCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeDocumentTypeOut:
    await _require_use(request, session_payload, current_settings)
    if not _is_admin(session_payload):
        raise HTTPException(status_code=403, detail="只有管理员可以管理文档类型")
    name = _normalize_document_type_name(body.name)
    if not name:
        raise HTTPException(status_code=422, detail="文档类型名称不能为空")
    if _document_type_name_exists(db, name):
        raise HTTPException(status_code=409, detail="文档类型已存在")
    document_type = KnowledgeDocumentType(
        name=name,
        sort_order=body.sort_order,
        status=body.status,
        created_by=str(session_payload.user.id),
    )
    db.add(document_type)
    db.commit()
    db.refresh(document_type)
    return _document_type_out(db, document_type)


@router.patch("/document-types/{document_type_id}", response_model=KnowledgeDocumentTypeOut)
async def update_knowledge_document_type(
    document_type_id: str,
    body: KnowledgeDocumentTypePatchIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeDocumentTypeOut:
    await _require_use(request, session_payload, current_settings)
    if not _is_admin(session_payload):
        raise HTTPException(status_code=403, detail="只有管理员可以管理文档类型")
    document_type = _document_type_by_uuid(db, document_type_id)
    if document_type is None:
        raise HTTPException(status_code=404, detail="文档类型不存在")

    old_name = document_type.name
    if body.name is not None:
        name = _normalize_document_type_name(body.name)
        if not name:
            raise HTTPException(status_code=422, detail="文档类型名称不能为空")
        if _document_type_name_exists(db, name, exclude_id=document_type.id):
            raise HTTPException(status_code=409, detail="文档类型已存在")
        document_type.name = name
    if body.sort_order is not None:
        document_type.sort_order = body.sort_order
    if body.status is not None:
        document_type.status = body.status

    if document_type.name != old_name:
        db.execute(
            update(KnowledgeFile)
            .where(KnowledgeFile.document_type == old_name)
            .values(document_type=document_type.name)
        )
    db.commit()
    db.refresh(document_type)
    return _document_type_out(db, document_type)


@router.delete("/document-types/{document_type_id}", status_code=204)
async def delete_knowledge_document_type(
    document_type_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    await _require_use(request, session_payload, current_settings)
    if not _is_admin(session_payload):
        raise HTTPException(status_code=403, detail="只有管理员可以管理文档类型")
    document_type = _document_type_by_uuid(db, document_type_id)
    if document_type is None:
        raise HTTPException(status_code=404, detail="文档类型不存在")
    file_count = db.scalar(
        select(func.count(KnowledgeFile.id)).where(
            KnowledgeFile.document_type == document_type.name,
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    ) or 0
    if file_count:
        raise HTTPException(status_code=409, detail="该类型下还有资料，请先移动资料或停用类型")
    document_type.deleted_at = datetime.now()
    db.commit()
    return Response(status_code=204)


@router.get("/reviews/pending", response_model=KnowledgeFileListOut)
async def list_pending_reviews(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeFileListOut:
    await _require_use(request, session_payload, current_settings)
    if not _is_admin(session_payload):
        raise HTTPException(status_code=403, detail="只有管理员可以查看待审核文档")
    rows = list(
        db.scalars(
            select(KnowledgeFile)
            .where(
                KnowledgeFile.review_status == "pending",
                KnowledgeFile.status != "DELETED",
                KnowledgeFile.deleted_at.is_(None),
                KnowledgeFile.hard_deleted_at.is_(None),
            )
            .order_by(KnowledgeFile.updated_at.desc(), KnowledgeFile.id.desc())
        )
    )
    items = [_file_out(db, row) for row in rows]
    return KnowledgeFileListOut(items=items, total=len(items))


@router.get("/reviews/history", response_model=KnowledgeReviewHistoryOut)
async def list_review_history(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeReviewHistoryOut:
    await _require_use(request, session_payload, current_settings)
    if not _is_admin(session_payload):
        raise HTTPException(status_code=403, detail="只有管理员可以查看审核历史")
    rows = list(
        db.execute(
            select(KnowledgeReviewLog, KnowledgeFile)
            .join(KnowledgeFile, KnowledgeFile.id == KnowledgeReviewLog.file_id)
            .order_by(KnowledgeReviewLog.created_at.desc(), KnowledgeReviewLog.id.desc())
        )
    )
    items = [
        KnowledgeReviewLogOut(
            file_uuid=file_record.uuid,
            file_name=file_record.file_name,
            user_id=log.user_id,
            reviewer_id=log.reviewer_id,
            action=log.action,
            old_status=log.old_status,
            new_status=log.new_status,
            comment=log.comment,
            created_at=log.created_at,
        )
        for log, file_record in rows
    ]
    return KnowledgeReviewHistoryOut(items=items, total=len(items))


@router.get("/files", response_model=KnowledgeFileListOut)
async def list_knowledge_files(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeFileListOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    is_admin = _is_admin(session_payload)
    filters = [
        KnowledgeFile.status != "DELETED",
        KnowledgeFile.deleted_at.is_(None),
        KnowledgeFile.hard_deleted_at.is_(None),
    ]
    if not is_admin:
        filters.append(
            or_(
                KnowledgeFile.owner_user_id == user_id,
                (
                    (KnowledgeFile.usage_type == "official_knowledge")
                    & (KnowledgeFile.review_status.in_(("approved", "official")))
                    & (KnowledgeFile.permission_scope.in_(("company", "department", "project", "admin")))
                ),
            )
        )
    rows = list(
        db.scalars(
            select(KnowledgeFile)
            .where(*filters)
            .order_by(KnowledgeFile.updated_at.desc(), KnowledgeFile.id.desc())
        )
    )
    items = [_file_out(db, row) for row in rows]
    return KnowledgeFileListOut(items=items, total=len(items))


@router.get("/files/trash", response_model=KnowledgeFileListOut)
async def list_knowledge_file_trash(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeFileListOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    is_admin = _is_admin(session_payload)
    filters = [
        KnowledgeFile.status == "DELETED",
        KnowledgeFile.hard_deleted_at.is_(None),
    ]
    if not is_admin:
        filters.append(KnowledgeFile.owner_user_id == user_id)
    rows = list(
        db.scalars(
            select(KnowledgeFile)
            .where(*filters)
            .order_by(KnowledgeFile.updated_at.desc(), KnowledgeFile.id.desc())
        )
    )
    items = [_file_out(db, row) for row in rows]
    return KnowledgeFileListOut(items=items, total=len(items))


@router.get("/files/{file_id}/preview", response_model=KnowledgeFilePreviewOut)
async def preview_knowledge_file(
    file_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    top_k: int = 20,
    chunk_id: str = "",
) -> KnowledgeFilePreviewOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    is_admin = _is_admin(session_payload)
    file_record = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_id,
            KnowledgeFile.status == "READY",
            KnowledgeFile.deleted_at.is_(None),
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    )
    if file_record is None or not _can_view_file(file_record, user_id=user_id, is_admin=is_admin):
        raise HTTPException(status_code=404, detail="知识文件不存在或无权访问")
    chunks = _chunks_for_file(
        db,
        file_record=file_record,
        cipher=_content_cipher(current_settings),
        top_k=top_k,
        chunk_id=chunk_id.strip(),
    )
    return KnowledgeFilePreviewOut(
        file_uuid=file_record.uuid,
        file_name=file_record.file_name,
        source_kind=_source_kind_for_file(file_record),
        chunks=[
            KnowledgeFilePreviewChunkOut(
                chunk_id=chunk.chunk_id,
                chunk_index=chunk.chunk_index,
                page_number=chunk.page_number,
                section_title=chunk.section_title,
                page_or_sheet=chunk.page_or_sheet,
                chunk_type=chunk.chunk_type,
                text=chunk.chunk_text,
            )
            for chunk in chunks
        ],
        total_chunks=len(chunks),
        notice=_file_action_notice(file_record),
    )


@router.get("/files/{file_id}/download")
async def download_knowledge_file(
    file_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    is_admin = _is_admin(session_payload)
    file_record = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_id,
            KnowledgeFile.status == "READY",
            KnowledgeFile.deleted_at.is_(None),
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    )
    if file_record is None or not _can_view_file(file_record, user_id=user_id, is_admin=is_admin):
        raise HTTPException(status_code=404, detail="知识文件不存在或无权访问")
    stored_path = _stored_original_path(
        file_record,
        storage_root=current_settings.knowledge_storage_dir,
    )
    return Response(
        content=stored_path.read_bytes(),
        media_type=_download_media_type(file_record.file_type),
        headers={
            "Content-Disposition": _content_disposition_for_download(
                file_record.original_file_name or file_record.file_name
            )
        },
    )


@router.get("/files/{file_id}", response_model=KnowledgeFileOut)
async def get_knowledge_file(
    file_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeFileOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    is_admin = _is_admin(session_payload)
    file_record = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_id,
            KnowledgeFile.status != "DELETED",
            KnowledgeFile.deleted_at.is_(None),
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    )
    if file_record is None or not _can_view_file(file_record, user_id=user_id, is_admin=is_admin):
        raise HTTPException(status_code=404, detail="知识文件不存在或无权访问")
    return _file_out(db, file_record)


@router.post("/files/{file_id}/classify", response_model=KnowledgeFileClassifyOut)
async def classify_knowledge_file(
    file_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    body: KnowledgeFileClassifyIn = Body(default_factory=KnowledgeFileClassifyIn),
) -> KnowledgeFileClassifyOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    is_admin = _is_admin(session_payload)
    file_record = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_id,
            KnowledgeFile.status != "DELETED",
            KnowledgeFile.deleted_at.is_(None),
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    )
    if file_record is None:
        raise HTTPException(status_code=404, detail="知识文件不存在")
    if not _can_manage_file(file_record, user_id=user_id, is_admin=is_admin):
        raise HTTPException(status_code=403, detail="无权分类该知识文件")
    category, document_type, tags = _classify_file(file_record)
    if body.apply:
        file_record.category = category
        file_record.document_type = document_type
        file_record.tags_json = tags
        db.commit()
        db.refresh(file_record)
    return KnowledgeFileClassifyOut(
        file_uuid=file_record.uuid,
        category=category,
        document_type=document_type,
        tags=tags,
        applied=body.apply,
    )


@router.patch("/files/{file_id}", response_model=KnowledgeFileOut)
async def update_knowledge_file(
    file_id: str,
    body: KnowledgeFilePatchIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeFileOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    is_admin = _is_admin(session_payload)
    file_record = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_id,
            KnowledgeFile.status != "DELETED",
            KnowledgeFile.deleted_at.is_(None),
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    )
    if file_record is None:
        raise HTTPException(status_code=404, detail="知识文件不存在")
    if not _can_manage_file(file_record, user_id=user_id, is_admin=is_admin):
        raise HTTPException(status_code=403, detail="无权修改该知识文件")
    if body.file_name is not None:
        safe_file_name = _safe_file_name(body.file_name)
        file_record.file_name = safe_file_name
        db.execute(
            update(KnowledgeChunk)
            .where(KnowledgeChunk.file_id == file_record.id)
            .values(file_name=safe_file_name)
        )
    if body.category is not None:
        file_record.category = body.category.strip() or file_record.category
    if body.document_type is not None:
        file_record.document_type = body.document_type.strip() or file_record.document_type
    if body.tags is not None:
        file_record.tags_json = [tag.strip()[:64] for tag in body.tags if tag.strip()][:20]
    if body.reference_enabled is not None and file_record.usage_type != "official_knowledge":
        file_record.reference_enabled = body.reference_enabled
    db.commit()
    db.refresh(file_record)
    return _file_out(db, file_record)


@router.delete("/files/{file_id}", status_code=204)
async def delete_knowledge_file(
    file_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    is_admin = _is_admin(session_payload)
    file_record = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_id,
            KnowledgeFile.status != "DELETED",
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    )
    if file_record is None:
        raise HTTPException(status_code=404, detail="知识文件不存在")
    if not _can_manage_file(file_record, user_id=user_id, is_admin=is_admin):
        raise HTTPException(status_code=403, detail="无权删除该知识文件")
    old_status = file_record.status
    file_record.status = "DELETED"
    file_record.deleted_at = datetime.now()
    file_record.rag_enabled = False
    for chunk in db.scalars(select(KnowledgeChunk).where(KnowledgeChunk.file_id == file_record.id)):
        chunk.status = "DELETED"
        chunk.deleted_at = file_record.deleted_at
    _add_review_log(
        db,
        file_record=file_record,
        user_id=user_id,
        action="delete",
        old_status=old_status,
        new_status="DELETED",
    )
    db.commit()
    return Response(status_code=204)


@router.delete("/files/{file_id}/hard-delete", status_code=204)
async def hard_delete_knowledge_file(
    file_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    confirm: bool = False,
) -> Response:
    await _require_use(request, session_payload, current_settings)
    if not confirm:
        raise HTTPException(status_code=400, detail="彻底删除需要二次确认")
    user_id = str(session_payload.user.id)
    is_admin = _is_admin(session_payload)
    file_record = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_id,
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    )
    if file_record is None:
        raise HTTPException(status_code=404, detail="知识文件不存在")
    if not _can_manage_file(file_record, user_id=user_id, is_admin=is_admin):
        raise HTTPException(status_code=403, detail="无权彻底删除该知识文件")
    if file_record.status != "DELETED" or file_record.deleted_at is None:
        raise HTTPException(status_code=409, detail="请先删除到回收站，再执行彻底删除")

    now = datetime.now()
    for chunk in db.scalars(select(KnowledgeChunk).where(KnowledgeChunk.file_id == file_record.id)):
        db.delete(chunk)
    _remove_stored_original_file(
        file_record,
        storage_root=current_settings.knowledge_storage_dir,
    )
    file_record.status = "HARD_DELETED"
    file_record.hard_deleted_at = now
    file_record.rag_enabled = False
    file_record.reference_enabled = False
    file_record.archived_at = None
    file_record.file_path = ""
    file_record.stored_file_name = ""
    db.commit()
    return Response(status_code=204)


@router.get("/bases/{base_id}", response_model=KnowledgeBaseOut)
async def get_knowledge_base(
    base_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeBaseOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    is_admin = _is_admin(session_payload)
    base = db.scalar(
        select(KnowledgeBase).where(
            KnowledgeBase.uuid == base_id,
            KnowledgeBase.deleted_at.is_(None),
        )
    )
    if base is None or not _can_view_base(base, user_id=user_id, is_admin=is_admin):
        raise HTTPException(status_code=404, detail="知识库不存在或无权访问")
    return _base_out(base)


@router.patch("/bases/{base_id}", response_model=KnowledgeBaseOut)
async def update_knowledge_base(
    base_id: str,
    body: KnowledgeBasePatchIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeBaseOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    is_admin = _is_admin(session_payload)
    base = db.scalar(
        select(KnowledgeBase).where(
            KnowledgeBase.uuid == base_id,
            KnowledgeBase.deleted_at.is_(None),
        )
    )
    if base is None:
        raise HTTPException(status_code=404, detail="知识库不存在")
    if not _can_manage_base(base, user_id=user_id, is_admin=is_admin):
        raise HTTPException(status_code=403, detail="无权修改该知识库")
    if body.scope is not None and body.scope != "personal" and not is_admin:
        raise HTTPException(status_code=403, detail="普通用户不能把知识库设为正式范围")

    if body.name is not None:
        base.name = body.name.strip()
    if body.description is not None:
        base.description = body.description.strip()
    if body.scope is not None:
        base.scope = body.scope
        base.owner_user_id = user_id if body.scope == "personal" else ""
    if body.department_id is not None:
        base.department_id = body.department_id.strip()
    if body.project_id is not None:
        base.project_id = body.project_id.strip()
    db.commit()
    db.refresh(base)
    return _base_out(base)


@router.delete("/bases/{base_id}", status_code=204)
async def delete_knowledge_base(
    base_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    is_admin = _is_admin(session_payload)
    base = db.scalar(
        select(KnowledgeBase).where(
            KnowledgeBase.uuid == base_id,
            KnowledgeBase.deleted_at.is_(None),
        )
    )
    if base is None:
        raise HTTPException(status_code=404, detail="知识库不存在")
    if not _can_manage_base(base, user_id=user_id, is_admin=is_admin):
        raise HTTPException(status_code=403, detail="无权删除该知识库")
    base.deleted_at = datetime.now()
    db.commit()
    return Response(status_code=204)


@router.post("/files/upload", response_model=KnowledgeFileOut, status_code=201)
async def upload_knowledge_file(
    file: Annotated[UploadFile, File()],
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    knowledge_base_id: Annotated[str, Form()] = "",
    usage_type: Annotated[str, Form()] = "personal_reference",
    review_status: Annotated[str, Form()] = "draft",
    rag_enabled: Annotated[bool, Form()] = False,
    reference_enabled: Annotated[bool, Form()] = True,
    rag_scope: Annotated[str, Form()] = "personal",
    permission_scope: Annotated[str, Form()] = "private",
    conversation_id: Annotated[str, Form()] = "",
    category: Annotated[str, Form()] = "个人素材",
    document_type: Annotated[str, Form()] = "其他",
    tags: Annotated[str, Form()] = "",
) -> KnowledgeFileOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    is_admin = _is_admin(session_payload)
    normalized_usage_type = usage_type.strip().lower() or "personal_reference"
    if normalized_usage_type not in {
        "session_attachment",
        "personal_reference",
        "official_knowledge",
    }:
        raise HTTPException(status_code=422, detail="知识文件用途无效")

    base: KnowledgeBase | None = None
    normalized_base_id = knowledge_base_id.strip()
    if normalized_base_id:
        base = db.scalar(
            select(KnowledgeBase).where(
                KnowledgeBase.uuid == normalized_base_id,
                KnowledgeBase.deleted_at.is_(None),
            )
        )
        if base is None:
            raise HTTPException(status_code=404, detail="知识库不存在")

    if normalized_usage_type == "official_knowledge":
        if not is_admin:
            raise HTTPException(status_code=403, detail="普通用户不能上传正式知识库文档")
        if base is None or base.scope == "personal":
            raise HTTPException(status_code=422, detail="正式知识库文档必须关联正式知识库")
        normalized_review_status = "official"
        normalized_rag_scope = rag_scope.strip().lower() or "company"
        if normalized_rag_scope in {"none", "session", "personal"}:
            normalized_rag_scope = "company"
        normalized_permission_scope = permission_scope.strip().lower() or "company"
        if normalized_permission_scope == "private":
            normalized_permission_scope = "company"
        normalized_visibility = "PUBLIC"
        source_type = "admin_upload"
        normalized_rag_enabled = True
        normalized_reference_enabled = True
    else:
        if rag_enabled or review_status.strip().lower() in {"approved", "official"}:
            raise HTTPException(status_code=403, detail="普通资料不能直接启用正式 RAG")
        if base is not None and base.scope != "personal":
            raise HTTPException(status_code=422, detail="个人资料只能关联个人知识库")
        if base is not None and not _can_manage_base(base, user_id=user_id, is_admin=is_admin):
            raise HTTPException(status_code=403, detail="无权向该知识库上传文档")
        if normalized_usage_type == "session_attachment":
            if not conversation_id.strip():
                raise HTTPException(status_code=422, detail="当前会话附件必须提供会话 ID")
            normalized_rag_scope = "session"
            category = category if category.strip() else "当前附件"
        else:
            normalized_usage_type = "personal_reference"
            normalized_rag_scope = "personal"
            category = category if category.strip() else "个人素材"
        normalized_review_status = (
            "pending" if review_status.strip().lower() == "pending" else "draft"
        )
        normalized_permission_scope = "private"
        normalized_visibility = "PRIVATE"
        source_type = "user_upload"
        normalized_rag_enabled = False
        normalized_reference_enabled = reference_enabled

    try:
        content = await file.read()
        file_record, _chunks = create_knowledge_file_from_bytes(
            db,
            sso_user_id=user_id,
            file_name=file.filename or "",
            content=content,
            content_type=file.content_type or "application/octet-stream",
            cipher=_content_cipher(current_settings),
            key_version=current_settings.content_encryption_key_version,
            visibility=normalized_visibility,
            source_type=source_type,
            usage_type=normalized_usage_type,
            review_status=normalized_review_status,
            rag_enabled=normalized_rag_enabled,
            reference_enabled=normalized_reference_enabled,
            rag_scope=normalized_rag_scope,
            permission_scope=normalized_permission_scope,
            owner_user_id=user_id,
            conversation_id=conversation_id.strip(),
            category=(category.strip() or "其他")[:64],
            document_type=(document_type.strip() or "其他")[:64],
            tags=_split_tags(tags),
            uploaded_by=user_id,
            knowledge_base_id=base.id if base is not None else None,
            storage_root=current_settings.knowledge_storage_dir,
        )
        db.commit()
        db.refresh(file_record)
        return _file_out(db, file_record)
    except Exception:
        db.rollback()
        raise


@router.post("/files/{file_id}/submit-review", response_model=KnowledgeFileOut)
async def submit_file_review(
    file_id: str,
    body: KnowledgeReviewSubmitIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeFileOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    file_record = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_id,
            KnowledgeFile.owner_user_id == user_id,
            KnowledgeFile.usage_type == "personal_reference",
            KnowledgeFile.status != "DELETED",
            KnowledgeFile.deleted_at.is_(None),
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    )
    if file_record is None:
        raise HTTPException(status_code=404, detail="知识文件不存在或无权访问")
    old_status = file_record.review_status
    file_record.review_status = "pending"
    file_record.rag_enabled = False
    file_record.permission_scope = "private"
    file_record.rag_scope = "personal"
    file_record.review_comment = body.comment.strip()
    _add_review_log(
        db,
        file_record=file_record,
        user_id=user_id,
        action="submit_review",
        old_status=old_status,
        new_status="pending",
        comment=file_record.review_comment,
    )
    db.commit()
    db.refresh(file_record)
    return _file_out(db, file_record)


@router.post("/files/{file_id}/restore", response_model=KnowledgeFileOut)
async def restore_knowledge_file(
    file_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeFileOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    is_admin = _is_admin(session_payload)
    file_record = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_id,
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    )
    if file_record is None:
        raise HTTPException(status_code=404, detail="知识文件不存在")
    if not _can_manage_file(file_record, user_id=user_id, is_admin=is_admin):
        raise HTTPException(status_code=403, detail="无权恢复该知识文件")
    old_status = file_record.status
    file_record.status = "READY"
    file_record.deleted_at = None
    file_record.archived_at = None
    if file_record.usage_type == "official_knowledge" and file_record.review_status in {"approved", "official"}:
        file_record.rag_enabled = True
    for chunk in db.scalars(select(KnowledgeChunk).where(KnowledgeChunk.file_id == file_record.id)):
        chunk.status = "READY"
        chunk.deleted_at = None
    _add_review_log(
        db,
        file_record=file_record,
        user_id=user_id,
        action="restore",
        old_status=old_status,
        new_status="READY",
    )
    db.commit()
    db.refresh(file_record)
    return _file_out(db, file_record)


@router.post("/files/{file_id}/reparse", response_model=KnowledgeFileOut)
async def reparse_knowledge_file(
    file_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeFileOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    is_admin = _is_admin(session_payload)
    file_record = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_id,
            KnowledgeFile.status == "READY",
            KnowledgeFile.deleted_at.is_(None),
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    )
    if file_record is None:
        raise HTTPException(status_code=404, detail="知识文件不存在")
    if file_record.usage_type == "official_knowledge" and not is_admin:
        raise HTTPException(status_code=403, detail="只有管理员可以重解析正式知识库文档")
    if file_record.usage_type != "official_knowledge" and file_record.owner_user_id != user_id:
        raise HTTPException(status_code=404, detail="知识文件不存在或无权访问")
    try:
        reparse_knowledge_file_from_existing_chunks(
            db,
            file_record=file_record,
            cipher=_content_cipher(current_settings),
            storage_root=current_settings.knowledge_storage_dir,
        )
        db.commit()
        db.refresh(file_record)
        return _file_out(db, file_record)
    except Exception:
        db.rollback()
        raise


@router.post("/files/{file_id}/archive", response_model=KnowledgeFileOut)
async def archive_knowledge_file(
    file_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeFileOut:
    await _require_use(request, session_payload, current_settings)
    user_id = str(session_payload.user.id)
    is_admin = _is_admin(session_payload)
    file_record = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_id,
            KnowledgeFile.status != "DELETED",
            KnowledgeFile.deleted_at.is_(None),
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    )
    if file_record is None:
        raise HTTPException(status_code=404, detail="知识文件不存在")
    if not _can_manage_file(file_record, user_id=user_id, is_admin=is_admin):
        raise HTTPException(status_code=403, detail="无权归档该知识文件")
    old_status = file_record.status
    file_record.status = "ARCHIVED"
    file_record.archived_at = datetime.now()
    file_record.rag_enabled = False
    _add_review_log(
        db,
        file_record=file_record,
        user_id=user_id,
        action="archive",
        old_status=old_status,
        new_status="ARCHIVED",
    )
    db.commit()
    db.refresh(file_record)
    return _file_out(db, file_record)


@router.post("/files/{file_id}/enable-rag", response_model=KnowledgeFileOut)
async def enable_file_rag(
    file_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeFileOut:
    await _require_use(request, session_payload, current_settings)
    if not _is_admin(session_payload):
        raise HTTPException(status_code=403, detail="只有管理员可以启用正式 RAG")
    file_record = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_id,
            KnowledgeFile.status == "READY",
            KnowledgeFile.deleted_at.is_(None),
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    )
    if file_record is None:
        raise HTTPException(status_code=404, detail="知识文件不存在")
    if file_record.usage_type != "official_knowledge" or file_record.review_status not in {"approved", "official"}:
        raise HTTPException(status_code=422, detail="只有正式知识库文档可以启用 RAG")
    file_record.rag_enabled = True
    db.commit()
    db.refresh(file_record)
    return _file_out(db, file_record)


@router.post("/files/{file_id}/disable-rag", response_model=KnowledgeFileOut)
async def disable_file_rag(
    file_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeFileOut:
    await _require_use(request, session_payload, current_settings)
    if not _is_admin(session_payload):
        raise HTTPException(status_code=403, detail="只有管理员可以禁用正式 RAG")
    file_record = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_id,
            KnowledgeFile.status != "DELETED",
            KnowledgeFile.deleted_at.is_(None),
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    )
    if file_record is None:
        raise HTTPException(status_code=404, detail="知识文件不存在")
    if file_record.usage_type != "official_knowledge":
        raise HTTPException(status_code=422, detail="只有正式知识库文档可以调整 RAG")
    file_record.rag_enabled = False
    db.commit()
    db.refresh(file_record)
    return _file_out(db, file_record)


@router.post("/files/{file_id}/approve", response_model=KnowledgeFileOut)
async def approve_file_review(
    file_id: str,
    body: KnowledgeReviewDecisionIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeFileOut:
    await _require_use(request, session_payload, current_settings)
    if not _is_admin(session_payload):
        raise HTTPException(status_code=403, detail="只有管理员可以审核知识文件")
    reviewer_id = str(session_payload.user.id)
    file_record = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_id,
            KnowledgeFile.review_status == "pending",
            KnowledgeFile.status != "DELETED",
            KnowledgeFile.deleted_at.is_(None),
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    )
    if file_record is None:
        raise HTTPException(status_code=404, detail="待审核知识文件不存在")
    base = db.scalar(
        select(KnowledgeBase).where(
            KnowledgeBase.uuid == body.knowledge_base_id.strip(),
            KnowledgeBase.deleted_at.is_(None),
        )
    )
    if base is None or base.scope == "personal":
        raise HTTPException(status_code=422, detail="审核通过必须选择正式知识库")

    old_status = file_record.review_status
    file_record.knowledge_base_id = base.id
    file_record.usage_type = "official_knowledge"
    file_record.review_status = "official"
    file_record.rag_enabled = True
    file_record.reference_enabled = True
    file_record.rag_scope = body.rag_scope
    file_record.permission_scope = body.permission_scope
    file_record.visibility = "PUBLIC"
    if body.category.strip():
        file_record.category = body.category.strip()
    if body.document_type.strip():
        file_record.document_type = body.document_type.strip()
    if body.tags:
        file_record.tags_json = [tag.strip()[:64] for tag in body.tags if tag.strip()][:20]
    file_record.reviewed_by = reviewer_id
    file_record.reviewed_at = datetime.now()
    file_record.review_comment = body.comment.strip()
    if file_record.source_origin == "web_capture" and file_record.web_capture_id:
        capture = db.scalar(
            select(WebCapture).where(WebCapture.uuid == file_record.web_capture_id)
        )
        if capture is not None:
            capture.status = "approved"
            capture.review_status = "approved"
            capture.save_target = "official_knowledge_candidate"
    chunks = db.scalars(select(KnowledgeChunk).where(KnowledgeChunk.file_id == file_record.id))
    for chunk in chunks:
        chunk.knowledge_base_id = base.id
        metadata = dict(chunk.metadata_json or {})
        metadata["source_type"] = "official_knowledge"
        metadata["usage_type"] = "official_knowledge"
        metadata["review_status"] = "official"
        metadata["rag_scope"] = body.rag_scope
        metadata["permission_scope"] = body.permission_scope
        metadata["category_id"] = file_record.category
        metadata["document_type_id"] = file_record.document_type
        chunk.metadata_json = metadata
    _add_review_log(
        db,
        file_record=file_record,
        user_id=file_record.owner_user_id or file_record.sso_user_id,
        reviewer_id=reviewer_id,
        action="approve",
        old_status=old_status,
        new_status="official",
        comment=file_record.review_comment,
    )
    db.commit()
    db.refresh(file_record)
    return _file_out(db, file_record)


@router.post("/files/{file_id}/reject", response_model=KnowledgeFileOut)
async def reject_file_review(
    file_id: str,
    body: KnowledgeReviewSubmitIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    current_settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> KnowledgeFileOut:
    await _require_use(request, session_payload, current_settings)
    if not _is_admin(session_payload):
        raise HTTPException(status_code=403, detail="只有管理员可以审核知识文件")
    reviewer_id = str(session_payload.user.id)
    file_record = db.scalar(
        select(KnowledgeFile).where(
            KnowledgeFile.uuid == file_id,
            KnowledgeFile.review_status == "pending",
            KnowledgeFile.status != "DELETED",
            KnowledgeFile.deleted_at.is_(None),
            KnowledgeFile.hard_deleted_at.is_(None),
        )
    )
    if file_record is None:
        raise HTTPException(status_code=404, detail="待审核知识文件不存在")
    old_status = file_record.review_status
    file_record.usage_type = "personal_reference"
    file_record.review_status = "rejected"
    file_record.rag_enabled = False
    file_record.rag_scope = "personal"
    file_record.permission_scope = "private"
    file_record.visibility = "PRIVATE"
    file_record.reviewed_by = reviewer_id
    file_record.reviewed_at = datetime.now()
    file_record.review_comment = body.comment.strip()
    if file_record.source_origin == "web_capture" and file_record.web_capture_id:
        capture = db.scalar(
            select(WebCapture).where(WebCapture.uuid == file_record.web_capture_id)
        )
        if capture is not None:
            capture.status = "rejected"
            capture.review_status = "rejected"
    _add_review_log(
        db,
        file_record=file_record,
        user_id=file_record.owner_user_id or file_record.sso_user_id,
        reviewer_id=reviewer_id,
        action="reject",
        old_status=old_status,
        new_status="rejected",
        comment=file_record.review_comment,
    )
    db.commit()
    db.refresh(file_record)
    return _file_out(db, file_record)
