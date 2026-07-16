from app.agent_runtime.loop_kernel import LoopKernel, LoopKernelInput


def test_loop_kernel_pauses_for_confirmation_before_any_side_effect() -> None:
    decision = LoopKernel().decide(
        LoopKernelInput(
            step_count=1,
            tool_calls=0,
            retries=0,
            confirmation_required=True,
        )
    )

    assert decision.action == "pause"
    assert decision.code == "CONFIRMATION_REQUIRED"


def test_loop_kernel_stops_cancelled_and_exhausted_runs() -> None:
    kernel = LoopKernel()

    cancelled = kernel.decide(
        LoopKernelInput(step_count=0, tool_calls=0, retries=0, cancel_requested=True)
    )
    exhausted = kernel.decide(
        LoopKernelInput(step_count=5, tool_calls=0, retries=0, max_steps=5)
    )

    assert (cancelled.action, cancelled.code) == ("cancel", "CANCEL_REQUESTED")
    assert (exhausted.action, exhausted.code) == ("fail", "STEP_BUDGET_EXCEEDED")


def test_loop_kernel_converges_only_after_output_passes_quality() -> None:
    kernel = LoopKernel()

    continue_decision = kernel.decide(
        LoopKernelInput(
            step_count=2,
            tool_calls=1,
            retries=0,
            has_output=True,
            quality_passed=False,
            quality_risk="medium",
        )
    )
    completed = kernel.decide(
        LoopKernelInput(
            step_count=2,
            tool_calls=1,
            retries=0,
            has_output=True,
            quality_passed=True,
        )
    )

    assert (continue_decision.action, continue_decision.code) == ("continue", "QUALITY_REPAIR_REQUIRED")
    assert (completed.action, completed.code) == ("complete", "QUALITY_PASSED")


def test_loop_kernel_fails_high_risk_output_and_retry_exhaustion() -> None:
    kernel = LoopKernel()

    high_risk = kernel.decide(
        LoopKernelInput(
            step_count=2,
            tool_calls=1,
            retries=0,
            has_output=True,
            quality_passed=False,
            quality_risk="high",
        )
    )
    retries_exhausted = kernel.decide(
        LoopKernelInput(step_count=2, tool_calls=1, retries=2, max_retries=2)
    )

    assert (high_risk.action, high_risk.code) == ("fail", "QUALITY_HIGH_RISK")
    assert (retries_exhausted.action, retries_exhausted.code) == ("fail", "RETRY_BUDGET_EXCEEDED")


def test_loop_kernel_blocks_duplicate_actions_and_converges_low_progress() -> None:
    kernel = LoopKernel()

    duplicate = kernel.decide(
        LoopKernelInput(step_count=1, tool_calls=1, retries=0, duplicate_action_count=3)
    )
    assert (duplicate.action, duplicate.code) == ("fail", "DUPLICATE_ACTION_BLOCKED")

    replan = kernel.decide(
        LoopKernelInput(step_count=2, tool_calls=1, retries=0, low_progress_streak=3)
    )
    assert (replan.action, replan.code) == ("continue", "REPLAN_REQUIRED")

    stalled = kernel.decide(
        LoopKernelInput(
            step_count=2,
            tool_calls=1,
            retries=0,
            low_progress_streak=2,
            has_replanned=True,
        )
    )
    assert (stalled.action, stalled.code) == ("fail", "NO_PROGRESS_AFTER_REPLAN")
