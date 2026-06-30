from sqlalchemy.orm import Session

from app.context.mode_knowledge_filters import merge_mode_knowledge_filters
from app.context.prompt_loader import PromptLoader
from app.crypto import ContentCipher
from app.knowledge_search import search_knowledge_chunks, search_personal_reference_chunks
from app.models import KnowledgeSearchLog

from .types import ToolResult


def _personal_search_type(chunks: list) -> str:
    source_kinds = {chunk.source_kind for chunk in chunks}
    if source_kinds == {"session_attachment"}:
        return "session_attachment"
    return "personal_reference"


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

    def search_knowledge_base(self, query: str, *, mode: str = "normal") -> ToolResult:
        categories, document_types = merge_mode_knowledge_filters(mode=mode)
        try:
            chunks = search_knowledge_chunks(
                self.db,
                sso_user_id=self.sso_user_id,
                query=query,
                cipher=self.cipher,
                top_k=self.top_k,
                categories=categories,
                document_types=document_types,
            )
            return ToolResult(name="search_knowledge_base", query=query, chunks=chunks)
        except Exception as exc:  # pragma: no cover - defensive degradation path
            return ToolResult(name="search_knowledge_base", query=query, error=str(exc))

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
        try:
            chunks = search_personal_reference_chunks(
                self.db,
                sso_user_id=self.sso_user_id,
                query=query,
                cipher=self.cipher,
                conversation_id=conversation_id,
                file_ids=file_ids,
                include_personal_references=include_personal_references,
                include_session_attachments=include_session_attachments,
                top_k=self.top_k,
            )
            log = KnowledgeSearchLog(
                user_id=self.sso_user_id,
                question=query[:20_000],
                mode=mode,
                search_type=_personal_search_type(chunks),
                knowledge_base_ids_json=[],
                filters_json={
                    "conversation_id": conversation_id or "",
                    "file_ids": list(file_ids or []),
                    "include_personal_references": include_personal_references,
                    "include_session_attachments": include_session_attachments,
                },
                retrieved_chunk_ids_json=[chunk.chunk_id for chunk in chunks],
                answer_message_id="",
            )
            self.db.add(log)
            self.db.flush()
            return ToolResult(
                name="search_personal_references",
                query=query,
                chunks=chunks,
                search_log_ids=[log.id],
            )
        except Exception as exc:  # pragma: no cover - defensive degradation path
            return ToolResult(name="search_personal_references", query=query, error=str(exc))

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
