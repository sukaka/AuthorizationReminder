from __future__ import annotations

import sys
from pathlib import Path

import pytest

from scripts.run_harness_release_gate import (
    build_pytest_command,
    load_harness_spec,
    release_gate_test_modules,
    run_release_gate,
)


def _write_test_module(root: Path, name: str = "test_example.py") -> str:
    path = root / "tests" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("def test_example():\n    assert True\n", encoding="utf-8")
    return f"tests/{name}"


def test_release_gate_builds_pytest_command_from_spec(tmp_path: Path) -> None:
    module = _write_test_module(tmp_path)
    spec = {"release_gate": {"required_test_modules": [module]}}

    modules = release_gate_test_modules(spec, root=tmp_path)
    command = build_pytest_command(spec, root=tmp_path, python_executable="python-test")

    assert modules == [module]
    assert command == ["python-test", "-m", "pytest", module, "-q"]


@pytest.mark.parametrize(
    "modules",
    [
        [],
        ["tests/missing.py"],
        ["../outside.py"],
        ["not-tests/test_example.py"],
        ["tests/test_example.py", "tests/test_example.py"],
    ],
)
def test_release_gate_rejects_invalid_or_missing_modules(tmp_path: Path, modules: list[str]) -> None:
    _write_test_module(tmp_path)
    spec = {"release_gate": {"required_test_modules": modules}}

    with pytest.raises(ValueError, match="harness_release_gate"):
        release_gate_test_modules(spec, root=tmp_path)


def test_release_gate_runs_exactly_the_modules_declared_in_spec(tmp_path: Path) -> None:
    module = _write_test_module(tmp_path)
    spec = {"release_gate": {"required_test_modules": [module]}}
    calls: list[tuple[list[str], dict[str, object]]] = []

    class Completed:
        returncode = 0
        stdout = "1 passed"
        stderr = ""

    def fake_runner(command: list[str], **kwargs: object) -> Completed:
        calls.append((command, kwargs))
        return Completed()

    report = run_release_gate(root=tmp_path, spec=spec, runner=fake_runner)

    assert report["status"] == "passed"
    assert calls == [
        (
            [sys.executable, "-m", "pytest", module, "-q"],
            {"cwd": tmp_path, "text": True, "capture_output": True, "check": False},
        )
    ]


def test_repository_release_gate_covers_required_runtime_contracts() -> None:
    spec = load_harness_spec()

    assert "tests/test_ops_run_control.py" in spec["release_gate"]["required_test_modules"]
    assert "tests/test_core_task_evidence.py" in spec["release_gate"][
        "required_test_modules"
    ]
