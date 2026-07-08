from __future__ import annotations

from sqlalchemy import or_, select

from app.models import ExperienceLibrary, FailureCaseLibrary, TemplateLibrary

from ..tool_base import BaseTool, ToolContext, ToolResult


def _tags(value) -> list[str]:
    return [str(item).strip()[:64] for item in (value or []) if str(item).strip()][:20]


def _text(value, *, limit: int = 20_000) -> str:
    return str(value or "").strip()[:limit]


def _db_missing(tool_name: str) -> ToolResult:
    return ToolResult(
        tool_name=tool_name,
        status="error",
        error_code="LEARNING_LIBRARY_DB_REQUIRED",
        error_message_safe="学习库需要数据库连接",
    )


class LearningLibraryTool(BaseTool):
    name = "learning_library"
    description = "保存和检索经验库、模板库、失败案例库"
    version = "1"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        if context.db is None:
            return _db_missing(self.name)
        action = str(tool_input.get("action") or "list").strip().lower()
        if action == "save_experience":
            return self._save_experience(tool_input, context)
        if action == "save_template":
            return self._save_template(tool_input, context)
        if action == "save_failure_case":
            return self._save_failure_case(tool_input, context)
        if action == "list":
            return self._list(tool_input, context)
        return ToolResult(
            tool_name=self.name,
            status="error",
            error_code="LEARNING_LIBRARY_ACTION_INVALID",
            error_message_safe="不支持的学习库操作",
        )

    def _save_experience(self, tool_input: dict, context: ToolContext) -> ToolResult:
        record = ExperienceLibrary(
            user_id=context.user_id,
            task_type=_text(tool_input.get("task_type"), limit=64),
            title=_text(tool_input.get("title"), limit=128),
            question=_text(tool_input.get("question")),
            answer=_text(tool_input.get("answer")),
            summary=_text(tool_input.get("summary"), limit=2000),
            tags_json=_tags(tool_input.get("tags")),
            status="active",
        )
        if not record.question or not record.answer:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="EXPERIENCE_CONTENT_REQUIRED",
                error_message_safe="经验需要问题和回答",
            )
        context.db.add(record)
        context.db.flush()
        return ToolResult(
            tool_name=self.name,
            payload={"library": "experience", "item_id": record.uuid, "title": record.title},
            output_summary={"action": "save_experience", "task_type": record.task_type},
            source_count=1,
        )

    def _save_template(self, tool_input: dict, context: ToolContext) -> ToolResult:
        record = TemplateLibrary(
            user_id=context.user_id,
            template_name=_text(tool_input.get("template_name"), limit=128),
            task_type=_text(tool_input.get("task_type"), limit=64),
            template_content=_text(tool_input.get("template_content")),
            variables_json=dict(tool_input.get("variables") or {}),
            scope=_text(tool_input.get("scope") or "personal", limit=24) or "personal",
            review_status="draft",
            status="active",
        )
        if not record.template_name or not record.template_content:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="TEMPLATE_CONTENT_REQUIRED",
                error_message_safe="模板名称和内容不能为空",
            )
        context.db.add(record)
        context.db.flush()
        return ToolResult(
            tool_name=self.name,
            payload={"library": "template", "item_id": record.uuid, "template_name": record.template_name},
            output_summary={"action": "save_template", "task_type": record.task_type, "scope": record.scope},
            source_count=1,
        )

    def _save_failure_case(self, tool_input: dict, context: ToolContext) -> ToolResult:
        record = FailureCaseLibrary(
            user_id=context.user_id,
            task_type=_text(tool_input.get("task_type"), limit=64),
            wrong_answer=_text(tool_input.get("wrong_answer")),
            correction=_text(tool_input.get("correction")),
            prevention_rule=_text(tool_input.get("prevention_rule"), limit=4000),
            tags_json=_tags(tool_input.get("tags")),
            status="active",
        )
        if not record.wrong_answer or not record.correction or not record.prevention_rule:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="FAILURE_CASE_CONTENT_REQUIRED",
                error_message_safe="失败案例需要错误回答、修正内容和防复发规则",
            )
        context.db.add(record)
        context.db.flush()
        return ToolResult(
            tool_name=self.name,
            payload={"library": "failure_case", "item_id": record.uuid},
            output_summary={"action": "save_failure_case", "task_type": record.task_type},
            source_count=1,
        )

    def _list(self, tool_input: dict, context: ToolContext) -> ToolResult:
        library = str(tool_input.get("library") or "experience").strip().lower()
        query = _text(tool_input.get("query"), limit=256)
        limit = max(1, min(int(tool_input.get("limit") or 10), 50))
        if library == "template":
            items = self._list_templates(context, query=query, limit=limit)
        elif library == "failure_case":
            items = self._list_failure_cases(context, query=query, limit=limit)
        else:
            library = "experience"
            items = self._list_experiences(context, query=query, limit=limit)
        return ToolResult(
            tool_name=self.name,
            payload={"library": library, "items": items},
            output_summary={"action": "list", "library": library, "item_count": len(items)},
            source_count=len(items),
        )

    def _list_experiences(self, context: ToolContext, *, query: str, limit: int) -> list[dict]:
        statement = select(ExperienceLibrary).where(
            ExperienceLibrary.user_id == context.user_id,
            ExperienceLibrary.status == "active",
        )
        if query:
            statement = statement.where(or_(
                ExperienceLibrary.title.contains(query),
                ExperienceLibrary.question.contains(query),
                ExperienceLibrary.summary.contains(query),
            ))
        rows = context.db.scalars(statement.order_by(ExperienceLibrary.updated_at.desc(), ExperienceLibrary.id.desc()).limit(limit))
        return [
            {
                "item_id": row.uuid,
                "task_type": row.task_type,
                "title": row.title,
                "question": row.question,
                "answer": row.answer,
                "summary": row.summary,
                "tags": row.tags_json or [],
            }
            for row in rows
        ]

    def _list_templates(self, context: ToolContext, *, query: str, limit: int) -> list[dict]:
        statement = select(TemplateLibrary).where(
            TemplateLibrary.user_id == context.user_id,
            TemplateLibrary.status == "active",
        )
        if query:
            statement = statement.where(or_(
                TemplateLibrary.template_name.contains(query),
                TemplateLibrary.template_content.contains(query),
            ))
        rows = context.db.scalars(statement.order_by(TemplateLibrary.updated_at.desc(), TemplateLibrary.id.desc()).limit(limit))
        return [
            {
                "item_id": row.uuid,
                "task_type": row.task_type,
                "template_name": row.template_name,
                "template_content": row.template_content,
                "variables": row.variables_json or {},
                "scope": row.scope,
                "review_status": row.review_status,
            }
            for row in rows
        ]

    def _list_failure_cases(self, context: ToolContext, *, query: str, limit: int) -> list[dict]:
        statement = select(FailureCaseLibrary).where(
            FailureCaseLibrary.user_id == context.user_id,
            FailureCaseLibrary.status == "active",
        )
        if query:
            statement = statement.where(or_(
                FailureCaseLibrary.wrong_answer.contains(query),
                FailureCaseLibrary.correction.contains(query),
                FailureCaseLibrary.prevention_rule.contains(query),
            ))
        rows = context.db.scalars(statement.order_by(FailureCaseLibrary.updated_at.desc(), FailureCaseLibrary.id.desc()).limit(limit))
        return [
            {
                "item_id": row.uuid,
                "task_type": row.task_type,
                "wrong_answer": row.wrong_answer,
                "correction": row.correction,
                "prevention_rule": row.prevention_rule,
                "tags": row.tags_json or [],
            }
            for row in rows
        ]
