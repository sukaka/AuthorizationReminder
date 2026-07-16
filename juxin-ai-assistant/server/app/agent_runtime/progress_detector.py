"""Deterministic progress checks that prevent agent loops from spinning."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Sequence


@dataclass(frozen=True)
class ProgressObservation:
    action_type: str
    tool_name: str = ""
    arguments: dict[str, Any] = field(default_factory=dict)
    relevant_revision: int = 0
    strategy: str = "default"
    evidence_delta: int = 0
    artifact_delta: int = 0
    unresolved_delta: int = 0
    error_resolved: bool = False

    @property
    def made_progress(self) -> bool:
        return bool(
            self.evidence_delta > 0
            or self.artifact_delta > 0
            or self.unresolved_delta < 0
            or self.error_resolved
        )


@dataclass(frozen=True)
class ProgressAssessment:
    fingerprint: str
    duplicate_count: int
    low_progress_streak: int
    block_duplicate: bool
    should_replan: bool
    should_stop: bool


class ProgressDetector:
    """Pure detector; callers persist observations as run steps/events."""

    duplicate_action_limit = 2
    no_progress_window = 3
    no_progress_after_replan_limit = 2

    def fingerprint(self, observation: ProgressObservation) -> str:
        try:
            arguments = json.dumps(
                observation.arguments,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
        except (TypeError, ValueError) as exc:
            raise ValueError("progress observation arguments must be JSON serializable") from exc
        raw = "\x1f".join(
            (
                observation.action_type,
                observation.tool_name,
                arguments,
                str(observation.relevant_revision),
            )
        )
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def assess(
        self,
        history: Sequence[ProgressObservation],
        candidate: ProgressObservation,
    ) -> ProgressAssessment:
        candidate_fingerprint = self.fingerprint(candidate)
        duplicate_count = 1
        for previous in reversed(history):
            if self.fingerprint(previous) != candidate_fingerprint:
                break
            duplicate_count += 1

        observations = [*history, candidate]
        last_replan = max(
            (index for index, item in enumerate(observations) if item.action_type == "replan"),
            default=-1,
        )
        relevant = [item for item in observations[last_replan + 1 :] if item.action_type != "replan"]
        low_progress_streak = 0
        for item in reversed(relevant):
            if item.made_progress:
                break
            low_progress_streak += 1

        has_replanned = last_replan >= 0
        return ProgressAssessment(
            fingerprint=candidate_fingerprint,
            duplicate_count=duplicate_count,
            low_progress_streak=low_progress_streak,
            block_duplicate=duplicate_count > self.duplicate_action_limit,
            should_replan=(
                not has_replanned and low_progress_streak >= self.no_progress_window
            ),
            should_stop=(
                has_replanned
                and low_progress_streak >= self.no_progress_after_replan_limit
            ),
        )
