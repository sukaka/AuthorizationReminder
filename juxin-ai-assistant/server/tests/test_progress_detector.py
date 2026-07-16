from app.agent_runtime.progress_detector import ProgressDetector, ProgressObservation


def test_same_action_is_blocked_before_an_unconditional_third_attempt() -> None:
    detector = ProgressDetector()
    first = ProgressObservation(action_type="tool", tool_name="knowledge.search", arguments={"q": "年假"})
    second = ProgressObservation(action_type="tool", tool_name="knowledge.search", arguments={"q": "年假"})
    candidate = ProgressObservation(action_type="tool", tool_name="knowledge.search", arguments={"q": "年假"})

    assessment = detector.assess([first, second], candidate)

    assert assessment.fingerprint == detector.fingerprint(candidate)
    assert assessment.duplicate_count == 3
    assert assessment.block_duplicate is True


def test_new_evidence_resets_low_progress_streak() -> None:
    detector = ProgressDetector()
    history = [
        ProgressObservation(action_type="plan", evidence_delta=0),
        ProgressObservation(action_type="tool", tool_name="search", evidence_delta=0),
        ProgressObservation(action_type="tool", tool_name="search", evidence_delta=2),
    ]

    assessment = detector.assess(history, ProgressObservation(action_type="write", artifact_delta=1))

    assert assessment.low_progress_streak == 0
    assert assessment.should_replan is False
    assert assessment.should_stop is False


def test_three_low_progress_steps_require_replanning_then_stop_after_replan() -> None:
    detector = ProgressDetector()
    before_replan = [
        ProgressObservation(action_type="tool", tool_name="search"),
        ProgressObservation(action_type="tool", tool_name="search", arguments={"page": 2}),
    ]
    replan = detector.assess(before_replan, ProgressObservation(action_type="tool", tool_name="search", arguments={"page": 3}))
    assert replan.low_progress_streak == 3
    assert replan.should_replan is True
    assert replan.should_stop is False

    after_replan = before_replan + [
        ProgressObservation(action_type="replan", strategy="broaden"),
        ProgressObservation(action_type="tool", tool_name="search", strategy="broaden"),
    ]
    stop = detector.assess(
        after_replan,
        ProgressObservation(action_type="tool", tool_name="search", arguments={"page": 2}, strategy="broaden"),
    )
    assert stop.low_progress_streak == 2
    assert stop.should_stop is True
