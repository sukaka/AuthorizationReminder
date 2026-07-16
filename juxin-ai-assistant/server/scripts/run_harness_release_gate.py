#!/usr/bin/env python3
"""Execute the regression modules declared by ``harness_spec.json``."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]


def release_gate_test_modules(spec: dict[str, Any], *, root: Path = ROOT) -> list[str]:
    release_gate = spec.get("release_gate")
    modules = release_gate.get("required_test_modules") if isinstance(release_gate, dict) else None
    if not isinstance(modules, list) or not modules:
        raise ValueError("harness_release_gate_modules_invalid")

    tests_root = (root / "tests").resolve()
    validated: list[str] = []
    seen_modules: set[str] = set()
    for module in modules:
        if not isinstance(module, str) or not module or module in seen_modules:
            raise ValueError("harness_release_gate_module_invalid")
        candidate = (root / module).resolve()
        if tests_root not in candidate.parents or not candidate.is_file():
            raise ValueError(f"harness_release_gate_module_invalid:{module}")
        validated.append(module)
        seen_modules.add(module)
    return validated


def build_pytest_command(
    spec: dict[str, Any],
    *,
    root: Path = ROOT,
    python_executable: str | None = None,
) -> list[str]:
    return [
        python_executable or sys.executable,
        "-m",
        "pytest",
        *release_gate_test_modules(spec, root=root),
        "-q",
    ]


def load_harness_spec(*, root: Path = ROOT) -> dict[str, Any]:
    spec_path = root / "harness_spec.json"
    try:
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("harness_release_gate_spec_invalid") from exc
    if not isinstance(spec, dict):
        raise ValueError("harness_release_gate_spec_invalid")
    return spec


def run_release_gate(
    *,
    root: Path = ROOT,
    spec: dict[str, Any] | None = None,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> dict[str, Any]:
    resolved_spec = spec if spec is not None else load_harness_spec(root=root)
    command = build_pytest_command(resolved_spec, root=root)
    completed = runner(command, cwd=root, text=True, capture_output=True, check=False)
    return {
        "status": "passed" if completed.returncode == 0 else "failed",
        "command": command,
        "returncode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run tests declared in harness_spec.json")
    parser.add_argument("--dry-run", action="store_true", help="Print the resolved command without running it")
    args = parser.parse_args()

    try:
        spec = load_harness_spec()
        command = build_pytest_command(spec)
        if args.dry_run:
            print(json.dumps({"status": "dry_run", "command": command}, ensure_ascii=False))
            return 0
        report = run_release_gate(spec=spec)
    except ValueError as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}, ensure_ascii=False))
        return 1

    print(json.dumps(report, ensure_ascii=False))
    return int(report["returncode"])


if __name__ == "__main__":
    raise SystemExit(main())
