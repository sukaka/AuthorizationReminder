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
from .outcome_evaluator import OutcomeEvaluator, SuccessContract
from .protocol import RunRequest
from .run_quality import check_delivery_quality


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
            if not isinstance(answer, str) or not answer.strip():
                return self._error("EMPTY_NATIVE_RESULT", "NativeRuntime 未生成可交付结果")

            evidence_count = self._evidence_count(result)
            if evidence_count is None:
                return self._error("NATIVE_RESULT_INVALID_EVIDENCE_COUNT", "NativeRuntime 结果的证据数量无效")

            # Re-run the deterministic delivery checks at the graph boundary.
            # The adapter must not treat a succeeded row as proof that the
            # payload is safe to deliver after a crash/replay or legacy write.
            quality = check_delivery_quality(
                answer=answer,
                snippets_used=evidence_count,
                require_citations=evidence_count > 0,
            )
            refused = "未找到明确依据" in answer or "无依据拒答" in answer
            outcome = OutcomeEvaluator().evaluate(
                SuccessContract(min_answer_chars=8, require_evidence=not refused),
                output={"answer": answer},
                evidence_count=evidence_count,
                effects=("read",),
            )
            issues = [*quality.issues, *outcome.issue_codes]
            if issues:
                return {
                    **self._error("NATIVE_RESULT_QUALITY_FAILED", "NativeRuntime 结果未通过最终交付校验"),
                    "quality_issues": issues,
                }
            return {
                "phase": "verified",
                "result": result,
                "outcome": "success",
                "quality": {"passed": True, "evidence_count": evidence_count},
            }
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

    @staticmethod
    def _evidence_count(result: dict[str, Any]) -> int | None:
        raw = result.get("snippet_count", 0)
        try:
            count = int(raw or 0)
        except (TypeError, ValueError):
            return None
        return count if count >= 0 else None

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
