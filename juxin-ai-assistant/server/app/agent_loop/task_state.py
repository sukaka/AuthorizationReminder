from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AgentTaskState


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

    def append_tool_call(
        self,
        task_state_id: str,
        *,
        tool_name: str,
        status: str,
        summary: str,
        error_code: str = "",
    ) -> AgentTaskState:
        row = self._get(task_state_id)
        row.tool_calls_json = [
            *list(row.tool_calls_json or []),
            {
                "tool_name": tool_name,
                "status": status,
                "summary": summary[:500],
                "error_code": error_code[:64],
            },
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
    ) -> AgentTaskState:
        row = self._get(task_state_id)
        row.verification_status = status
        row.verification_json = {
            "status": status,
            "summary": summary[:500],
            "issues": issues or [],
        }
        self.db.flush()
        return row

    def _get(self, task_state_id: str) -> AgentTaskState:
        row = self.db.scalar(
            select(AgentTaskState).where(AgentTaskState.uuid == task_state_id)
        )
        if row is None:
            raise ValueError("task_state_not_found")
        return row

    @staticmethod
    def _stage_item(stage: str, next_action: str) -> dict[str, str]:
        return {
            "stage": stage,
            "next_action": next_action[:256],
            "at": datetime.now(UTC).isoformat(),
        }
