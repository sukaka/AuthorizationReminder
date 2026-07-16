"""Load and validate the repository-local agent harness contract."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .agent_contracts import AgentRunStatus
from .run_state_contracts import RUN_STATE_SCHEMA_VERSION


class HarnessSpecError(ValueError):
    pass


_SIDE_EFFECTS = {"idempotent_write", "non_idempotent_write"}
_SPEC_VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")


def harness_spec_path() -> Path:
    return Path(__file__).resolve().parents[1] / "harness_spec.json"


def load_harness_spec(path: Path | None = None) -> dict[str, Any]:
    resolved_path = path or harness_spec_path()
    try:
        payload = json.loads(resolved_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HarnessSpecError("harness_spec_unreadable") from exc
    validate_harness_spec(payload, base_dir=resolved_path.parent)
    return payload


def validate_harness_spec(payload: dict[str, Any], *, base_dir: Path) -> None:
    if not isinstance(payload, dict) or payload.get("schema_version") != "1.0":
        raise HarnessSpecError("harness_spec_schema_version_invalid")
    if not isinstance(payload.get("spec_version"), str) or not _SPEC_VERSION_PATTERN.fullmatch(payload["spec_version"]):
        raise HarnessSpecError("harness_spec_version_invalid")
    run_state = payload.get("run_state", {})
    terminal_statuses = set(run_state.get("terminal_statuses", []))
    expected_terminals = {
        AgentRunStatus.SUCCEEDED.value,
        AgentRunStatus.COMPLETED.value,
        AgentRunStatus.FAILED.value,
        AgentRunStatus.CANCELLED.value,
    }
    if run_state.get("schema_version") != RUN_STATE_SCHEMA_VERSION or terminal_statuses != expected_terminals:
        raise HarnessSpecError("harness_spec_run_state_invalid")
    lease = payload.get("lease", {})
    if lease.get("required_for_runtime_execution") is not True or lease.get("fencing_required_for_guarded_writes") is not True:
        raise HarnessSpecError("harness_spec_lease_guards_required")
    if not isinstance(lease.get("default_ttl_seconds"), int) or lease["default_ttl_seconds"] <= 0:
        raise HarnessSpecError("harness_spec_lease_ttl_invalid")
    tool_contract = payload.get("tool_contract", {})
    if set(tool_contract.get("side_effect_effects", [])) != _SIDE_EFFECTS:
        raise HarnessSpecError("harness_spec_tool_effects_invalid")
    if tool_contract.get("requires_confirmation") is not True or tool_contract.get("requires_idempotency_key") is not True:
        raise HarnessSpecError("harness_spec_tool_guards_required")
    for key in ("max_steps_default", "max_tool_calls_default", "max_retries_default"):
        if not isinstance(payload.get("loop", {}).get(key), int) or payload["loop"][key] < 0:
            raise HarnessSpecError(f"harness_spec_{key}_invalid")
    release_gate = payload.get("release_gate", {})
    required_tests = release_gate.get("required_test_modules", [])
    tests_root = (base_dir / "tests").resolve()
    seen_tests: set[str] = set()
    valid_required_tests = isinstance(required_tests, list) and bool(required_tests)
    for item in required_tests if isinstance(required_tests, list) else []:
        if not isinstance(item, str) or not item or item in seen_tests or Path(item).is_absolute():
            valid_required_tests = False
            break
        candidate = (base_dir / item).resolve()
        if tests_root not in candidate.parents or not candidate.is_file():
            valid_required_tests = False
            break
        seen_tests.add(item)
    if not valid_required_tests:
        raise HarnessSpecError("harness_spec_release_gate_invalid")
