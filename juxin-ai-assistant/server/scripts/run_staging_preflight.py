#!/usr/bin/env python3
"""Read-only preflight for the final staging dual-runtime gate.

The command does not call a remote API and never prints credentials.  It only
checks that the repository, feature flags, optional LangGraph pilot boundary,
authorization mode, and continuous-observation parameters are safe to run.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:  # package import for tests; direct import for `python scripts/foo.py`
    from scripts.observation_policy import (
        DEFAULT_MIN_FINISHED_RUNS,
        DEFAULT_MIN_SUCCESS_RATE,
        DEFAULT_OBSERVATION_DAYS,
    )
    from scripts.staging_auth import normalize_release_id, validate_bearer_transport
except ModuleNotFoundError:  # pragma: no cover - exercised by script entrypoint
    from observation_policy import (
        DEFAULT_MIN_FINISHED_RUNS,
        DEFAULT_MIN_SUCCESS_RATE,
        DEFAULT_OBSERVATION_DAYS,
    )
    from staging_auth import normalize_release_id, validate_bearer_transport


ROOT = Path(__file__).resolve().parents[1]
_ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _check(check_id: str, passed: bool, detail: Any) -> dict[str, Any]:
    return {"id": check_id, "status": "pass" if passed else "fail", "detail": detail}


def _load_flags(root: Path) -> dict[str, Any]:
    path = root / "storage" / "feature_flags.json"
    if not path.exists():
        return {"langgraph_runtime": False, "langgraph_runtime_mode": "shadow"}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"__invalid__": str(path)}
    return value if isinstance(value, dict) else {"__invalid__": str(path)}


def _backend_status(root: Path) -> dict[str, Any]:
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    try:
        from app.agent_runtime.langgraph_runtime import langgraph_backend_status

        return dict(langgraph_backend_status())
    except Exception as exc:  # pragma: no cover - dependency/environment guard
        return {"error": type(exc).__name__}


def _migration_graph_status(root: Path) -> tuple[bool, dict[str, Any]]:
    """Validate the migration graph without opening a database connection."""

    config_path = root / "alembic.ini"
    versions_path = root / "alembic" / "versions"
    detail: dict[str, Any] = {
        "config": str(config_path),
        "versions": str(versions_path),
    }
    if not config_path.is_file():
        detail["reason"] = "missing_config"
        return False, detail
    if not versions_path.is_dir():
        detail["reason"] = "missing_versions_directory"
        return False, detail

    try:
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        script = ScriptDirectory.from_config(Config(str(config_path)))
        heads = sorted(script.get_heads())
        revisions = [revision.revision for revision in script.walk_revisions()]
    except Exception as exc:  # pragma: no cover - exact Alembic errors vary by config
        detail.update({"reason": "unreadable_graph", "error": type(exc).__name__})
        return False, detail

    detail.update(
        {
            "heads": heads,
            "head": heads[0] if len(heads) == 1 else None,
            "revision_count": len(revisions),
        }
    )
    return len(heads) == 1 and bool(revisions), detail


def preflight(
    *,
    root: Path,
    mode: str,
    release_id: str = "",
    bearer_token_env: str = "",
    base_url: str = "https://staging.invalid",
    min_days: int = DEFAULT_OBSERVATION_DAYS,
    min_success_rate: float = DEFAULT_MIN_SUCCESS_RATE,
    min_finished_runs: int = DEFAULT_MIN_FINISHED_RUNS,
) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    spec_path = root / "harness_spec.json"
    try:
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
        modules = spec.get("release_gate", {}).get("required_test_modules", [])
        valid_modules = isinstance(modules, list) and bool(modules) and all(
            isinstance(item, str)
            and item.startswith("tests/")
            and (root / item).is_file()
            for item in modules
        )
        checks.append(_check("harness_spec", valid_modules, {"path": str(spec_path), "modules": len(modules) if isinstance(modules, list) else 0}))
    except (OSError, json.JSONDecodeError, AttributeError):
        spec = {}
        checks.append(_check("harness_spec", False, {"path": str(spec_path)}))

    migration_ok, migration_detail = _migration_graph_status(root)
    checks.append(_check("migration_graph", migration_ok, migration_detail))

    optional = root / "requirements-langgraph-pilot.txt"
    production = root / "requirements.txt"
    optional_text = optional.read_text(encoding="utf-8") if optional.exists() else ""
    production_text = production.read_text(encoding="utf-8") if production.exists() else ""
    checks.append(
        _check(
            "langgraph_dependency_isolation",
            optional.exists() and "langgraph==" in optional_text and "langgraph==" not in production_text,
            {"pilot_file": str(optional), "production_requirements_has_langgraph": "langgraph==" in production_text},
        )
    )

    flags = _load_flags(root)
    backend = _backend_status(root)
    flag_mode = flags.get("langgraph_runtime_mode", "shadow")
    mode_safe = flag_mode in {"shadow", "real"} and not flags.get("__invalid__")
    real_ready = flag_mode != "real" or bool(backend.get("production_ready"))
    checks.append(_check("runtime_mode", mode_safe and real_ready, {"flag_mode": flag_mode, "runtime_enabled": bool(flags.get("langgraph_runtime")), "backend": backend}))

    env_name = bearer_token_env.strip()
    if mode == "staging":
        auth_ok = bool(env_name) and bool(_ENV_NAME.fullmatch(env_name)) and bool(os.environ.get(env_name, "").strip())
        auth_detail = {"mode": mode, "bearer_token_env": env_name or None, "token_present": bool(os.environ.get(env_name, "").strip()) if env_name else False}
    else:
        auth_ok = not env_name or bool(_ENV_NAME.fullmatch(env_name))
        auth_detail = {"mode": mode, "dev_headers_allowed": True, "bearer_token_env": env_name or None}
    checks.append(_check("authorization", auth_ok, auth_detail))

    url = base_url.strip()
    normalized_url: str | None = None
    transport_error: str | None = None
    try:
        # Use a sentinel in staging when the token variable is absent so the
        # URL still receives the same HTTPS/origin checks as an authenticated
        # observation run.  The sentinel is never read from the environment.
        transport_env = env_name or ("__staging_preflight__" if mode == "staging" else "")
        normalized_url = validate_bearer_transport(
            base_url=url,
            bearer_token_env=transport_env,
        )
        url_ok = True
    except ValueError as exc:
        url_ok = False
        transport_error = str(exc)
    checks.append(
        _check(
            "staging_transport",
            url_ok,
            {
                "scheme": url.split(":", 1)[0] if ":" in url else None,
                "https_required": mode == "staging",
                "reason": transport_error,
            },
        )
    )

    normalized_release_id: str | None = None
    release_identity_error: str | None = None
    try:
        normalized_release_id = normalize_release_id(
            release_id,
            required=mode == "staging",
        )
        release_identity_ok = True
    except ValueError as exc:
        release_identity_ok = False
        release_identity_error = str(exc)
    checks.append(
        _check(
            "release_identity",
            release_identity_ok,
            {
                "release_id": normalized_release_id,
                "required": mode == "staging",
                "reason": release_identity_error,
            },
        )
    )

    observe_ok = min_days >= 1 and 0 <= min_success_rate <= 1 and min_finished_runs >= 1
    checks.append(_check("observation_policy", observe_ok, {"min_days": min_days, "min_success_rate": min_success_rate, "min_finished_runs": min_finished_runs}))

    failed = [item["id"] for item in checks if item["status"] == "fail"]
    return {
        "overall": "pass" if not failed else "fail",
        "mode": mode,
        "release_id": normalized_release_id,
        "base_url": normalized_url,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "checks": checks,
        "failed_checks": failed,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only staging dual-runtime preflight")
    parser.add_argument("--mode", choices=("local", "staging"), default="local")
    parser.add_argument("--release-id", default="")
    parser.add_argument("--base-url", default="https://staging.invalid")
    parser.add_argument("--bearer-token-env", default="")
    parser.add_argument("--min-days", type=int, default=DEFAULT_OBSERVATION_DAYS)
    parser.add_argument("--min-success-rate", type=float, default=DEFAULT_MIN_SUCCESS_RATE)
    parser.add_argument("--min-finished-runs", type=int, default=DEFAULT_MIN_FINISHED_RUNS)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    report = preflight(
        root=ROOT,
        mode=args.mode,
        release_id=args.release_id,
        bearer_token_env=args.bearer_token_env,
        base_url=args.base_url,
        min_days=args.min_days,
        min_success_rate=args.min_success_rate,
        min_finished_runs=args.min_finished_runs,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2 if args.json else None))
    return 0 if report["overall"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
