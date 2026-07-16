import json
import re
from pathlib import Path

import pytest

from app.agent_contracts import AgentRunStatus
from app.agent_runtime.loop_kernel import LoopKernel, LoopKernelInput
from app.harness_spec import HarnessSpecError, load_harness_spec, validate_harness_spec
from app.run_state_contracts import RUN_STATE_SCHEMA_VERSION


HARNESS_PLAN = Path(__file__).resolve().parents[2] / "docs" / "plans" / "2026-07-13-agent-loop-harness-stability-plan.md"


def test_harness_spec_matches_runtime_stability_contract() -> None:
    path = Path(__file__).resolve().parents[1] / "harness_spec.json"
    spec = json.loads(path.read_text(encoding="utf-8"))

    assert spec["schema_version"] == "1.0"
    assert spec["spec_version"] == "1.0.0"
    assert spec["run_state"]["schema_version"] == RUN_STATE_SCHEMA_VERSION
    assert set(spec["run_state"]["terminal_statuses"]) == {
        AgentRunStatus.SUCCEEDED.value,
        AgentRunStatus.COMPLETED.value,
        AgentRunStatus.FAILED.value,
        AgentRunStatus.CANCELLED.value,
    }
    assert spec["lease"]["default_ttl_seconds"] == 20
    assert spec["tool_contract"]["side_effect_effects"] == [
        "idempotent_write",
        "non_idempotent_write",
    ]
    assert spec["loop"]["max_steps_default"] == 32
    assert spec["loop"]["max_tool_calls_default"] == 8
    assert spec["loop"]["max_retries_default"] == 2

    decision = LoopKernel().decide(
        LoopKernelInput(
            step_count=1,
            tool_calls=0,
            retries=0,
            has_output=True,
            quality_passed=False,
            quality_risk="high",
        )
    )
    assert decision.action == spec["loop"]["high_risk_output"]

    for relative_path in spec["release_gate"]["required_test_modules"]:
        assert (path.parent / relative_path).is_file()

    assert load_harness_spec(path) == spec


def test_harness_spec_rejects_invalid_tool_contract(tmp_path: Path) -> None:
    payload = {
        "schema_version": "1.0",
        "spec_version": "1.0.0",
        "run_state": {
            "schema_version": RUN_STATE_SCHEMA_VERSION,
            "terminal_statuses": ["succeeded", "completed", "failed", "cancelled"],
        },
        "lease": {
            "required_for_runtime_execution": True,
            "fencing_required_for_guarded_writes": True,
            "default_ttl_seconds": 20,
        },
        "tool_contract": {
            "side_effect_effects": ["write"],
            "requires_confirmation": True,
            "requires_idempotency_key": True,
        },
        "loop": {"max_steps_default": 1, "max_tool_calls_default": 1, "max_retries_default": 0},
        "release_gate": {"required_test_modules": ["gate.py"]},
    }
    (tmp_path / "gate.py").write_text("", encoding="utf-8")
    path = tmp_path / "harness_spec.json"
    path.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(HarnessSpecError, match="harness_spec_tool_effects_invalid"):
        load_harness_spec(path)


def _valid_spec_with_modules(modules: list[str]) -> dict:
    spec = json.loads(
        (Path(__file__).resolve().parents[1] / "harness_spec.json").read_text(encoding="utf-8")
    )
    spec["release_gate"]["required_test_modules"] = modules
    return spec


def test_harness_spec_accepts_unique_test_modules_under_tests(tmp_path: Path) -> None:
    tests_root = tmp_path / "tests"
    tests_root.mkdir()
    (tests_root / "test_example.py").write_text("", encoding="utf-8")

    validate_harness_spec(
        _valid_spec_with_modules(["tests/test_example.py"]),
        base_dir=tmp_path,
    )


def test_harness_plan_yaml_example_has_unique_stop_rules_key() -> None:
    text = HARNESS_PLAN.read_text(encoding="utf-8")
    section = text.split("## 9. HarnessSpec v1", 1)[1].split("HarnessSpec 必须 Schema 校验", 1)[0]
    blocks = re.findall(r"```yaml\n(.*?)\n```", section, flags=re.DOTALL)

    assert len(blocks) == 1
    yaml_example = blocks[0]
    assert len(re.findall(r"^stop_rules:\s*$", yaml_example, flags=re.MULTILINE)) == 1
    assert "duplicate_action_limit: 2" in yaml_example
    assert "no_progress_window: 3" in yaml_example


@pytest.mark.parametrize(
    "modules",
    [
        ["../outside.py"],
        ["tests/../outside.py"],
        [str(Path("/tmp/absolute-test.py"))],
        ["tests/test_example.py", "tests/test_example.py"],
    ],
)
def test_harness_spec_rejects_unsafe_or_duplicate_test_modules(
    tmp_path: Path, modules: list[str]
) -> None:
    tests_root = tmp_path / "tests"
    tests_root.mkdir()
    (tests_root / "test_example.py").write_text("", encoding="utf-8")

    with pytest.raises(HarnessSpecError, match="harness_spec_release_gate_invalid"):
        validate_harness_spec(_valid_spec_with_modules(modules), base_dir=tmp_path)
