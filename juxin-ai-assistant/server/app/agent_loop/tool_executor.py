from sqlalchemy.orm import Session

from app.agent_runtime import ToolContext, ToolRegistry
from app.agent_runtime.tools import (
    CompanyKnowledgeSearchTool,
    CurrentAttachmentSearchTool,
    DocumentStructureValidateTool,
    DocumentTemplateSelectTool,
    UserFeedbackTool,
    FileParseTool,
    HistoryTaskTool,
    KnowledgeReviewApproveTool,
    KnowledgeReviewRejectTool,
    KnowledgeReviewSubmitTool,
    PersonalMemoryTool,
    PersonalReferenceSearchTool,
    ReferenceSourceValidateTool,
    TaskModeDetectTool,
    WebCaptureTool,
    WebSearchTool,
    WordExportTool,
)
from app.context.prompt_loader import PromptLoader
from app.config import get_settings
from app.crypto import ContentCipher
from app.knowledge_embedding import build_embedding_service

from .types import ToolResult


class ToolExecutor:
    def __init__(
        self,
        *,
        db: Session,
        sso_user_id: str,
        cipher: ContentCipher,
        top_k: int | None,
        prompt_loader: PromptLoader | None = None,
    ) -> None:
        self.db = db
        self.sso_user_id = sso_user_id
        self.cipher = cipher
        self.top_k = top_k
        self.prompt_loader = prompt_loader or PromptLoader()
        self.embedding_service = build_embedding_service(db, get_settings())
        self.registry = ToolRegistry()
        self.registry.register(CompanyKnowledgeSearchTool())
        self.registry.register(CurrentAttachmentSearchTool())
        self.registry.register(DocumentStructureValidateTool())
        self.registry.register(DocumentTemplateSelectTool())
        self.registry.register(UserFeedbackTool())
        self.registry.register(FileParseTool())
        self.registry.register(HistoryTaskTool())
        self.registry.register(KnowledgeReviewApproveTool())
        self.registry.register(KnowledgeReviewRejectTool())
        self.registry.register(KnowledgeReviewSubmitTool())
        self.registry.register(PersonalMemoryTool())
        self.registry.register(PersonalReferenceSearchTool())
        self.registry.register(ReferenceSourceValidateTool())
        self.registry.register(TaskModeDetectTool())
        self.registry.register(WebCaptureTool())
        self.registry.register(WebSearchTool())
        self.registry.register(WordExportTool())

    def _context(self, *, mode: str = "", conversation_id: str = "") -> ToolContext:
        return ToolContext(
            user_id=self.sso_user_id,
            db=self.db,
            permissions=set(),
            resources={
                "cipher": self.cipher,
                "embedding_service": self.embedding_service,
            },
            mode=mode,
            conversation_id=conversation_id,
        )

    def search_knowledge_base(self, query: str, *, mode: str = "normal") -> ToolResult:
        result = self.registry.execute(
            "company_knowledge_search",
            {"query": query, "mode": mode, "top_k": self.top_k},
            self._context(mode=mode),
        )
        chunks = list(result.payload.get("chunks", []))
        error = result.error_message_safe if result.status != "success" else ""
        return ToolResult(name="search_knowledge_base", query=query, chunks=chunks, error=error)

    def search_personal_references(
        self,
        query: str,
        *,
        mode: str = "normal",
        conversation_id: str | None = None,
        file_ids: list[str] | None = None,
        include_personal_references: bool = False,
        include_session_attachments: bool = False,
    ) -> ToolResult:
        result = self.registry.execute(
            "personal_reference_search",
            {
                "query": query,
                "mode": mode,
                "conversation_id": conversation_id or "",
                "file_ids": list(file_ids or []),
                "include_personal_references": include_personal_references,
                "include_session_attachments": include_session_attachments,
                "top_k": self.top_k,
            },
            self._context(mode=mode, conversation_id=conversation_id or ""),
        )
        chunks = list(result.payload.get("chunks", []))
        search_log_ids = list(result.payload.get("search_log_ids", []))
        error = result.error_message_safe if result.status != "success" else ""
        return ToolResult(
            name="search_personal_references",
            query=query,
            chunks=chunks,
            search_log_ids=search_log_ids,
            error=error,
        )

    def search_current_attachments(
        self,
        query: str,
        *,
        mode: str = "normal",
        conversation_id: str | None = None,
        file_ids: list[str] | None = None,
    ) -> ToolResult:
        result = self.registry.execute(
            "current_attachment_search",
            {
                "query": query,
                "mode": mode,
                "conversation_id": conversation_id or "",
                "file_ids": list(file_ids or []),
                "top_k": self.top_k,
            },
            self._context(mode=mode, conversation_id=conversation_id or ""),
        )
        chunks = list(result.payload.get("chunks", []))
        search_log_ids = list(result.payload.get("search_log_ids", []))
        error = result.error_message_safe if result.status != "success" else ""
        return ToolResult(
            name="search_current_attachments",
            query=query,
            chunks=chunks,
            search_log_ids=search_log_ids,
            error=error,
        )

    def read_file_chunk(self, chunk_id: str, chunks: list) -> ToolResult:
        for chunk in chunks:
            if chunk.chunk_id == chunk_id:
                return ToolResult(
                    name="read_file_chunk",
                    query=chunk_id,
                    chunks=[chunk],
                    content=chunk.chunk_text,
                )
        return ToolResult(name="read_file_chunk", query=chunk_id, error="chunk not found")

    def get_prompt_template(self, mode: str) -> ToolResult:
        return ToolResult(
            name="get_prompt_template",
            query=mode,
            content=self.prompt_loader.role_prompt(mode),
        )

    def get_company_profile(self) -> ToolResult:
        return ToolResult(
            name="get_company_profile",
            content=self.prompt_loader.company_profile(),
        )
