from __future__ import annotations

from app.context.mode_knowledge_filters import merge_mode_knowledge_filters
from app.knowledge_search import search_knowledge_chunks, search_personal_reference_chunks
from app.models import KnowledgeSearchLog

from ..tool_base import BaseTool, ToolContext, ToolResult


def _personal_search_type(chunks: list) -> str:
    source_kinds = {chunk.source_kind for chunk in chunks}
    if source_kinds == {"session_attachment"}:
        return "session_attachment"
    return "personal_reference"


class CompanyKnowledgeSearchTool(BaseTool):
    name = "company_knowledge_search"
    description = "Search approved company knowledge chunks"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        if context.db is None:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="TOOL_DB_MISSING",
                error_message_safe="工具缺少数据库连接",
            )
        cipher = context.resources.get("cipher")
        if cipher is None:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="TOOL_CIPHER_MISSING",
                error_message_safe="工具缺少内容解密组件",
            )
        query = str(tool_input.get("query") or "")
        mode = str(tool_input.get("mode") or context.mode or "normal")
        categories, document_types = merge_mode_knowledge_filters(mode=mode)
        chunks = search_knowledge_chunks(
            context.db,
            sso_user_id=context.user_id,
            query=query,
            cipher=cipher,
            top_k=tool_input.get("top_k"),
            categories=categories,
            document_types=document_types,
        )
        return ToolResult(
            tool_name=self.name,
            payload={"chunks": chunks, "search_log_ids": []},
            output_summary={"chunk_count": len(chunks), "search_log_ids": []},
            source_count=len(chunks),
        )


class PersonalReferenceSearchTool(BaseTool):
    name = "personal_reference_search"
    description = "Search current user's personal references and session attachments"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        if context.db is None:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="TOOL_DB_MISSING",
                error_message_safe="工具缺少数据库连接",
            )
        cipher = context.resources.get("cipher")
        if cipher is None:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="TOOL_CIPHER_MISSING",
                error_message_safe="工具缺少内容解密组件",
            )
        query = str(tool_input.get("query") or "")
        mode = str(tool_input.get("mode") or context.mode or "normal")
        conversation_id = str(tool_input.get("conversation_id") or context.conversation_id or "")
        file_ids = list(tool_input.get("file_ids") or [])
        include_personal_references = bool(tool_input.get("include_personal_references"))
        include_session_attachments = bool(tool_input.get("include_session_attachments"))
        chunks = search_personal_reference_chunks(
            context.db,
            sso_user_id=context.user_id,
            query=query,
            cipher=cipher,
            conversation_id=conversation_id,
            file_ids=file_ids,
            include_personal_references=include_personal_references,
            include_session_attachments=include_session_attachments,
            top_k=tool_input.get("top_k"),
        )
        search_log = KnowledgeSearchLog(
            user_id=context.user_id,
            question=query[:20_000],
            mode=mode,
            search_type=_personal_search_type(chunks),
            knowledge_base_ids_json=[],
            filters_json={
                "conversation_id": conversation_id,
                "file_ids": file_ids,
                "include_personal_references": include_personal_references,
                "include_session_attachments": include_session_attachments,
            },
            retrieved_chunk_ids_json=[chunk.chunk_id for chunk in chunks],
            answer_message_id="",
        )
        context.db.add(search_log)
        context.db.flush()
        search_log_ids = [search_log.id]
        return ToolResult(
            tool_name=self.name,
            payload={"chunks": chunks, "search_log_ids": search_log_ids},
            output_summary={
                "chunk_count": len(chunks),
                "search_log_ids": search_log_ids,
            },
            source_count=len(chunks),
        )


class CurrentAttachmentSearchTool(BaseTool):
    name = "current_attachment_search"
    description = "Search current conversation attachments only"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        if context.db is None:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="TOOL_DB_MISSING",
                error_message_safe="工具缺少数据库连接",
            )
        cipher = context.resources.get("cipher")
        if cipher is None:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="TOOL_CIPHER_MISSING",
                error_message_safe="工具缺少内容解密组件",
            )
        query = str(tool_input.get("query") or "")
        mode = str(tool_input.get("mode") or context.mode or "normal")
        conversation_id = str(tool_input.get("conversation_id") or context.conversation_id or "")
        file_ids = list(tool_input.get("file_ids") or [])
        chunks = search_personal_reference_chunks(
            context.db,
            sso_user_id=context.user_id,
            query=query,
            cipher=cipher,
            conversation_id=conversation_id,
            file_ids=file_ids,
            include_personal_references=False,
            include_session_attachments=True,
            top_k=tool_input.get("top_k"),
        )
        search_log = KnowledgeSearchLog(
            user_id=context.user_id,
            question=query[:20_000],
            mode=mode,
            search_type="session_attachment",
            knowledge_base_ids_json=[],
            filters_json={
                "conversation_id": conversation_id,
                "file_ids": file_ids,
                "include_personal_references": False,
                "include_session_attachments": True,
            },
            retrieved_chunk_ids_json=[chunk.chunk_id for chunk in chunks],
            answer_message_id="",
        )
        context.db.add(search_log)
        context.db.flush()
        search_log_ids = [search_log.id]
        return ToolResult(
            tool_name=self.name,
            payload={"chunks": chunks, "search_log_ids": search_log_ids},
            output_summary={
                "chunk_count": len(chunks),
                "search_log_ids": search_log_ids,
            },
            source_count=len(chunks),
        )
