"""Deterministic local contract fixture for the Runtime shadow gate.

These records exercise the comparison/reporting contract only. They are not a
substitute for the real 50-task staging evaluation described in the rollout
plan.
"""

from __future__ import annotations

from typing import Any


CONTRACT_CASE_COUNT = 50
CONTRACT_TRIAL_COUNT = 3


def build_contract_fixture(*, trial: int = 1) -> list[dict[str, Any]]:
    """Return one stable, side-effect-free batch of equivalent snapshots."""

    if int(trial) < 1:
        raise ValueError("trial must be a positive integer")

    records: list[dict[str, Any]] = []
    for index in range(1, CONTRACT_CASE_COUNT + 1):
        case_id = (
            f"runtime-contract-{index:02d}"
            if int(trial) == 1
            else f"runtime-contract-t{int(trial)}-{index:02d}"
        )
        baseline = {
            "status": "succeeded",
            "stage": "completed",
            "progress": 100,
            "model_calls": index % 3,
            "result": {
                "kind": "answer",
                "answer": f"fixture-answer-{index:02d}",
                "citations": [],
                "workflow": "contract-fixture",
            },
        }
        candidate = {
            **baseline,
            "result": {**baseline["result"], "runtime": "langgraph_shadow"},
        }
        records.append(
            {
                "case_id": case_id,
                "trial": int(trial),
                "request": {"run_id": case_id, "run_type": "contract-fixture"},
                "baseline": baseline,
                "candidate": candidate,
            }
        )
    return records


def build_contract_trials(*, trials: int = CONTRACT_TRIAL_COUNT) -> list[dict[str, Any]]:
    """Return independent deterministic rounds for the local shadow gate."""

    if int(trials) < 1:
        raise ValueError("trials must be a positive integer")
    records: list[dict[str, Any]] = []
    for trial in range(1, int(trials) + 1):
        records.extend(build_contract_fixture(trial=trial))
    return records
