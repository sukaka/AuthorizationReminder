"""Deterministic success-contract evaluation for agent outputs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence


@dataclass(frozen=True)
class SuccessContract:
    required_output_fields: tuple[str, ...] = ("answer",)
    min_answer_chars: int = 1
    require_evidence: bool = False
    allowed_effects: tuple[str, ...] = ("read",)

    def __post_init__(self) -> None:
        if self.min_answer_chars < 0:
            raise ValueError("min_answer_chars must be non-negative")


@dataclass(frozen=True)
class OutcomeEvaluation:
    outcome: str  # pass | revise | blocked | fail
    issue_codes: tuple[str, ...]

    @property
    def passed(self) -> bool:
        return self.outcome == "pass"


class OutcomeEvaluator:
    """Evaluates facts available to the runtime; it does not trust generator claims."""

    def evaluate(
        self,
        contract: SuccessContract,
        *,
        output: Mapping[str, Any],
        evidence_count: int,
        effects: Sequence[str],
    ) -> OutcomeEvaluation:
        issue_codes: list[str] = []
        disallowed = sorted({effect for effect in effects if effect not in contract.allowed_effects})
        if disallowed:
            return OutcomeEvaluation("fail", ("EFFECT_NOT_ALLOWED",))

        for field in contract.required_output_fields:
            value = output.get(field)
            if value is None or (isinstance(value, str) and not value.strip()):
                issue_codes.append(f"REQUIRED_OUTPUT_MISSING:{field}")

        answer = output.get("answer", "")
        if isinstance(answer, str) and len(answer.strip()) < contract.min_answer_chars:
            issue_codes.append("ANSWER_TOO_SHORT")
        if contract.require_evidence and evidence_count <= 0:
            issue_codes.append("EVIDENCE_REQUIRED")

        if issue_codes:
            return OutcomeEvaluation("revise", tuple(issue_codes))
        return OutcomeEvaluation("pass", ())
