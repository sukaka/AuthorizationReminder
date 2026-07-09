from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .crypto import ContentCipher, EncryptedPayload
from .config import get_settings
from .document_templates.base import DocumentRenderPayload
from .document_templates.registry import get_document_template
from .export_file_manager import ExportFileManager
from .models import ChatMessage, ChatMessageSource, ChatSession, ExportRecord, KnowledgeChunk
from .reference_matching import source_is_mentioned
from .schemas import ExportContentWordIn, ExportWordIn, ExportWordOut
from .work_artifacts import create_word_export_artifact, source_summary_for_messages


FORMAL_DOCUMENT_PROMPT = """你是聚信得仁内部文档助手。
请将以下聊天内容整理为正式 Word 文档内容。
要求：
1. 使用正式书面语。
2. 保留原始核心内容。
3. 删除聊天口吻。
4. 不要编造原文没有的信息。
5. 按正式文档结构组织，包括标题、背景、内容、实施步骤、交付成果、注意事项等。
6. 适合导出为 Word。
7. 如果内容涉及网络安全、等保、交付、安全运维、风险评估、应急响应，要使用聚信得仁公司内部文档风格。
"""


@dataclass(frozen=True)
class ChatExportContent:
    title: str
    task_name: str
    output: str
    message_id: str
    use_formal_template: bool = True


class TemplateRenderer:
    def render(
        self,
        *,
        title: str,
        task_name: str,
        department: str,
        author: str,
        output: str,
        version: str,
        template_name: str,
    ) -> bytes:
        template_code = "" if template_name == "juxin_standard" else template_name
        template = get_document_template(template_code)
        return template.render_docx(
            DocumentRenderPayload(
                title=title,
                task_name=task_name,
                department=department,
                author=author,
                output=output,
                version=version,
            )
        )


class MarkdownToDocxConverter:
    def __init__(self, template_renderer: TemplateRenderer | None = None) -> None:
        self.template_renderer = template_renderer or TemplateRenderer()

    def convert(
        self,
        content: ChatExportContent,
        *,
        department: str,
        author: str,
        template_name: str,
    ) -> bytes:
        if not content.use_formal_template:
            from app.word_export import render_chat_answer_docx

            return render_chat_answer_docx(
                title=content.title,
                output=content.output,
                version="V1.0",
            )

        return self.template_renderer.render(
            title=content.title,
            task_name=content.task_name,
            department=department,
            author=author,
            output=content.output,
            version="V1.0",
            template_name=template_name,
        )


class DocxExportService:
    def __init__(
        self,
        *,
        file_manager: ExportFileManager,
        converter: MarkdownToDocxConverter | None = None,
    ) -> None:
        self.file_manager = file_manager
        self.converter = converter or MarkdownToDocxConverter()

    def export_word(
        self,
        db: Session,
        *,
        body: ExportWordIn,
        sso_user_id: str,
        username: str,
        department: str,
        cipher: ContentCipher,
    ) -> ExportWordOut:
        session = _get_session(db, body.conversation_id, sso_user_id)
        messages = _select_messages(db, session=session, body=body, sso_user_id=sso_user_id)
        content = _build_export_content(db, session, messages, body, cipher)
        document = self.converter.convert(
            content,
            department=department or "待确认",
            author=username or sso_user_id,
            template_name=body.template,
        )
        saved = self.file_manager.save_docx(
            file_name=_export_file_name(session.title, body.export_type),
            content=document,
        )
        record = ExportRecord(
            uuid=saved.file_id,
            conversation_id=session.uuid,
            message_id=content.message_id,
            file_name=saved.file_name,
            file_path=saved.file_path,
            export_type=body.export_type,
            template_name=body.template,
            created_by=sso_user_id,
        )
        db.add(record)
        db.flush()
        create_word_export_artifact(
            db,
            owner_user_id=sso_user_id,
            conversation_id=session.uuid,
            message_id=content.message_id,
            title=session.title,
            export_record=record,
            source_summary=source_summary_for_messages(
                db,
                [message.id for message in messages if message.role == "assistant"],
            ),
        )
        return ExportWordOut(
            file_name=saved.file_name,
            download_url=f"/api/export/download/{saved.file_id}",
        )

    def export_content_word(
        self,
        db: Session,
        *,
        body: ExportContentWordIn,
        sso_user_id: str,
        username: str,
        department: str,
    ) -> ExportWordOut:
        output = _append_transient_reference_sources(body.content, body.sources)
        content = ChatExportContent(
            title=body.title[:80] or "知识库文档结果",
            task_name=body.title[:80] or "知识库文档结果",
            output=output,
            message_id="",
        )
        document = self.converter.convert(
            content,
            department=department or "待确认",
            author=username or sso_user_id,
            template_name=body.template,
        )
        saved = self.file_manager.save_docx(
            file_name=f"{body.title}-文档结果.docx",
            content=document,
        )
        record = ExportRecord(
            uuid=saved.file_id,
            conversation_id="",
            message_id="",
            file_name=saved.file_name,
            file_path=saved.file_path,
            export_type="knowledge_result",
            template_name=body.template,
            created_by=sso_user_id,
        )
        db.add(record)
        db.flush()
        create_word_export_artifact(
            db,
            owner_user_id=sso_user_id,
            conversation_id="",
            message_id="",
            title=body.title[:80] or "知识库文档结果",
            export_record=record,
            source_summary=_transient_source_summary(body.sources),
        )
        return ExportWordOut(
            file_name=saved.file_name,
            download_url=f"/api/export/download/{saved.file_id}",
        )


def decrypt_chat_content(cipher: ContentCipher, message: ChatMessage) -> str:
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


def _get_session(db: Session, conversation_id: str, sso_user_id: str) -> ChatSession:
    session = db.scalar(
        select(ChatSession).where(
            ChatSession.uuid == conversation_id,
            ChatSession.sso_user_id == sso_user_id,
            ChatSession.status.in_(["active", "archived"]),
        )
    )
    if session is None:
        raise HTTPException(status_code=404, detail="聊天会话不存在或无权访问")
    return session


def _select_messages(
    db: Session,
    *,
    session: ChatSession,
    body: ExportWordIn,
    sso_user_id: str,
) -> list[ChatMessage]:
    base = [
        ChatMessage.session_id == session.id,
        ChatMessage.sso_user_id == sso_user_id,
        ChatMessage.status == "COMPLETED",
    ]
    if body.export_type == "single_answer" or (
        body.export_type == "formal_document" and body.message_id
    ):
        if not body.message_id:
            raise HTTPException(status_code=422, detail="message_id 不能为空")
        messages = list(db.scalars(
            select(ChatMessage)
            .where(*base, ChatMessage.uuid == body.message_id, ChatMessage.role == "assistant")
            .order_by(ChatMessage.id.asc())
        ))
    elif body.export_type == "selected_messages" or (
        body.export_type == "formal_document" and body.selected_message_ids
    ):
        message_ids = body.selected_message_ids or ([body.message_id] if body.message_id else [])
        if not message_ids:
            raise HTTPException(status_code=422, detail="selected_message_ids 不能为空")
        messages = list(db.scalars(
            select(ChatMessage)
            .where(*base, ChatMessage.uuid.in_(message_ids))
            .order_by(ChatMessage.id.asc())
        ))
    else:
        messages = list(db.scalars(
            select(ChatMessage)
            .where(*base)
            .order_by(ChatMessage.id.asc())
        ))
    if not messages:
        raise HTTPException(status_code=404, detail="可导出的聊天内容不存在")
    return messages


def _build_export_content(
    db: Session,
    session: ChatSession,
    messages: list[ChatMessage],
    body: ExportWordIn,
    cipher: ContentCipher,
) -> ChatExportContent:
    message_id = ""
    if body.export_type == "single_answer" or (
        body.export_type == "formal_document" and body.message_id
    ):
        message_id = messages[0].uuid
    elif body.export_type == "selected_messages" or (
        body.export_type == "formal_document" and body.selected_message_ids
    ):
        message_id = ",".join(message.uuid for message in messages)
    use_formal_template = body.export_type == "formal_document"
    if body.format_before_export and body.formatted_content:
        output = body.formatted_content
        if use_formal_template:
            output = _ensure_formal_document_structure(output)
    else:
        output = _compose_messages_markdown(messages, cipher)
        if use_formal_template or body.format_before_export:
            output = _deterministic_formal_document(output)
    output = _append_reference_sources(db, output, messages, cipher)
    title = "聊天正式文档" if body.export_type == "formal_document" else f"AI 对话导出-{session.title}"
    return ChatExportContent(
        title=title[:80] or "AI 对话导出",
        task_name="AI 对话导出",
        output=output,
        message_id=message_id,
        use_formal_template=use_formal_template,
    )


def _compose_messages_markdown(messages: list[ChatMessage], cipher: ContentCipher) -> str:
    parts: list[str] = []
    for index, message in enumerate(messages, start=1):
        role_name = "用户" if message.role == "user" else "聚信 AI 助手"
        content = decrypt_chat_content(cipher, message)
        parts.append(f"## {index}. {role_name}\n\n{content}".strip())
    return "\n\n".join(parts).strip() or "暂无"


def _append_reference_sources(db: Session, output: str, messages: list[ChatMessage], cipher: ContentCipher) -> str:
    source_markdown = _reference_sources_markdown(db, messages, output, cipher=cipher)
    if not source_markdown:
        return output
    return f"{output.rstrip()}\n\n{source_markdown}".strip()


def _reference_sources_markdown(
    db: Session,
    messages: list[ChatMessage],
    output: str | None = None,
    *,
    cipher: ContentCipher | None = None,
) -> str:
    message_ids = [message.id for message in messages if message.role == "assistant"]
    if not message_ids:
        return ""
    sources = list(db.scalars(
        select(ChatMessageSource)
        .where(ChatMessageSource.message_id.in_(message_ids))
        .order_by(ChatMessageSource.id.asc())
    ))
    if not sources:
        return ""
    kept_source_keys = _verified_reference_keys(db, sources, output, cipher=cipher)
    lines: list[str] = ["# 参考来源"]
    seen: set[tuple[str, str, int | None, str]] = set()
    has_personal_reference = False
    has_session_attachment = False
    source_number = 1
    for source in sources:
        if kept_source_keys is not None and _source_key(source) not in kept_source_keys:
            continue
        if kept_source_keys is None and not _source_is_mentioned(source, output):
            continue
        key = (
            source.source_type,
            source.file_name,
            source.page_number,
            source.section_title,
        )
        if key in seen:
            continue
        seen.add(key)
        label = _source_label(source.source_type)
        has_personal_reference = has_personal_reference or source.source_type == "personal_reference"
        has_session_attachment = has_session_attachment or source.source_type == "session_attachment"
        lines.append(f"{source_number}. {source.file_name or source.title or '未命名资料'}——{label}{_source_location(source)}")
        source_number += 1
    if has_personal_reference:
        lines.append("\n本文参考用户个人上传资料生成，仅供用户本人使用。")
    if has_session_attachment:
        lines.append("\n本文参考当前会话附件生成，仅供本次会话使用。")
    if source_number == 1:
        return ""
    return "\n".join(lines)


def _verified_reference_keys(
    db: Session,
    sources: list[ChatMessageSource],
    output: str | None,
    *,
    cipher: ContentCipher | None,
) -> set[tuple[str, str, str]] | None:
    if output is None:
        return None
    source_payloads = _source_payloads_for_verifier(db, sources, cipher=cipher)
    files_with_evidence = {
        str(source.get("file_name") or "")
        for source in source_payloads
        if source.get("chunk_text")
    }
    verified_sources = [
        source
        for source in source_payloads
        if _word_export_source_is_used(
            source,
            output,
            require_evidence=str(source.get("file_name") or "") in files_with_evidence,
        )
    ]
    return {
        (
            str(source.get("source_uuid") or ""),
            str(source.get("chunk_id") or ""),
            str(source.get("file_name") or ""),
        )
        for source in verified_sources
    }


def _source_payloads_for_verifier(
    db: Session,
    sources: list[ChatMessageSource],
    *,
    cipher: ContentCipher | None,
) -> list[dict[str, object]]:
    chunk_ids = [source.chunk_id for source in sources if source.chunk_id]
    chunk_text_by_id: dict[str, str] = {}
    if chunk_ids:
        content_cipher = cipher or ContentCipher(get_settings().content_encryption_key)
        chunks = db.scalars(select(KnowledgeChunk).where(KnowledgeChunk.chunk_id.in_(chunk_ids)))
        for chunk in chunks:
            try:
                payload = content_cipher.decrypt_json(
                    EncryptedPayload(
                        ciphertext=chunk.chunk_text_ciphertext,
                        nonce=chunk.chunk_text_nonce,
                    ),
                    chunk.chunk_id.encode(),
                )
            except Exception:
                continue
            chunk_text_by_id[chunk.chunk_id] = str(payload.get("text", ""))
    return [
        {
            "source_type": source.source_type,
            "source_uuid": source.source_uuid,
            "file_name": source.file_name,
            "title": source.title,
            "chunk_id": source.chunk_id,
            "page_number": source.page_number,
            "section_title": source.section_title,
            "chunk_index": source.chunk_index,
            "score": source.score,
            "chunk_text": chunk_text_by_id.get(source.chunk_id, ""),
        }
        for source in sources
    ]


def _source_key(source: ChatMessageSource) -> tuple[str, str, str]:
    return source.source_uuid, source.chunk_id, source.file_name


def _word_export_source_is_used(source: dict[str, object], output: str, *, require_evidence: bool = False) -> bool:
    chunk_text = str(source.get("chunk_text") or "")
    if chunk_text:
        return _source_evidence_is_used(source, output)
    if require_evidence:
        return False
    return source_is_mentioned(_DictSource(source), output)


def _source_evidence_is_used(source: dict[str, object], output: str) -> bool:
    normalized_output = _normalize_evidence_text(output)
    section_title = _normalize_evidence_text(str(source.get("section_title") or ""))
    if section_title and section_title in normalized_output:
        return True
    chunk_text = _normalize_evidence_text(str(source.get("chunk_text") or ""))
    return any(phrase in normalized_output for phrase in _evidence_phrases(chunk_text))


def _normalize_evidence_text(value: str | None) -> str:
    if not value:
        return ""
    return "".join(char for char in value if char.isalnum() or "\u4e00" <= char <= "\u9fff")


def _evidence_phrases(value: str) -> list[str]:
    if len(value) < 4:
        return [value] if value else []
    step = 4
    return [
        value[index : index + step]
        for index in range(0, max(0, len(value) - step + 1))
        if len(value[index : index + step]) == step
    ][:80]


class _DictSource:
    def __init__(self, source: dict[str, object]) -> None:
        self.file_name = str(source.get("file_name") or "")
        self.title = str(source.get("title") or "")


def _source_is_mentioned(source: ChatMessageSource, output: str | None) -> bool:
    return source_is_mentioned(source, output, none_matches=True)


def _append_transient_reference_sources(output: str, sources: list) -> str:
    source_markdown = _transient_reference_sources_markdown(sources)
    if not source_markdown:
        return output
    return f"{output.rstrip()}\n\n{source_markdown}".strip()


def _transient_reference_sources_markdown(sources: list) -> str:
    if not sources:
        return ""
    lines: list[str] = ["# 参考来源"]
    seen: set[tuple[str, str, int | None, str]] = set()
    has_personal_reference = False
    has_session_attachment = False
    source_number = 1
    for source in sources:
        source_kind = str(source.source_kind)
        key = (
            source_kind,
            source.file_name,
            source.page_number,
            source.section_title,
        )
        if key in seen:
            continue
        seen.add(key)
        has_personal_reference = has_personal_reference or source_kind == "personal_reference"
        has_session_attachment = has_session_attachment or source_kind == "session_attachment"
        lines.append(
            f"{source_number}. {source.file_name or '未命名资料'}"
            f"——{_source_label(source_kind)}{_transient_source_location(source)}"
        )
        source_number += 1
    if has_personal_reference:
        lines.append("\n本文参考用户个人上传资料生成，仅供用户本人使用。")
    if has_session_attachment:
        lines.append("\n本文参考当前会话附件生成，仅供本次会话使用。")
    return "\n".join(lines)


def _transient_source_summary(sources: list) -> list[dict[str, object]]:
    summary: list[dict[str, object]] = []
    seen: set[tuple[str, str, int | None, str]] = set()
    for source in sources:
        key = (
            str(source.source_kind),
            source.file_name,
            source.page_number,
            source.section_title,
        )
        if key in seen:
            continue
        seen.add(key)
        summary.append({
            "source_type": str(source.source_kind),
            "file_name": source.file_name,
            "page_number": source.page_number,
            "section_title": source.section_title,
        })
    return summary


def _source_label(source_type: str) -> str:
    if source_type in {"official_knowledge", "knowledge_file"}:
        return "公司知识库 / 正式知识来源"
    if source_type == "session_attachment":
        return "当前会话附件"
    if source_type == "personal_reference":
        return "我的上传文件，仅用于本次内容生成"
    return "参考资料"


def _source_location(source: ChatMessageSource) -> str:
    parts: list[str] = []
    if source.page_number is not None:
        parts.append(f"第 {source.page_number} 页")
    if source.section_title:
        parts.append(source.section_title)
    if not parts:
        return ""
    return "，" + "，".join(parts)


def _transient_source_location(source) -> str:
    parts: list[str] = []
    if source.page_number is not None:
        parts.append(f"第 {source.page_number} 页")
    if source.section_title:
        parts.append(source.section_title)
    if not parts:
        return ""
    return "，" + "，".join(parts)


def _deterministic_formal_document(markdown: str) -> str:
    return (
        "# 基本信息\n\n"
        "文档来源：AI 对话内容整理。\n\n"
        "# 背景说明\n\n"
        "根据当前聊天内容整理形成本文档。\n\n"
        "# 主要内容\n\n"
        f"{markdown}\n\n"
        "# 风险与注意事项\n\n"
        "根据当前信息，涉及对外承诺、交付周期、验收结论、报价和法律责任的内容需人工复核。"
    )


def _ensure_formal_document_structure(markdown: str) -> str:
    required_markers = ("基本信息", "背景说明", "主要内容", "风险与注意事项")
    if all(marker in markdown for marker in required_markers):
        return markdown
    return _deterministic_formal_document(markdown)


def _export_file_name(title: str, export_type: str) -> str:
    suffix = {
        "single_answer": "当前回答",
        "selected_messages": "选中消息",
        "full_conversation": "完整会话",
        "formal_document": "正式文档",
    }.get(export_type, "聊天导出")
    return f"{title or 'AI 对话'}-{suffix}.docx"
