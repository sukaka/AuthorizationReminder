#!/usr/bin/env python3
"""Run the local-only 4.0 workflow release gate.

The gate exercises the shipped migration path in disposable SQLite files:

* ``expand`` upgrades to 0055 and proves the 0056 columns are not required yet;
* ``migrate`` upgrades to the 0056 head and checks fencing/wait indexes plus
  preservation of a legacy trigger and V1 workflow row;
* ``switch`` writes an isolated feature-flag file with the worker disabled and
  proves the scheduler step does not open a DB or call ``tick``;
* ``contract`` downgrades to 0055 and checks the new columns are removed;
* ``fresh_round_trip`` performs a clean head/base round trip in another file.

No shared database, staging endpoint, provider, or network is used.  The
local auth environment variables only satisfy application settings imported by
Alembic; their values are never printed or persisted.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import io
import json
import logging
import os
import sys
import tempfile
from contextlib import contextmanager, redirect_stderr
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Iterator

from sqlalchemy import create_engine, inspect, text


ROOT = Path(__file__).resolve().parents[1]
_EXPAND_REVISION = "0055_workflow_control_plane"
_CURRENT_WORKSPACE_HEAD = "0064_knowledge_external_download_control"
_TRIGGER_NEW_COLUMNS = {"lease_owner", "lease_token", "lease_expires_at"}
_WAIT_NEW_COLUMNS = {"resume_token_hash", "resume_expires_at"}
_TRIGGER_NEW_INDEXES = {
    "ix_ai_workflow_trigger_inbox_lease_owner",
    "ix_ai_workflow_trigger_inbox_lease_expires_at",
}
_WAIT_NEW_INDEXES = {"ix_ai_workflow_waits_resume_expires_at"}


def _ensure_server_import_path() -> None:
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))


def _local_config_error() -> str | None:
    if os.environ.get("AUTH_DEV_BYPASS", "").strip().lower() != "true":
        return "AUTH_DEV_BYPASS=true 是本地 4.0 发布门禁的必需条件"
    if len(os.environ.get("AI_LOCAL_BINDING_SECRET", "").strip()) < 32:
        return "AI_LOCAL_BINDING_SECRET 至少需要 32 个字符；请通过环境变量提供本地测试密钥"
    return None


@contextmanager
def _quiet_alembic() -> Iterator[None]:
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


def _migration_config(database_url: str):
    from alembic.config import Config

    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def _migration_heads(config) -> list[str]:
    from alembic.script import ScriptDirectory

    return sorted(ScriptDirectory.from_config(config).get_heads())


def _columns(engine, table: str) -> set[str]:
    return {column["name"] for column in inspect(engine).get_columns(table)}


def _indexes(engine, table: str) -> set[str]:
    return {index["name"] for index in inspect(engine).get_indexes(table)}


def _seed_legacy_rows(engine) -> None:
    """Insert rows using the 0055/V1 shape before the 0056 migration."""

    legacy_definition = {
        "id": "legacy_v1",
        "name": "旧 V1 流程",
        "description": "migration gate fixture",
        "steps": [{"id": "set_title", "type": "set", "params": {"key": "title", "value": "ok"}}],
    }
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO ai_workflow_trigger_inbox
                    (uuid, owner_user_id, workflow_id, event_type, event_key, payload_json)
                VALUES
                    (:uuid, :owner_user_id, :workflow_id, :event_type, :event_key, :payload_json)
                """
            ),
            {
                "uuid": "legacy-trigger-release-gate",
                "owner_user_id": "owner-v1",
                "workflow_id": "legacy_v1",
                "event_type": "manual",
                "event_key": "legacy-event",
                "payload_json": json.dumps({"input_text": "legacy"}),
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO ai_workflow_definitions
                    (uuid, workflow_id, owner_user_id, name, description, status, current_version)
                VALUES
                    (:uuid, :workflow_id, :owner_user_id, :name, :description, :status, :current_version)
                """
            ),
            {
                "uuid": "legacy-definition-release-gate",
                "workflow_id": "legacy_v1",
                "owner_user_id": "owner-v1",
                "name": "旧 V1 流程",
                "description": "migration gate fixture",
                "status": "published",
                "current_version": 1,
            },
        )
        definition_id = connection.execute(
            text("SELECT id FROM ai_workflow_definitions WHERE workflow_id = :workflow_id"),
            {"workflow_id": "legacy_v1"},
        ).scalar_one()
        connection.execute(
            text(
                """
                INSERT INTO ai_workflow_versions
                    (uuid, workflow_definition_id, version, definition_json, status, created_by)
                VALUES
                    (:uuid, :workflow_definition_id, :version, :definition_json, :status, :created_by)
                """
            ),
            {
                "uuid": "legacy-version-release-gate",
                "workflow_definition_id": definition_id,
                "version": 1,
                "definition_json": json.dumps(legacy_definition, ensure_ascii=False),
                "status": "published",
                "created_by": "legacy-v1",
            },
        )


def _check_legacy_rows(engine) -> dict[str, bool]:
    with engine.connect() as connection:
        trigger = connection.execute(
            text(
                """
                SELECT owner_user_id, workflow_id, payload_json, lease_owner, lease_token, lease_expires_at
                FROM ai_workflow_trigger_inbox
                WHERE uuid = :uuid
                """
            ),
            {"uuid": "legacy-trigger-release-gate"},
        ).mappings().one()
        version = connection.execute(
            text(
                """
                SELECT d.workflow_id, v.definition_json, v.version, v.created_by
                FROM ai_workflow_definitions d
                JOIN ai_workflow_versions v ON v.workflow_definition_id = d.id
                WHERE d.workflow_id = :workflow_id
                """
            ),
            {"workflow_id": "legacy_v1"},
        ).mappings().one()

    trigger_preserved = (
        trigger["owner_user_id"] == "owner-v1"
        and trigger["workflow_id"] == "legacy_v1"
        and trigger["lease_owner"] == ""
        and trigger["lease_token"] == 0
        and trigger["lease_expires_at"] is None
    )
    raw_definition = version["definition_json"]
    if isinstance(raw_definition, str):
        raw_definition = json.loads(raw_definition)
    v1_preserved = (
        version["workflow_id"] == "legacy_v1"
        and version["version"] == 1
        and version["created_by"] == "legacy-v1"
        and isinstance(raw_definition, dict)
        and raw_definition.get("steps")
    )
    if v1_preserved:
        _ensure_server_import_path()
        from app.workflow_engine import _normalize_workflow_definition

        try:
            normalized = _normalize_workflow_definition(raw_definition)
        except Exception:
            v1_preserved = False
        else:
            v1_preserved = normalized["id"] == "legacy_v1" and len(normalized["steps"]) == 1
    return {
        "legacy_trigger_preserved": trigger_preserved,
        "legacy_v1_workflow_preserved": v1_preserved,
    }


def _check_legacy_rows_after_contract(engine) -> bool:
    """Check that rollback removes only 0056 fields, not legacy payloads."""

    with engine.connect() as connection:
        trigger = connection.execute(
            text(
                """
                SELECT owner_user_id, workflow_id, payload_json
                FROM ai_workflow_trigger_inbox
                WHERE uuid = :uuid
                """
            ),
            {"uuid": "legacy-trigger-release-gate"},
        ).mappings().one()
        version = connection.execute(
            text(
                """
                SELECT d.workflow_id, v.version, v.definition_json
                FROM ai_workflow_definitions d
                JOIN ai_workflow_versions v ON v.workflow_definition_id = d.id
                WHERE d.workflow_id = :workflow_id
                """
            ),
            {"workflow_id": "legacy_v1"},
        ).mappings().one()
    return (
        trigger["owner_user_id"] == "owner-v1"
        and trigger["workflow_id"] == "legacy_v1"
        and version["workflow_id"] == "legacy_v1"
        and version["version"] == 1
        and bool(version["definition_json"])
    )


def _verify_worker_flag_off(storage_dir: Path) -> bool:
    _ensure_server_import_path()
    from app.feature_flags import load_feature_flags, save_feature_flags
    from app.workflow_control_worker import workflow_control_scheduler_step

    settings = SimpleNamespace(knowledge_storage_dir=str(storage_dir))
    save_feature_flags({"workflow_control_worker": False}, settings)
    flags = load_feature_flags(settings)
    calls: list[bool] = []

    class _UnexpectedWorker:
        batch_size = 20

        def tick(self, _db):  # pragma: no cover - must never execute
            calls.append(True)
            raise AssertionError("disabled worker must not tick")

    executed = asyncio.run(
        workflow_control_scheduler_step(settings, worker=_UnexpectedWorker())
    )
    return flags["workflow_control_worker"] is False and executed is False and calls == []


def _run_staged_database(workdir: Path) -> dict[str, Any]:
    from alembic import command

    database_path = workdir / "staged.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    config = _migration_config(database_url)
    engine = create_engine(database_url)
    stages: dict[str, dict[str, Any]] = {}
    checks: dict[str, bool] = {}
    try:
        checks["migration_graph_single_head"] = _migration_heads(config) == [_CURRENT_WORKSPACE_HEAD]
        with _quiet_alembic():
            command.upgrade(config, _EXPAND_REVISION)
        before_trigger = _columns(engine, "ai_workflow_trigger_inbox")
        before_wait = _columns(engine, "ai_workflow_waits")
        checks["0056_columns_absent_before_migrate"] = (
            _TRIGGER_NEW_COLUMNS.isdisjoint(before_trigger)
            and _WAIT_NEW_COLUMNS.isdisjoint(before_wait)
        )
        stages["expand"] = {
            "status": "pass" if checks["0056_columns_absent_before_migrate"] else "fail",
            "revision": _EXPAND_REVISION,
        }
        _seed_legacy_rows(engine)

        with _quiet_alembic():
            command.upgrade(config, "head")
        after_trigger = _columns(engine, "ai_workflow_trigger_inbox")
        after_wait = _columns(engine, "ai_workflow_waits")
        checks["0056_columns_added"] = (
            _TRIGGER_NEW_COLUMNS.issubset(after_trigger)
            and _WAIT_NEW_COLUMNS.issubset(after_wait)
            and _TRIGGER_NEW_INDEXES.issubset(_indexes(engine, "ai_workflow_trigger_inbox"))
            and _WAIT_NEW_INDEXES.issubset(_indexes(engine, "ai_workflow_waits"))
        )
        legacy_checks = _check_legacy_rows(engine)
        checks.update(legacy_checks)
        migrate_ok = (
            checks["migration_graph_single_head"]
            and checks["0056_columns_added"]
            and all(legacy_checks.values())
        )
        stages["migrate"] = {
            "status": "pass" if migrate_ok else "fail",
            "revision": _CURRENT_WORKSPACE_HEAD,
        }

        checks["workflow_worker_flag_off"] = _verify_worker_flag_off(workdir / "flags")
        stages["switch"] = {
            "status": "pass" if checks["workflow_worker_flag_off"] else "fail",
            "workflow_control_worker": False,
        }

        with _quiet_alembic():
            command.downgrade(config, _EXPAND_REVISION)
        rollback_trigger = _columns(engine, "ai_workflow_trigger_inbox")
        rollback_wait = _columns(engine, "ai_workflow_waits")
        checks["0056_columns_removed_on_rollback"] = (
            _TRIGGER_NEW_COLUMNS.isdisjoint(rollback_trigger)
            and _WAIT_NEW_COLUMNS.isdisjoint(rollback_wait)
        )
        checks["legacy_rows_survive_contract"] = _check_legacy_rows_after_contract(engine)
        stages["contract"] = {
            "status": "pass"
            if checks["0056_columns_removed_on_rollback"]
            and checks["legacy_rows_survive_contract"]
            else "fail",
            "revision": _EXPAND_REVISION,
        }

        fresh = _run_fresh_round_trip(workdir)
        stages["fresh_round_trip"] = fresh["stage"]
        checks.update(fresh["checks"])
    finally:
        engine.dispose()
    return {"stages": stages, "checks": checks}


def _run_fresh_round_trip(workdir: Path) -> dict[str, Any]:
    """Prove a clean head/base round trip in a separate disposable DB."""

    from alembic import command

    database_path = workdir / "fresh.db"
    database_url = f"sqlite+pysqlite:///{database_path}"
    config = _migration_config(database_url)
    engine = create_engine(database_url)
    try:
        with _quiet_alembic():
            command.upgrade(config, "head")
        head_tables = set(inspect(engine).get_table_names())
        head_ok = {
            "ai_workflow_trigger_inbox",
            "ai_workflow_waits",
        }.issubset(head_tables)
        with _quiet_alembic():
            command.downgrade(config, "base")
        base_tables = set(inspect(engine).get_table_names()) - {"alembic_version"}
        base_ok = not base_tables
        return {
            "stage": {
                "status": "pass" if head_ok and base_ok else "fail",
                "head_tables_checked": [
                    "ai_workflow_trigger_inbox",
                    "ai_workflow_waits",
                ],
                "tables_after_base": sorted(base_tables),
            },
            "checks": {
                "fresh_head_round_trip": head_ok,
                "fresh_base_empty": base_ok,
            },
        }
    finally:
        engine.dispose()


def _failure(error: dict[str, str], *, repository_unchanged: bool) -> dict[str, Any]:
    return {
        "schema": 1,
        "mode": "local_temp_only",
        "overall": "fail",
        "error": error,
        "stages": {},
        "checks": {},
        "repository_unchanged": repository_unchanged,
        "staging_or_network_used": False,
    }


def _repository_is_unchanged(before: str) -> bool:
    try:
        return before == _repository_snapshot()
    except Exception:
        return False


def run_release_gate() -> dict[str, Any]:
    """Run every local release-gate phase and return JSON-safe evidence."""

    _ensure_server_import_path()
    config_error = _local_config_error()
    if config_error:
        return _failure(
            {"type": "LocalConfigError", "message": config_error},
            repository_unchanged=True,
        )
    try:
        repository_before = _repository_snapshot()
    except Exception as exc:
        return _failure(_error_detail(exc), repository_unchanged=False)

    try:
        with tempfile.TemporaryDirectory(prefix="juxin-4-release-gate-") as directory:
            result = _run_staged_database(Path(directory))
            # ``_run_staged_database`` performs both the staged and clean
            # round-trips; keep the public phase name explicit in evidence.
            result["stages"].setdefault(
                "fresh_round_trip", {"status": "fail", "reason": "not_recorded"}
            )
    except Exception as exc:
        return _failure(
            _error_detail(exc),
            repository_unchanged=_repository_is_unchanged(repository_before),
        )

    try:
        repository_unchanged = repository_before == _repository_snapshot()
    except Exception:
        repository_unchanged = False
    stages = result["stages"]
    overall = "pass" if repository_unchanged and all(
        stage.get("status") == "pass" for stage in stages.values()
    ) else "fail"
    return {
        "schema": 1,
        "mode": "local_temp_only",
        "overall": overall,
        "stages": stages,
        "checks": result["checks"],
        "repository_unchanged": repository_unchanged,
        "staging_or_network_used": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="本地 4.0 发布门禁（临时 SQLite，不连接 staging/生产）")
    parser.add_argument("--json", action="store_true", help="输出机器可读 JSON")
    args = parser.parse_args()
    report = run_release_gate()
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"workflow release gate: {report['overall']}")
        for name, stage in report.get("stages", {}).items():
            print(f"- {name}: {stage.get('status', 'unknown')}")
    return 0 if report["overall"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
