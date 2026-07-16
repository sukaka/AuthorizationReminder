from scripts import run_migration_candidate_rehearsal as rehearsal
from scripts.run_migration_candidate_rehearsal import run_rehearsal


LOCAL_SECRET = "local-migration-rehearsal-secret-32-bytes!!"


def test_migration_candidate_rehearsal_checks_current_blocker_and_round_trips(
    monkeypatch,
) -> None:
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("AI_LOCAL_BINDING_SECRET", LOCAL_SECRET)

    report = run_rehearsal()

    assert report["overall"] == "pass"
    assert report["repository_unchanged"] is True
    assert report["staging_or_network_used"] is False
    candidates = {item["name"]: item for item in report["candidates"]}
    assert candidates["current"]["status"] == "pass"
    assert candidates["current"]["upgrade"]["status"] == "pass"
    assert candidates["current"]["downgrade"]["status"] == "pass"
    assert candidates["candidate_a"]["status"] == "pass"
    assert candidates["candidate_b"]["status"] == "pass"


def test_migration_candidate_rehearsal_fails_closed_without_local_auth_config(
    monkeypatch,
) -> None:
    monkeypatch.delenv("AUTH_DEV_BYPASS", raising=False)
    monkeypatch.delenv("AI_LOCAL_BINDING_SECRET", raising=False)

    report = run_rehearsal()

    assert report["overall"] == "fail"
    assert report["error"]["type"] == "LocalConfigError"
    assert report["candidates"] == []
    assert report["repository_unchanged"] is True
    assert report["staging_or_network_used"] is False


def test_migration_candidate_rehearsal_converts_internal_errors_to_fail_closed_report(
    monkeypatch,
) -> None:
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("AI_LOCAL_BINDING_SECRET", LOCAL_SECRET)
    original_graph_heads = rehearsal._graph_heads

    def fail_candidate_b(config_path):
        if config_path.parent.name == "candidate_b":
            raise RuntimeError("synthetic candidate graph failure")
        return original_graph_heads(config_path)

    monkeypatch.setattr(rehearsal, "_graph_heads", fail_candidate_b)

    report = run_rehearsal()

    assert report["overall"] == "fail"
    assert report["repository_unchanged"] is True
    assert report["staging_or_network_used"] is False
    candidates = {item["name"]: item for item in report["candidates"]}
    assert candidates["candidate_a"]["status"] == "pass"
    assert candidates["candidate_b"]["status"] == "fail"
    assert candidates["candidate_b"]["error"]["type"] == "RuntimeError"


def test_migration_candidate_rehearsal_converts_setup_errors_to_top_level_report(
    monkeypatch,
) -> None:
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("AI_LOCAL_BINDING_SECRET", LOCAL_SECRET)
    monkeypatch.setattr(
        rehearsal,
        "_repository_snapshot",
        lambda: (_ for _ in ()).throw(RuntimeError("synthetic snapshot failure")),
    )

    report = run_rehearsal()

    assert report["overall"] == "fail"
    assert report["error"]["type"] == "RuntimeError"
    assert report["candidates"] == []
    assert report["repository_unchanged"] is False
    assert report["staging_or_network_used"] is False


def test_migration_candidate_rehearsal_fails_if_repository_snapshot_changes(
    monkeypatch,
) -> None:
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("AI_LOCAL_BINDING_SECRET", LOCAL_SECRET)
    snapshots = iter(("before", "after"))
    monkeypatch.setattr(rehearsal, "_repository_snapshot", lambda: next(snapshots))

    report = run_rehearsal()

    assert report["overall"] == "fail"
    assert report["repository_unchanged"] is False
    assert report["staging_or_network_used"] is False
    candidates = {item["name"]: item for item in report["candidates"]}
    assert all(item["status"] == "pass" for item in candidates.values())
