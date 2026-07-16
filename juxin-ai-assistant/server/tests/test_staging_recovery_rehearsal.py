from __future__ import annotations

import pytest

from scripts.run_staging_recovery_rehearsal import run_rehearsal


def test_single_process_boundary_recovery_rehearsal_is_fail_closed() -> None:
    report = run_rehearsal(cases=1, lease_ttl_seconds=1)

    assert report["passed"] is True
    assert report["total"] == 1
    assert report["recovered"] == 1
    case = report["cases"][0]
    assert case["first_worker_exitcode"] < 0
    assert case["second_worker_exitcode"] == 0
    assert case["fencing_takeover"] is True
    assert case["stale_worker_fenced"] is True


def test_rehearsal_rejects_non_positive_case_count() -> None:
    with pytest.raises(ValueError, match="cases_must_be_positive"):
        run_rehearsal(cases=0, lease_ttl_seconds=1)


def test_rehearsal_does_not_silently_downgrade_1000_case_request(monkeypatch) -> None:
    seen: list[int] = []

    def fake_run_case(case_number: int, **kwargs):
        seen.append(case_number)
        return {"case": case_number, "passed": True, "errors": []}

    monkeypatch.setattr("scripts.run_staging_recovery_rehearsal._run_case", fake_run_case)
    report = run_rehearsal(cases=1000, lease_ttl_seconds=1, parallelism=8)

    assert report["total"] == 1000
    assert report["recovered"] == 1000
    assert report["passed"] is True
    assert len(seen) == 1000
    assert set(seen) == set(range(1, 1001))


def test_rehearsal_rejects_case_count_above_evidence_limit() -> None:
    with pytest.raises(ValueError, match="cases_exceed_maximum_1000"):
        run_rehearsal(cases=1001, lease_ttl_seconds=1)
