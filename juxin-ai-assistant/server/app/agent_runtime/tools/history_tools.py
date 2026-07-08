from __future__ import annotations

from sqlalchemy import select

from app.agent_runtime import BaseTool, ToolContext, ToolResult
from app.crypto import EncryptedPayload
from app.models import ChatMessage, ChatSession


def _datetime(value) -> str:
    return value.isoformat() if value else ""


class HistoryTaskTool(BaseTool):
    name = "history_task"
    description = "读取当前用户的历史任务列表或详情"
    version = "1"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        if context.db is None:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="HISTORY_TASK_DB_REQUIRED",
                error_message_safe="历史任务需要数据库连接",
            )
        action = str(tool_input.get("action") or "list").strip().lower()
        if action == "list":
            return self._list(tool_input, context)
        if action in {"detail", "read", "resume"}:
            return self._detail(tool_input, context)
        return ToolResult(
            tool_name=self.name,
            status="error",
            error_code="HISTORY_TASK_ACTION_INVALID",
            error_message_safe="不支持的历史任务操作",
        )

    def _list(self, tool_input: dict, context: ToolContext) -> ToolResult:
        status = str(tool_input.get("status") or "active").strip() or "active"
        limit = max(1, min(int(tool_input.get("limit") or 20), 50))
        rows = list(context.db.scalars(
            select(ChatSession)
            .where(ChatSession.sso_user_id == context.user_id, ChatSession.status == status)
            .order_by(ChatSession.updated_at.desc(), ChatSession.id.desc())
            .limit(limit)
        ))
        payload_items = [
            {
                "session_uuid": row.uuid,
                "title": row.title,
                "mode": row.mode,
                "status": row.status,
                "created_at": _datetime(row.created_at),
                "updated_at": _datetime(row.updated_at),
            }
            for row in rows
        ]
        return ToolResult(
            tool_name=self.name,
            payload={"items": payload_items, "total": len(payload_items)},
            output_summary={"action": "list", "count": len(payload_items), "status": status},
            source_count=len(payload_items),
        )

    def _detail(self, tool_input: dict, context: ToolContext) -> ToolResult:
        cipher = context.resources.get("cipher")
        if cipher is None:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="HISTORY_TASK_CIPHER_REQUIRED",
                error_message_safe="读取历史任务需要内容解密能力",
            )
        conversation_id = str(tool_input.get("conversation_id") or context.conversation_id or "").strip()
        if not conversation_id:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="HISTORY_TASK_ID_REQUIRED",
                error_message_safe="请选择历史任务",
            )
        session = context.db.scalar(select(ChatSession).where(
            ChatSession.uuid == conversation_id,
            ChatSession.sso_user_id == context.user_id,
            ChatSession.status.in_(["active", "archived"]),
        ))
        if session is None:
            return ToolResult(
                tool_name=self.name,
                status="not_found",
                error_code="HISTORY_TASK_NOT_FOUND",
                error_message_safe="聊天会话不存在或无权访问",
            )
        rows = list(context.db.scalars(
            select(ChatMessage)
            .where(ChatMessage.session_id == session.id)
            .order_by(ChatMessage.id.asc())
        ))
        session = {
            "session_uuid": session.uuid,
            "title": session.title,
            "mode": session.mode,
            "status": session.status,
            "created_at": _datetime(session.created_at),
            "updated_at": _datetime(session.updated_at),
        }
        messages = []
        for row in rows:
            content = ""
            if row.content_ciphertext is not None and row.content_nonce is not None:
                payload = cipher.decrypt_json(
                    EncryptedPayload(row.content_ciphertext, row.content_nonce),
                    row.uuid.encode(),
                )
                content = str(payload.get("content") or "")
            messages.append({
                "message_uuid": row.uuid,
                "role": row.role,
                "content": content,
                "status": row.status,
                "created_at": _datetime(row.created_at),
                "finished_at": _datetime(row.finished_at),
            })
        return ToolResult(
            tool_name=self.name,
            payload={"session": session, "messages": messages},
            output_summary={"action": "detail", "message_count": len(messages)},
            source_count=len(messages),
        )
