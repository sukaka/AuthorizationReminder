from scripts.run_ga_observe import observation_probe_ok
from scripts.run_ga_smoke import _semantic_ok


def test_smoke_accepts_warning_and_partial_operational_states_without_failures() -> None:
    assert _semantic_ok(
        "/api/ai/ops/readiness",
        {"overall": "ready_with_warnings"},
    )
    assert _semantic_ok(
        "/api/ai/ops/security-audit",
        {"overall": "pass_with_warnings"},
    )
    assert _semantic_ok(
        "/api/ai/ops/ga-report",
        {"overall": "partial", "summary": {"failed": 0, "unknown": 3}},
    )


def test_smoke_rejects_not_ready_and_failed_operational_states() -> None:
    assert not _semantic_ok("/api/ai/ops/readiness", {"overall": "not_ready"})
    assert not _semantic_ok(
        "/api/ai/ops/security-audit",
        {"overall": "fail"},
    )
    assert not _semantic_ok(
        "/api/ai/ops/ga-report",
        {"overall": "partial", "summary": {"failed": 1}},
    )
    assert not _semantic_ok(
        "/api/ai/ops/checkpoint-suite?cases=5",
        {"passed": False, "failed": 1},
    )


def test_smoke_requires_health_status_but_keeps_generic_routes_status_based() -> None:
    assert _semantic_ok("/api/ai/health", {"status": "ok"})
    assert not _semantic_ok("/api/ai/health", {"status": "degraded"})
    assert _semantic_ok(
        "/api/ai/agent-hub/health",
        {"overall": "ok", "healthy": 2, "total": 2},
    )
    assert not _semantic_ok(
        "/api/ai/agent-hub/health",
        {"overall": "ok", "healthy": 1, "total": 2},
    )
    assert _semantic_ok("/api/ai/workflows", {"items": []})


def test_shared_semantics_fail_closed_on_malformed_counters() -> None:
    assert not _semantic_ok(
        "/api/ai/agent-hub/health",
        {"overall": "ok", "healthy": "unknown", "total": 2},
    )
    assert not _semantic_ok(
        "/api/ai/ops/ga-report",
        {"summary": {"failed": "unknown"}},
    )
    assert not _semantic_ok(
        "/api/ai/ops/checkpoint-suite?cases=5",
        {"passed": True, "failed": None},
    )
    assert not _semantic_ok(
        "/api/ai/ops/checkpoint-suite",
        {"passed": True, "failed": 0.5},
    )


def test_observation_probe_requires_http_and_semantic_success() -> None:
    assert observation_probe_ok(
        "/api/ai/ops/readiness",
        200,
        {"overall": "ready_with_warnings"},
    )
    assert not observation_probe_ok(
        "/api/ai/ops/readiness",
        200,
        {"overall": "not_ready"},
    )
    assert not observation_probe_ok(
        "/api/ai/ops/readiness",
        503,
        {"overall": "ready"},
    )
