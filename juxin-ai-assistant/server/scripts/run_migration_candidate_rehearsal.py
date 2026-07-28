#!/usr/bin/env python3
"""Replay migration-head candidates in disposable SQLite databases.

This is a local, fail-closed rehearsal.  It copies ``alembic/`` to a temporary
directory, applies one candidate-only graph change there, and checks both
``upgrade head`` and ``downgrade base``.  No repository migration file,
staging database, or network endpoint is touched.

Usage::

  AUTH_DEV_BYPASS=true AI_LOCAL_BINDING_SECRET="$LOCAL_SECRET" \
    python scripts/run_migration_candidate_rehearsal.py --json

The local secret is only used to satisfy application settings while Alembic
imports model metadata.  It is never printed or persisted by this command.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import logging
import os
import shutil
import sys
import tempfile
from contextlib import contextmanager, redirect_stderr
from pathlib import Path
from typing import Any, Iterator


ROOT = Path(__file__).resolve().parents[1]
# Keep the expected head explicit so a newly-added migration cannot silently
# make the current candidate look stale.
_WORKSPACE_HEAD = "0067_project_member_usernames"
_CANDIDATES = ("current", "candidate_a", "candidate_b")


def _ensure_server_import_path() -> None:
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))


def _local_config_error() -> str | None:
    if os.environ.get("AUTH_DEV_BYPASS", "").strip().lower() != "true":
        return "AUTH_DEV_BYPASS=true 是本地迁移演练的必需条件"
    if len(os.environ.get("AI_LOCAL_BINDING_SECRET", "").strip()) < 32:
        return "AI_LOCAL_BINDING_SECRET 至少需要 32 个字符；请通过环境变量提供本地测试密钥"
    return None


@contextmanager
def _quiet_alembic() -> Iterator[None]:
    """Keep Alembic's routine log output out of machine-readable evidence."""

    previous_disable = logging.root.manager.disable
    logging.disable(logging.CRITICAL)
    try:
        with redirect_stderr(io.StringIO()):
            yield
    finally:
        logging.disable(previous_disable)


def _error_detail(exc: BaseException) -> dict[str, str]:
    message = str(exc).replace(str(ROOT), "[server]").strip()
    if len(message) > 300:
        message = f"{message[:297]}..."
    return {"type": type(exc).__name__, "message": message}


def _repository_snapshot() -> str:
    digest = hashlib.sha256()
    source_files = [ROOT / "alembic.ini", *sorted((ROOT / "alembic" / "versions").glob("*.py"))]
    for path in source_files:
        digest.update(str(path.relative_to(ROOT)).encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


def _copy_candidate_tree(workdir: Path, candidate: str) -> Path:
    candidate_root = workdir / candidate
    candidate_root.mkdir()
    shutil.copy2(ROOT / "alembic.ini", candidate_root / "alembic.ini")
    shutil.copytree(
        ROOT / "alembic",
        candidate_root / "alembic",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )

    if candidate == "candidate_a":
        migration = candidate_root / "alembic" / "versions" / "0046_project_workspace_foundation.py"
        source = migration.read_text(encoding="utf-8")
        expected = 'down_revision = "0026_agent_run_contracts"'
        if source.count(expected) != 1:
            raise RuntimeError("candidate_a 只允许替换 0046 的当前父 revision")
        migration.write_text(
            source.replace(
                expected,
                'down_revision = "0045_agent_langgraph_checkpoints"',
                1,
            ),
            encoding="utf-8",
        )
    elif candidate == "candidate_b":
        merge = candidate_root / "alembic" / "versions" / "0057_migration_candidate_merge.py"
        merge.write_text(
            f'''"""temporary merge revision used only by the local rehearsal."""

revision = "0057_migration_candidate_merge"
down_revision = "{_WORKSPACE_HEAD}"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
''',
            encoding="utf-8",
        )
    elif candidate != "current":
        raise ValueError(f"unsupported candidate: {candidate}")
    return candidate_root


def _graph_heads(config_path: Path) -> list[str]:
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    script = ScriptDirectory.from_config(Config(str(config_path)))
    return sorted(script.get_heads())


def _run_upgrade_and_downgrade(candidate_root: Path, workdir: Path) -> dict[str, Any]:
    from alembic import command
    from alembic.config import Config

    database_path = workdir / f"{candidate_root.name}.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    config = Config(str(candidate_root / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", database_url)
    result: dict[str, Any] = {
        "upgrade": {"status": "not_run"},
        "downgrade": {"status": "not_run"},
    }
    try:
        with _quiet_alembic():
            command.upgrade(config, "head")
        result["upgrade"] = {"status": "pass"}
    except Exception as exc:  # Alembic exception types vary by backend/version.
        result["upgrade"] = {"status": "fail", "error": _error_detail(exc)}
        return result

    try:
        with _quiet_alembic():
            command.downgrade(config, "base")
        result["downgrade"] = {"status": "pass"}
    except Exception as exc:  # Alembic exception types vary by backend/version.
        result["downgrade"] = {"status": "fail", "error": _error_detail(exc)}
    return result


def _candidate_passed(candidate: str, heads: list[str], result: dict[str, Any]) -> bool:
    if candidate == "current":
        return (
            heads == [_WORKSPACE_HEAD]
            and result.get("upgrade", {}).get("status") == "pass"
            and result.get("downgrade", {}).get("status") == "pass"
        )
    return (
        len(heads) == 1
        and result.get("upgrade", {}).get("status") == "pass"
        and result.get("downgrade", {}).get("status") == "pass"
    )


def _candidate_failure(candidate: str, exc: BaseException) -> dict[str, Any]:
    """Turn an unexpected rehearsal-internal error into evidence, not a crash."""

    return {
        "name": candidate,
        "heads": [],
        "upgrade": {"status": "not_run"},
        "downgrade": {"status": "not_run"},
        "status": "fail",
        "expectation": "fail_closed" if candidate == "current" else "round_trip",
        "error": _error_detail(exc),
    }


def _rehearsal_failure(
    error: dict[str, str],
    *,
    candidates: list[dict[str, Any]] | None = None,
    repository_unchanged: bool = False,
) -> dict[str, Any]:
    """Return a stable top-level failure when setup/cleanup fails."""

    return {
        "schema": 1,
        "mode": "local_temp_only",
        "overall": "fail",
        "error": error,
        "candidates": candidates or [],
        "repository_unchanged": repository_unchanged,
        "staging_or_network_used": False,
    }


def _repository_is_unchanged(before: str) -> bool:
    try:
        return before == _repository_snapshot()
    except Exception:
        return False


def run_rehearsal() -> dict[str, Any]:
    """Run all candidates and return an evidence-safe report."""

    _ensure_server_import_path()
    config_error = _local_config_error()
    if config_error:
        return _rehearsal_failure(
            {"type": "LocalConfigError", "message": config_error},
            repository_unchanged=True,
        )

    reports: list[dict[str, Any]] = []
    try:
        repository_before = _repository_snapshot()
    except Exception as exc:
        return _rehearsal_failure(_error_detail(exc))

    try:
        with tempfile.TemporaryDirectory(prefix="juxin-migration-rehearsal-") as directory:
            workdir = Path(directory)
            for candidate in _CANDIDATES:
                try:
                    candidate_root = _copy_candidate_tree(workdir, candidate)
                    config_path = candidate_root / "alembic.ini"
                    heads = _graph_heads(config_path)
                    result = _run_upgrade_and_downgrade(candidate_root, workdir)
                    reports.append(
                        {
                            "name": candidate,
                            "heads": heads,
                            "upgrade": result["upgrade"],
                            "downgrade": result["downgrade"],
                            "status": "pass" if _candidate_passed(candidate, heads, result) else "fail",
                            "expectation": "fail_closed" if candidate == "current" else "round_trip",
                        }
                    )
                except Exception as exc:  # Keep machine-readable fail-closed output on harness errors.
                    reports.append(_candidate_failure(candidate, exc))
    except Exception as exc:
        return _rehearsal_failure(
            _error_detail(exc),
            candidates=reports,
            repository_unchanged=_repository_is_unchanged(repository_before),
        )

    try:
        repository_after = _repository_snapshot()
    except Exception as exc:
        return _rehearsal_failure(
            _error_detail(exc),
            candidates=reports,
            repository_unchanged=False,
        )
    repository_unchanged = repository_before == repository_after
    return {
        "schema": 1,
        "mode": "local_temp_only",
        "overall": "pass"
        if repository_unchanged and all(item["status"] == "pass" for item in reports)
        else "fail",
        "repository_unchanged": repository_unchanged,
        "staging_or_network_used": False,
        "candidates": reports,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="本地临时迁移候选回放，不连接 staging/生产")
    parser.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    args = parser.parse_args()
    report = run_rehearsal()
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"migration rehearsal: {report['overall']}")
        for candidate in report.get("candidates", []):
            print(
                f"- {candidate['name']}: {candidate['status']} "
                f"(upgrade={candidate['upgrade']['status']}, "
                f"downgrade={candidate['downgrade']['status']})"
            )
        if report.get("error"):
            print(f"- error: {report['error']['message']}")
    return 0 if report["overall"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
