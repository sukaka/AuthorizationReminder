"""Deterministic convergence decisions for agent execution loops."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LoopKernelInput:
    step_count: int
    tool_calls: int
    retries: int
    max_steps: int = 32
    max_tool_calls: int = 8
    max_retries: int = 2
    cancel_requested: bool = False
    confirmation_required: bool = False
    has_output: bool = False
    quality_passed: bool = False
    quality_risk: str = "low"
    duplicate_action_count: int = 0
    low_progress_streak: int = 0
    has_replanned: bool = False


@dataclass(frozen=True)
class LoopDecision:
    action: str  # continue | pause | complete | fail | cancel
    code: str
    message: str


class LoopKernel:
    """Pure state reducer: every loop iteration reaches one explicit outcome."""

    def decide(self, state: LoopKernelInput) -> LoopDecision:
        if state.cancel_requested:
            return LoopDecision("cancel", "CANCEL_REQUESTED", "任务已取消")
        if state.confirmation_required:
            return LoopDecision("pause", "CONFIRMATION_REQUIRED", "等待用户确认")
        if state.duplicate_action_count > 2:
            return LoopDecision("fail", "DUPLICATE_ACTION_BLOCKED", "重复动作已达到阻断阈值")
        if state.has_replanned and state.low_progress_streak >= 2:
            return LoopDecision("fail", "NO_PROGRESS_AFTER_REPLAN", "重新规划后仍未取得进展")
        if not state.has_replanned and state.low_progress_streak >= 3:
            return LoopDecision("continue", "REPLAN_REQUIRED", "连续无进展，需要重新规划")
        if state.step_count >= state.max_steps:
            return LoopDecision("fail", "STEP_BUDGET_EXCEEDED", "已达到最大执行步骤数")
        if state.tool_calls >= state.max_tool_calls:
            return LoopDecision("fail", "TOOL_BUDGET_EXCEEDED", "已达到最大工具调用数")
        if state.retries >= state.max_retries:
            return LoopDecision("fail", "RETRY_BUDGET_EXCEEDED", "已达到最大重试次数")
        if state.has_output and state.quality_passed:
            return LoopDecision("complete", "QUALITY_PASSED", "质量检查通过")
        if state.has_output and state.quality_risk == "high":
            return LoopDecision("fail", "QUALITY_HIGH_RISK", "高风险质量问题阻止交付")
        if state.has_output:
            return LoopDecision("continue", "QUALITY_REPAIR_REQUIRED", "需要修复输出质量")
        return LoopDecision("continue", "WORK_REMAINING", "继续执行下一步")
