from __future__ import annotations

from datetime import datetime

from sqlalchemy import select

from app.models import KnowledgeBase, KnowledgeChunk, KnowledgeFile, KnowledgeReviewLog, WebCapture
from app.schemas import KnowledgeReviewDecisionIn, KnowledgeReviewSubmitIn

from ..tool_base import BaseTool, ToolContext, ToolResult


def _db_missing(tool_name: str) -> ToolResult:
    return ToolResult(
        tool_name=tool_name,
        status="error",
        error_code="TOOL_DB_MISSING",
        error_message_safe="工具缺少数据库连接",
    )


def _file_payload(file_record: KnowledgeFile) -> dict:
    return {
        "file_uuid": file_record.uuid,
        "review_status": file_record.review_status,
        "usage_type": file_record.usage_type,
        "rag_enabled": file_record.rag_enabled,
    }


def _review_summary(file_record: KnowledgeFile, *, action: str) -> dict:
    return {
        "action": action,
        "file_uuid": file_record.uuid,
        "review_status": file_record.review_status,
        "usage_type": file_record.usage_type,
    }


def _add_review_log(
    db,
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


class KnowledgeReviewSubmitTool(BaseTool):
    name = "knowledge_review_submit"
    description = "Submit a personal reference file for administrator review"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        if context.db is None:
            return _db_missing(self.name)
        body = KnowledgeReviewSubmitIn.model_validate(
            {"comment": tool_input.get("comment", "")}
        )
        file_id = str(tool_input.get("file_id") or "").strip()
        file_record = context.db.scalar(
            select(KnowledgeFile).where(
                KnowledgeFile.uuid == file_id,
                KnowledgeFile.owner_user_id == context.user_id,
                KnowledgeFile.usage_type == "personal_reference",
                KnowledgeFile.status != "DELETED",
                KnowledgeFile.deleted_at.is_(None),
                KnowledgeFile.hard_deleted_at.is_(None),
            )
        )
        if file_record is None:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="KNOWLEDGE_FILE_NOT_FOUND",
                error_message_safe="资料不存在或无权访问",
            )

        old_status = file_record.review_status
        file_record.review_status = "pending"
        file_record.rag_enabled = False
        file_record.permission_scope = "private"
        file_record.rag_scope = "personal"
        file_record.review_comment = body.comment.strip()
        _add_review_log(
            context.db,
            file_record=file_record,
            user_id=context.user_id,
            action="submit_review",
            old_status=old_status,
            new_status="pending",
            comment=file_record.review_comment,
        )
        context.db.flush()
        return ToolResult(
            tool_name=self.name,
            payload=_file_payload(file_record),
            output_summary=_review_summary(file_record, action="submit_review"),
            source_count=1,
        )


class KnowledgeReviewApproveTool(BaseTool):
    name = "knowledge_review_approve"
    description = "Approve a pending knowledge file as official knowledge"
    required_permission = "knowledge.review.manage"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        if context.db is None:
            return _db_missing(self.name)
        body = KnowledgeReviewDecisionIn.model_validate(
            {
                "knowledge_base_id": tool_input.get("knowledge_base_id", ""),
                "comment": tool_input.get("comment", ""),
                "permission_scope": tool_input.get("permission_scope", "company"),
                "rag_scope": tool_input.get("rag_scope", "company"),
                "category": tool_input.get("category", ""),
                "document_type": tool_input.get("document_type", ""),
                "tags": tool_input.get("tags", []),
            }
        )
        file_id = str(tool_input.get("file_id") or "").strip()
        file_record = context.db.scalar(
            select(KnowledgeFile).where(
                KnowledgeFile.uuid == file_id,
                KnowledgeFile.review_status == "pending",
                KnowledgeFile.status != "DELETED",
                KnowledgeFile.deleted_at.is_(None),
                KnowledgeFile.hard_deleted_at.is_(None),
            )
        )
        if file_record is None:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="KNOWLEDGE_REVIEW_NOT_FOUND",
                error_message_safe="待审核资料不存在",
            )
        base = context.db.scalar(
            select(KnowledgeBase).where(
                KnowledgeBase.uuid == body.knowledge_base_id.strip(),
                KnowledgeBase.deleted_at.is_(None),
            )
        )
        if base is None or base.scope == "personal":
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="KNOWLEDGE_BASE_INVALID",
                error_message_safe="审核通过必须选择正式资料库",
            )

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
        file_record.reviewed_by = context.user_id
        file_record.reviewed_at = datetime.now()
        file_record.review_comment = body.comment.strip()
        if file_record.source_origin == "web_capture" and file_record.web_capture_id:
            capture = context.db.scalar(
                select(WebCapture).where(WebCapture.uuid == file_record.web_capture_id)
            )
            if capture is not None:
                capture.status = "approved"
                capture.review_status = "approved"
                capture.save_target = "official_knowledge_candidate"
        chunks = context.db.scalars(
            select(KnowledgeChunk).where(KnowledgeChunk.file_id == file_record.id)
        )
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
            context.db,
            file_record=file_record,
            user_id=file_record.owner_user_id or file_record.sso_user_id,
            reviewer_id=context.user_id,
            action="approve",
            old_status=old_status,
            new_status="official",
            comment=file_record.review_comment,
        )
        context.db.flush()
        return ToolResult(
            tool_name=self.name,
            payload=_file_payload(file_record),
            output_summary=_review_summary(file_record, action="approve"),
            source_count=1,
        )


class KnowledgeReviewRejectTool(BaseTool):
    name = "knowledge_review_reject"
    description = "Reject a pending knowledge file and keep it personal"
    required_permission = "knowledge.review.manage"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        if context.db is None:
            return _db_missing(self.name)
        body = KnowledgeReviewSubmitIn.model_validate(
            {"comment": tool_input.get("comment", "")}
        )
        file_id = str(tool_input.get("file_id") or "").strip()
        file_record = context.db.scalar(
            select(KnowledgeFile).where(
                KnowledgeFile.uuid == file_id,
                KnowledgeFile.review_status == "pending",
                KnowledgeFile.status != "DELETED",
                KnowledgeFile.deleted_at.is_(None),
                KnowledgeFile.hard_deleted_at.is_(None),
            )
        )
        if file_record is None:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="KNOWLEDGE_REVIEW_NOT_FOUND",
                error_message_safe="待审核资料不存在",
            )

        old_status = file_record.review_status
        file_record.usage_type = "personal_reference"
        file_record.review_status = "rejected"
        file_record.rag_enabled = False
        file_record.rag_scope = "personal"
        file_record.permission_scope = "private"
        file_record.visibility = "PRIVATE"
        file_record.reviewed_by = context.user_id
        file_record.reviewed_at = datetime.now()
        file_record.review_comment = body.comment.strip()
        if file_record.source_origin == "web_capture" and file_record.web_capture_id:
            capture = context.db.scalar(
                select(WebCapture).where(WebCapture.uuid == file_record.web_capture_id)
            )
            if capture is not None:
                capture.status = "rejected"
                capture.review_status = "rejected"
        _add_review_log(
            context.db,
            file_record=file_record,
            user_id=file_record.owner_user_id or file_record.sso_user_id,
            reviewer_id=context.user_id,
            action="reject",
            old_status=old_status,
            new_status="rejected",
            comment=file_record.review_comment,
        )
        context.db.flush()
        return ToolResult(
            tool_name=self.name,
            payload=_file_payload(file_record),
            output_summary=_review_summary(file_record, action="reject"),
            source_count=1,
        )
