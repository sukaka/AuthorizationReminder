"""Single transition authority for agent-run lifecycle changes."""

from __future__ import annotations


class InvalidRunTransition(ValueError):
    """Raised when a lifecycle transition violates recovery semantics."""


class AgentRunStateMachine:
    _KNOWN = frozenset(
        {
            "created", "queued", "running", "waiting_user", "waiting_confirmation", "paused",
            "retrying", "succeeded", "completed", "failed", "cancelled",
        }
    )
    _ALLOWED = {
        "created": frozenset({"queued", "running", "succeeded", "failed", "cancelled"}),
        "queued": frozenset({"running", "cancelled", "failed"}),
        "running": frozenset(
            {"waiting_user", "waiting_confirmation", "paused", "succeeded", "completed", "failed", "cancelled"}
        ),
        "waiting_user": frozenset({"running", "paused", "failed", "cancelled"}),
        "waiting_confirmation": frozenset({"running", "paused", "failed", "cancelled"}),
        "paused": frozenset({"running", "failed", "cancelled"}),
        "retrying": frozenset({"running", "failed", "cancelled"}),
        "failed": frozenset({"retrying"}),
        "cancelled": frozenset({"retrying"}),
        "succeeded": frozenset(),
        "completed": frozenset(),
    }

    @classmethod
    def transition(cls, current: str, target: str) -> str:
        if current not in cls._KNOWN:
            raise InvalidRunTransition(f"unknown run status: {current}")
        if target not in cls._KNOWN:
            raise InvalidRunTransition(f"unknown run status: {target}")
        if target not in cls._ALLOWED[current]:
            raise InvalidRunTransition(f"invalid run transition: {current} -> {target}")
        return target
