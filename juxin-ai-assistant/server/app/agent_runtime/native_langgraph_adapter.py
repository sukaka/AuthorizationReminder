"""Native business adapter for the LangGraph orchestration pilot.

The adapter deliberately keeps the NativeRuntime multi-agent implementation as
the single business source of truth.  LangGraph owns phase ordering and durable
thread checkpoints, while this module translates the existing run projection
into the graph state contract.  Splitting retrieval/write/review into separate
implementations can happen later behind these same boundaries.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..agent_contracts import AgentRunStatus
from ..models import AgentRun
from .native_runtime import NativeRuntime
from .protocol import RunRequest


@dataclass
class NativeLangGraphAdapter:
    """Expose NativeRuntime behavior as four idempotent graph callbacks."""

    runtime: NativeRuntime
    row: AgentRun
    request: RunRequest

    def prepare(self, state: dict[str, Any]) -> dict[str, Any]:
        if self.row.status == AgentRunStatus.SUCCEEDED.value:
            return {"phase": "prepared", "result": self._result()}
        if self.row.cancel_requested:
            return self._error("RUN_CANCELLED", "任务已取消")
        self.runtime.service.mark_running(self.row)
        return {"phase": "prepared"}

    def execute(self, state: dict[str, Any]) -> dict[str, Any]:
        if self.row.status == AgentRunStatus.SUCCEEDED.value:
            return self._success_state()
        if self.row.status == AgentRunStatus.FAILED.value:
            return self._row_error()
        if self.row.status == AgentRunStatus.CANCELLED.value:
            return self._error("RUN_CANCELLED", "任务已取消")

        # The NativeRuntime owns retrieval, writing, review, artifact creation,
        # budget handling and durable run facts.  Do not duplicate those rules
        # in the graph callback.
        self.runtime._execute_multi_agent_path(self.row, self.request)
        if self.row.status == AgentRunStatus.SUCCEEDED.value:
            return self._success_state()
        if self.row.status == AgentRunStatus.CANCELLED.value:
            return self._error("RUN_CANCELLED", "任务已取消")
        return self._row_error()

    def verify(self, state: dict[str, Any]) -> dict[str, Any]:
        if self.row.status == AgentRunStatus.SUCCEEDED.value:
            result = self._result()
            answer = result.get("answer")
            if isinstance(answer, str) and answer.strip():
                return {"phase": "verified", "result": result, "outcome": "success"}
            return self._error("EMPTY_NATIVE_RESULT", "NativeRuntime 未生成可交付结果")
        return self._row_error()

    def finish(self, state: dict[str, Any]) -> dict[str, Any]:
        if self.row.status == AgentRunStatus.SUCCEEDED.value:
            return {"phase": "completed", "result": self._result()}
        if self.row.status == AgentRunStatus.FAILED.value:
            return self._row_error()
        if self.row.status == AgentRunStatus.CANCELLED.value:
            return self._error("RUN_CANCELLED", "任务已取消")
        return self._error("NATIVE_PHASE_INCOMPLETE", "NativeRuntime 阶段未完成")

    def _result(self) -> dict[str, Any]:
        return dict(self.row.result_json) if isinstance(self.row.result_json, dict) else {}

    def _success_state(self) -> dict[str, Any]:
        result = self._result()
        return {
            "phase": "executed",
            "result": result,
            "evidence_count": int(result.get("snippet_count") or 0),
            "effects": ["read"],
        }

    def _row_error(self) -> dict[str, Any]:
        return self._error(
            str(self.row.error_code or "NATIVE_RUNTIME_FAILED"),
            str(self.row.error_message_safe or "任务执行失败"),
        )

    @staticmethod
    def _error(code: str, message: str) -> dict[str, Any]:
        return {
            "phase": "failed",
            "error_code": code,
            "error_message_safe": message,
        }
