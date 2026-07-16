from __future__ import annotations

from scripts import run_workflow_release_gate as gate


LOCAL_SECRET = "local-workflow-release-gate-secret-32-bytes!!"


def test_workflow_release_gate_covers_expand_migrate_switch_contract_and_fresh_round_trip(
    monkeypatch,
) -> None:
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("AI_LOCAL_BINDING_SECRET", LOCAL_SECRET)

    report = gate.run_release_gate()

    assert report["overall"] == "pass"
    assert report["mode"] == "local_temp_only"
    assert report["repository_unchanged"] is True
    assert report["staging_or_network_used"] is False
    assert set(report["stages"]) == {
        "expand",
        "migrate",
        "switch",
        "contract",
        "fresh_round_trip",
    }
    assert all(stage["status"] == "pass" for stage in report["stages"].values())
    assert report["checks"]["legacy_trigger_preserved"] is True
    assert report["checks"]["legacy_v1_workflow_preserved"] is True
    assert report["checks"]["workflow_worker_flag_off"] is True
    assert report["checks"]["0056_columns_added"] is True
    assert report["checks"]["0056_columns_removed_on_rollback"] is True


def test_workflow_release_gate_fails_closed_without_local_auth_config(monkeypatch) -> None:
    monkeypatch.delenv("AUTH_DEV_BYPASS", raising=False)
    monkeypatch.delenv("AI_LOCAL_BINDING_SECRET", raising=False)

    report = gate.run_release_gate()

    assert report["overall"] == "fail"
    assert report["error"]["type"] == "LocalConfigError"
    assert report["repository_unchanged"] is True
    assert report["staging_or_network_used"] is False


def test_workflow_release_gate_converts_internal_errors_to_fail_closed_report(monkeypatch) -> None:
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("AI_LOCAL_BINDING_SECRET", LOCAL_SECRET)
    monkeypatch.setattr(
        gate,
        "_run_staged_database",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("synthetic gate failure")),
    )

    report = gate.run_release_gate()

    assert report["overall"] == "fail"
    assert report["error"]["type"] == "RuntimeError"
    assert report["repository_unchanged"] is True
    assert report["staging_or_network_used"] is False
