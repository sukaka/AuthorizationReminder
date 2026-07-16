"""Read-only staging preflight contract tests."""

from __future__ import annotations

import json
from pathlib import Path
from datetime import datetime

from scripts.run_staging_preflight import preflight
from scripts.observation_policy import (
    DEFAULT_MIN_FINISHED_RUNS,
    DEFAULT_MIN_SUCCESS_RATE,
    DEFAULT_OBSERVATION_DAYS,
)


def _root(tmp_path: Path, *, mode: str = "shadow") -> Path:
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_gate.py").write_text("", encoding="utf-8")
    (tmp_path / "harness_spec.json").write_text(
        json.dumps({"release_gate": {"required_test_modules": ["tests/test_gate.py"]}}),
        encoding="utf-8",
    )
    (tmp_path / "requirements.txt").write_text("fastapi==1\n", encoding="utf-8")
    (tmp_path / "requirements-langgraph-pilot.txt").write_text(
        "langgraph==1.2.9\nlanggraph-checkpoint-sqlite==3.1.0\n", encoding="utf-8"
    )
    (tmp_path / "storage").mkdir()
    (tmp_path / "storage" / "feature_flags.json").write_text(
        json.dumps({"langgraph_runtime_mode": mode}), encoding="utf-8"
    )
    migrations = tmp_path / "alembic" / "versions"
    migrations.mkdir(parents=True)
    (tmp_path / "alembic.ini").write_text(
        "[alembic]\nscript_location = %(here)s/alembic\n",
        encoding="utf-8",
    )
    (migrations / "0001_foundation.py").write_text(
        'revision = "0001"\n'
        "down_revision = None\n"
        "branch_labels = None\n"
        "depends_on = None\n\n"
        "def upgrade():\n    pass\n\n"
        "def downgrade():\n    pass\n",
        encoding="utf-8",
    )
    (migrations / "0002_harness.py").write_text(
        'revision = "0002"\n'
        'down_revision = "0001"\n'
        "branch_labels = None\n"
        "depends_on = None\n\n"
        "def upgrade():\n    pass\n\n"
        "def downgrade():\n    pass\n",
        encoding="utf-8",
    )
    return tmp_path


def test_local_preflight_passes_without_credentials(tmp_path: Path) -> None:
    report = preflight(root=_root(tmp_path), mode="local", base_url="http://127.0.0.1:18093")
    assert report["overall"] == "pass"
    assert report["failed_checks"] == []


def test_staging_preflight_requires_https_and_named_token(tmp_path: Path, monkeypatch) -> None:
    root = _root(tmp_path)
    missing = preflight(root=root, mode="staging", base_url="http://staging.example.com", bearer_token_env="TOKEN")
    assert missing["overall"] == "fail"
    assert {"authorization", "staging_transport"} <= set(missing["failed_checks"])

    monkeypatch.setenv("TOKEN", "redacted-test-token")
    ready = preflight(
        root=root,
        mode="staging",
        release_id="release-20260714-001",
        base_url="https://staging.example.com/",
        bearer_token_env="TOKEN",
    )
    assert ready["overall"] == "pass"
    assert ready["release_id"] == "release-20260714-001"
    assert ready["base_url"] == "https://staging.example.com"
    assert datetime.fromisoformat(ready["generated_at"].replace("Z", "+00:00")).tzinfo


def test_staging_preflight_requires_release_identity(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("TOKEN", "redacted-test-token")

    report = preflight(
        root=_root(tmp_path),
        mode="staging",
        base_url="https://staging.example.com",
        bearer_token_env="TOKEN",
    )

    assert report["overall"] == "fail"
    assert "release_identity" in report["failed_checks"]


def test_staging_preflight_rejects_unsafe_bearer_origins(tmp_path: Path, monkeypatch) -> None:
    root = _root(tmp_path)
    monkeypatch.setenv("TOKEN", "redacted-test-token")

    for base_url in (
        "https://operator:secret@staging.example.com",
        "https:///missing-host",
        "ftp://staging.example.com",
    ):
        report = preflight(
            root=root,
            mode="staging",
            release_id="release-20260714-001",
            base_url=base_url,
            bearer_token_env="TOKEN",
        )

        assert report["overall"] == "fail"
        assert "staging_transport" in report["failed_checks"]
        transport_check = next(
            item for item in report["checks"] if item["id"] == "staging_transport"
        )
        assert "secret" not in json.dumps(transport_check, ensure_ascii=False)


def test_real_mode_is_blocked_until_backend_is_production_ready(tmp_path: Path) -> None:
    report = preflight(root=_root(tmp_path, mode="real"), mode="local")
    assert report["overall"] == "fail"
    assert "runtime_mode" in report["failed_checks"]


def test_observation_policy_rejects_invalid_thresholds(tmp_path: Path) -> None:
    report = preflight(root=_root(tmp_path), mode="local", min_days=0, min_success_rate=1.1)
    assert report["overall"] == "fail"
    assert "observation_policy" in report["failed_checks"]


def test_observation_policy_defaults_match_two_week_stability_definition(tmp_path: Path) -> None:
    report = preflight(root=_root(tmp_path), mode="local")
    check = next(item for item in report["checks"] if item["id"] == "observation_policy")

    assert check["status"] == "pass"
    assert check["detail"] == {
        "min_days": DEFAULT_OBSERVATION_DAYS,
        "min_success_rate": DEFAULT_MIN_SUCCESS_RATE,
        "min_finished_runs": DEFAULT_MIN_FINISHED_RUNS,
    }
    assert DEFAULT_OBSERVATION_DAYS == 14


def test_migration_graph_rejects_multiple_heads(tmp_path: Path) -> None:
    root = _root(tmp_path)
    migrations = root / "alembic" / "versions"
    for revision in ("0003_runtime_a", "0003_runtime_b"):
        (migrations / f"{revision}.py").write_text(
            f'revision = "{revision}"\n'
            'down_revision = "0002"\n'
            "branch_labels = None\n"
            "depends_on = None\n\n"
            "def upgrade():\n    pass\n\n"
            "def downgrade():\n    pass\n",
            encoding="utf-8",
        )

    report = preflight(root=root, mode="local")

    assert report["overall"] == "fail"
    assert "migration_graph" in report["failed_checks"]
    migration_check = next(item for item in report["checks"] if item["id"] == "migration_graph")
    assert migration_check["detail"]["heads"] == ["0003_runtime_a", "0003_runtime_b"]
