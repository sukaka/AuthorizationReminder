from __future__ import annotations

from sqlalchemy import select

from app.models import KnowledgeFile

from ..tool_base import BaseTool, ToolContext, ToolResult


def _suggest_category(file_record: KnowledgeFile) -> str:
    haystack = f"{file_record.file_name} {file_record.summary} {' '.join(file_record.tags_json or [])}"
    if any(keyword in haystack for keyword in ("白皮书", "产品", "WDSP", "平台", "手册")):
        return "产品资料"
    if any(keyword in haystack for keyword in ("验收", "交付", "实施", "部署", "培训")):
        return "项目交付"
    if any(keyword in haystack for keyword in ("投标", "标书", "响应文件", "报价")):
        return "销售商务"
    if any(keyword in haystack for keyword in ("巡检", "漏洞", "加固", "应急", "运维")):
        return "安全运维"
    if any(keyword in haystack for keyword in ("会议", "纪要")):
        return "会议纪要"
    return "其他"


def _suggest_document_type(file_record: KnowledgeFile) -> str:
    haystack = f"{file_record.file_name} {file_record.summary} {' '.join(file_record.tags_json or [])}"
    if "白皮书" in haystack:
        return "产品白皮书"
    if any(keyword in haystack for keyword in ("解决方案", "方案")):
        return "解决方案"
    if any(keyword in haystack for keyword in ("投标", "标书", "响应文件")):
        return "投标模板"
    if any(keyword in haystack for keyword in ("验收", "验收报告")):
        return "验收报告"
    if any(keyword in haystack for keyword in ("会议", "纪要")):
        return "会议纪要"
    if any(keyword in haystack for keyword in ("手册", "管理员")):
        return "管理员手册"
    return "其他"


def _issues_for(file_record: KnowledgeFile, suggested_category: str, suggested_document_type: str) -> list[str]:
    issues: list[str] = []
    if file_record.category in ("", "其他", "个人素材") and suggested_category != file_record.category:
        issues.append("资料分类可优化")
    if file_record.document_type in ("", "其他") and suggested_document_type != file_record.document_type:
        issues.append("文档类型可优化")
    if not (file_record.summary or "").strip():
        issues.append("缺少摘要")
    if not file_record.tags_json:
        issues.append("缺少标签")
    if file_record.parse_status != "parsed":
        issues.append("解析未完成")
    if file_record.index_status != "indexed":
        issues.append("索引未完成")
    if file_record.review_status == "pending":
        issues.append("待管理员审核")
    return issues


class BulkKnowledgeGovernanceTool(BaseTool):
    name = "bulk_knowledge_governance"
    description = "Scan current user's knowledge files and suggest metadata cleanup actions"
    version = "1"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        if context.db is None:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="TOOL_DB_MISSING",
                error_message_safe="工具缺少数据库连接",
            )
        limit = max(1, min(int(tool_input.get("limit") or 50), 100))
        rows = context.db.scalars(
            select(KnowledgeFile)
            .where(
                KnowledgeFile.owner_user_id == context.user_id,
                KnowledgeFile.status != "DELETED",
                KnowledgeFile.deleted_at.is_(None),
                KnowledgeFile.hard_deleted_at.is_(None),
            )
            .order_by(KnowledgeFile.updated_at.desc(), KnowledgeFile.id.desc())
            .limit(limit)
        ).all()

        suggestions: list[dict] = []
        for file_record in rows:
            suggested_category = _suggest_category(file_record)
            suggested_document_type = _suggest_document_type(file_record)
            issues = _issues_for(file_record, suggested_category, suggested_document_type)
            if not issues:
                continue
            suggestions.append(
                {
                    "file_id": file_record.uuid,
                    "file_name": file_record.file_name,
                    "current_category": file_record.category,
                    "suggested_category": suggested_category,
                    "current_document_type": file_record.document_type,
                    "suggested_document_type": suggested_document_type,
                    "issues": issues,
                    "review_status": file_record.review_status,
                    "parse_status": file_record.parse_status,
                    "index_status": file_record.index_status,
                }
            )

        payload = {
            "scanned_count": len(rows),
            "needs_action_count": len(suggestions),
            "suggestions": suggestions,
        }
        return ToolResult(
            tool_name=self.name,
            payload=payload,
            output_summary={
                "scanned_count": payload["scanned_count"],
                "needs_action_count": payload["needs_action_count"],
            },
            source_count=len(suggestions),
        )
