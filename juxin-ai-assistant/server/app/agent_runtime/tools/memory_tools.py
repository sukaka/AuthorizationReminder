from __future__ import annotations

from sqlalchemy import select

from app.agent_runtime import BaseTool, ToolContext, ToolResult
from app.models import UserMemory


class PersonalMemoryTool(BaseTool):
    name = "personal_memory"
    description = "保存、读取或停用当前用户的我的偏好"
    version = "1"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        if context.db is None:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="PERSONAL_MEMORY_DB_REQUIRED",
                error_message_safe="我的偏好需要数据库连接",
            )
        action = str(tool_input.get("action") or "list").strip().lower()
        if action == "save":
            return self._save(tool_input, context)
        if action == "list":
            return self._list(tool_input, context)
        if action == "disable":
            return self._disable(tool_input, context)
        return ToolResult(
            tool_name=self.name,
            status="error",
            error_code="PERSONAL_MEMORY_ACTION_INVALID",
            error_message_safe="不支持的我的偏好操作",
        )

    def _save(self, tool_input: dict, context: ToolContext) -> ToolResult:
        content = " ".join(str(tool_input.get("content") or "").split())
        if not content:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="PERSONAL_MEMORY_CONTENT_REQUIRED",
                error_message_safe="偏好内容不能为空",
            )
        memory_type = str(tool_input.get("memory_type") or "preference").strip()[:32] or "preference"
        record = UserMemory(
            sso_user_id=context.user_id,
            memory_type=memory_type,
            content=content[:1000],
            status="active",
            source=str(tool_input.get("source") or "assistant")[:64],
            metadata_json=dict(tool_input.get("metadata") or {}),
        )
        context.db.add(record)
        context.db.flush()
        return ToolResult(
            tool_name=self.name,
            payload={"memory_id": record.uuid, "memory_type": record.memory_type, "content": record.content},
            output_summary={"action": "save", "memory_type": record.memory_type},
            source_count=1,
        )

    def _list(self, tool_input: dict, context: ToolContext) -> ToolResult:
        memory_type = str(tool_input.get("memory_type") or "").strip()
        limit = max(1, min(int(tool_input.get("limit") or 20), 50))
        statement = select(UserMemory).where(
            UserMemory.sso_user_id == context.user_id,
            UserMemory.status == "active",
        )
        if memory_type:
            statement = statement.where(UserMemory.memory_type == memory_type)
        rows = list(context.db.scalars(statement.order_by(UserMemory.updated_at.desc(), UserMemory.id.desc()).limit(limit)))
        memories = [
            {
                "memory_id": row.uuid,
                "memory_type": row.memory_type,
                "content": row.content,
                "source": row.source,
                "created_at": row.created_at.isoformat() if row.created_at else "",
                "updated_at": row.updated_at.isoformat() if row.updated_at else "",
            }
            for row in rows
        ]
        return ToolResult(
            tool_name=self.name,
            payload={"memories": memories},
            output_summary={"action": "list", "memory_count": len(memories)},
            source_count=len(memories),
        )

    def _disable(self, tool_input: dict, context: ToolContext) -> ToolResult:
        memory_id = str(tool_input.get("memory_id") or "").strip()
        if not memory_id:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="PERSONAL_MEMORY_ID_REQUIRED",
                error_message_safe="请选择要停用的偏好",
            )
        record = context.db.scalar(select(UserMemory).where(
            UserMemory.uuid == memory_id,
            UserMemory.sso_user_id == context.user_id,
        ))
        if record is None:
            return ToolResult(
                tool_name=self.name,
                status="not_found",
                error_code="PERSONAL_MEMORY_NOT_FOUND",
                error_message_safe="偏好不存在或无权访问",
            )
        record.status = "disabled"
        context.db.flush()
        return ToolResult(
            tool_name=self.name,
            payload={"memory_id": record.uuid, "status": record.status},
            output_summary={"action": "disable"},
        )
