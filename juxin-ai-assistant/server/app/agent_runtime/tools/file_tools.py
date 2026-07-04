from __future__ import annotations

from fastapi import HTTPException

from app.knowledge_files import (
    MAX_KNOWLEDGE_FILE_BYTES,
    _extract_blocks,
    _safe_file_name,
    chunk_blocks,
)

from ..tool_base import BaseTool, ToolContext, ToolResult


class FileParseTool(BaseTool):
    name = "file_parse"
    description = "Parse supported office files into structured text chunks without persisting them"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        file_name = _safe_file_name(str(tool_input.get("file_name") or ""))
        raw_content = tool_input.get("content_bytes")
        if raw_content is None:
            content_text = str(tool_input.get("content_text") or "")
            raw_content = content_text.encode("utf-8")
        if isinstance(raw_content, str):
            raw_content = raw_content.encode("utf-8")
        if not isinstance(raw_content, bytes):
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="FILE_CONTENT_INVALID",
                error_message_safe="文件内容格式无效",
            )
        if len(raw_content) > MAX_KNOWLEDGE_FILE_BYTES:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="FILE_TOO_LARGE",
                error_message_safe="文件过大，请压缩或拆分后再上传",
            )
        try:
            blocks = _extract_blocks(file_name, raw_content)
            chunks = chunk_blocks(blocks)
        except HTTPException as exc:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="FILE_PARSE_FAILED",
                error_message_safe=str(exc.detail),
            )
        payload_chunks = [
            {
                "chunk_id": "",
                "file_id": "",
                "file_name": file_name,
                "chunk_text": chunk.text,
                "page_number": chunk.page_number,
                "section_title": chunk.section_title,
                "chunk_index": chunk.chunk_index,
                "chunk_type": chunk.chunk_type,
                "metadata": chunk.metadata or {},
            }
            for chunk in chunks
        ]
        section_titles = [
            chunk.section_title
            for chunk in chunks
            if chunk.section_title
        ][:10]
        return ToolResult(
            tool_name=self.name,
            payload={
                "file_name": file_name,
                "chunk_count": len(chunks),
                "chunks": payload_chunks,
            },
            output_summary={
                "file_name": file_name,
                "chunk_count": len(chunks),
                "section_titles": section_titles,
            },
            source_count=len(chunks),
        )
