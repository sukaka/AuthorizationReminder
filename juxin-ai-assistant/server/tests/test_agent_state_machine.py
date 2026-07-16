from __future__ import annotations

import pytest

from app.agent_state_machine import AgentRunStateMachine, InvalidRunTransition


def test_terminal_state_cannot_return_to_running() -> None:
    with pytest.raises(InvalidRunTransition, match="succeeded -> running"):
        AgentRunStateMachine.transition("succeeded", "running")


def test_retry_is_an_explicit_terminal_state_exception() -> None:
    assert AgentRunStateMachine.transition("failed", "retrying") == "retrying"
    assert AgentRunStateMachine.transition("cancelled", "retrying") == "retrying"


def test_state_transition_rejects_unknown_status() -> None:
    with pytest.raises(InvalidRunTransition, match="unknown run status"):
        AgentRunStateMachine.transition("mystery", "running")
