from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AgentTaskState


STAGE_LABELS = {
    "analyzing": "正在理解你的需求",
    "retrieving": "正在查找资料",
    "building_context": "正在整理依据",
    "checking_sources": "正在整理依据",
    "generating": "正在生成内容",
    "quality_check": "正在复核结果",
    "completed": "已完成",
    "failed": "生成失败，可重试",
    "cancelled": "已取消",
}


class TaskStateStore:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create(
        self,
        *,
        user_id: str,
        conversation_id: str,
        goal: str,
        stage: str,
        next_action: str,
        selected_sources: list[dict[str, object]] | None = None,
        metadata: dict[str, object] | None = None,
    ) -> AgentTaskState:
        row = AgentTaskState(
            user_id=user_id,
            conversation_id=conversation_id,
            goal=goal[:2000],
            stage=stage,
            selected_sources_json=selected_sources or [],
            tool_calls_json=[],
            verification_status="pending",
            verification_json={},
            next_action=next_action[:256],
            stage_history_json=[self._stage_item(stage, next_action)],
            metadata_json=metadata or {},
            status="active",
        )
        self.db.add(row)
        self.db.flush()
        return row

    def update_stage(
        self,
        task_state_id: str,
        *,
        stage: str,
        next_action: str,
        selected_sources: list[dict[str, object]] | None = None,
    ) -> AgentTaskState:
        row = self._get(task_state_id)
        row.stage = stage
        row.next_action = next_action[:256]
        if selected_sources is not None:
            row.selected_sources_json = selected_sources
        row.stage_history_json = [
            *list(row.stage_history_json or []),
            self._stage_item(stage, next_action),
        ]
        self.db.flush()
        return row

    def mark_completed(
        self,
        task_state_id: str,
        *,
        next_action: str,
    ) -> AgentTaskState:
        row = self.update_stage(
            task_state_id,
            stage="completed",
            next_action=next_action,
        )
        row.status = "completed"
        self.db.flush()
        return row

    def mark_failed(
        self,
        task_state_id: str,
        *,
        reason: str,
        retry_suggestion: str,
    ) -> AgentTaskState:
        row = self.update_stage(
            task_state_id,
            stage="failed",
            next_action=retry_suggestion,
        )
        row.status = "failed"
        row.metadata_json = {
            **(row.metadata_json or {}),
            "failure_reason": reason[:500],
            "retry_suggestion": retry_suggestion[:256],
        }
        self.db.flush()
        return row

    def append_tool_call(
        self,
        task_state_id: str,
        *,
        tool_name: str,
        status: str,
        summary: str,
        error_code: str = "",
        source_count: int | None = None,
    ) -> AgentTaskState:
        row = self._get(task_state_id)
        item: dict[str, object] = {
            "tool_name": tool_name,
            "status": status,
            "summary": summary[:500],
            "error_code": error_code[:64],
        }
        if source_count is not None:
            item["source_count"] = max(0, int(source_count))
        row.tool_calls_json = [
            *list(row.tool_calls_json or []),
            item,
        ]
        self.db.flush()
        return row

    def record_verification(
        self,
        task_state_id: str,
        *,
        status: str,
        summary: str,
        issues: list[str] | None = None,
        details: dict[str, object] | None = None,
    ) -> AgentTaskState:
        row = self._get(task_state_id)
        row.verification_status = status
        row.verification_json = {
            "status": status,
            "summary": summary[:500],
            "issues": issues or [],
            **(details or {}),
        }
        self.db.flush()
        return row

    def public_payload_by_id(self, task_state_id: str) -> dict[str, object]:
        return self.public_payload(self._get(task_state_id))

    def _get(self, task_state_id: str) -> AgentTaskState:
        row = self.db.scalar(
            select(AgentTaskState).where(AgentTaskState.uuid == task_state_id)
        )
        if row is None:
            raise ValueError("task_state_not_found")
        return row

    @staticmethod
    def public_payload(row: AgentTaskState) -> dict[str, object]:
        metadata = row.metadata_json or {}
        return {
            "task_state_id": row.uuid,
            "conversation_id": row.conversation_id,
            "stage": row.stage,
            "status": row.status,
            "label": STAGE_LABELS.get(row.stage, "正在处理"),
            "goal": row.goal,
            "selected_sources": row.selected_sources_json or [],
            "tool_calls": row.tool_calls_json or [],
            "verification_status": row.verification_status,
            "next_action": row.next_action,
            "retry_allowed": row.status == "failed" or row.stage == "failed",
            "failure_reason": str(metadata.get("failure_reason") or ""),
            "stage_history": [
                {
                    **item,
                    "label": STAGE_LABELS.get(str(item.get("stage", "")), "正在处理"),
                }
                for item in (row.stage_history_json or [])
                if isinstance(item, dict)
            ],
        }

    @staticmethod
    def _stage_item(stage: str, next_action: str) -> dict[str, str]:
        return {
            "stage": stage,
            "next_action": next_action[:256],
            "at": datetime.now(UTC).isoformat(),
        }
