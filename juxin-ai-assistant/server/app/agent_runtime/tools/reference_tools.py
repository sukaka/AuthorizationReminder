from __future__ import annotations

from types import SimpleNamespace

from sqlalchemy import select

from app.models import ChatMessageSource
from app.reference_matching import source_is_mentioned

from ..tool_base import BaseTool, ToolContext, ToolResult


def _source_to_payload(source) -> dict:
    return {
        "source_type": str(getattr(source, "source_type", "")),
        "source_uuid": str(getattr(source, "source_uuid", "")),
        "file_name": str(getattr(source, "file_name", "")),
        "title": str(getattr(source, "title", "")),
        "chunk_id": str(getattr(source, "chunk_id", "")),
        "page_number": getattr(source, "page_number", None),
        "section_title": str(getattr(source, "section_title", "")),
        "chunk_index": getattr(source, "chunk_index", None),
        "score": int(getattr(source, "score", 0) or 0),
    }


def _source_from_dict(value: dict) -> SimpleNamespace:
    return SimpleNamespace(
        source_type=str(value.get("source_type") or ""),
        source_uuid=str(value.get("source_uuid") or value.get("file_id") or ""),
        file_name=str(value.get("file_name") or ""),
        title=str(value.get("title") or value.get("file_name") or ""),
        chunk_id=str(value.get("chunk_id") or ""),
        page_number=value.get("page_number"),
        section_title=str(value.get("section_title") or ""),
        chunk_index=value.get("chunk_index"),
        score=int(value.get("score") or 0),
    )


class ReferenceSourceValidateTool(BaseTool):
    name = "reference_source_validate"
    description = "Keep only reference sources that are actually mentioned in the answer"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        answer = str(tool_input.get("answer") or "")
        delete_unmentioned = bool(tool_input.get("delete_unmentioned"))
        message_id = tool_input.get("message_id")
        if message_id and context.db is not None:
            sources = list(
                context.db.scalars(
                    select(ChatMessageSource)
                    .where(ChatMessageSource.message_id == int(message_id))
                    .order_by(ChatMessageSource.id.asc())
                )
            )
        else:
            sources = [
                _source_from_dict(source)
                for source in list(tool_input.get("sources") or [])
                if isinstance(source, dict)
            ]

        kept = [source for source in sources if source_is_mentioned(source, answer)]
        if delete_unmentioned and context.db is not None:
            kept_ids = {getattr(source, "id", None) for source in kept}
            for source in sources:
                source_id = getattr(source, "id", None)
                if source_id is not None and source_id not in kept_ids:
                    context.db.delete(source)
            context.db.flush()

        payload_sources = [_source_to_payload(source) for source in kept]
        removed_count = max(0, len(sources) - len(kept))
        return ToolResult(
            tool_name=self.name,
            payload={
                "sources": payload_sources,
                "kept_count": len(kept),
                "removed_count": removed_count,
            },
            output_summary={
                "kept_count": len(kept),
                "removed_count": removed_count,
            },
            source_count=len(kept),
        )
