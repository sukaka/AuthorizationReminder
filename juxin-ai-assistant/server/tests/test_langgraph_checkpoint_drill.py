"""Process-boundary LangGraph checkpoint recovery evidence."""

from __future__ import annotations

import pytest

from app.agent_runtime.langgraph_graph import langgraph_graph_status
from scripts.run_langgraph_checkpoint_drill import run_drill


def test_langgraph_checkpoint_process_boundary_recovery() -> None:
    if not langgraph_graph_status()["checkpointer_supported"]:
        pytest.skip("optional LangGraph checkpoint dependencies are not installed")

    report = run_drill(cases=1, lease_ttl_seconds=1, timeout_seconds=10)

    assert report["passed"] is True
    assert report["recovered"] == 1
    case = report["cases"][0]
    assert case["first_worker_exitcode"] < 0
    assert case["second_worker_exitcode"] == 0
    assert case["stale_worker_fenced"] is True
    assert case["checkpoint_ids"] == ["cp-1", "cp-2"]


def test_langgraph_checkpoint_drill_clamps_case_count() -> None:
    report = run_drill(cases=0, lease_ttl_seconds=1, timeout_seconds=10)

    assert report["total"] == 1
    assert isinstance(report["cases"], list)
    assert all(isinstance(case["errors"], list) for case in report["cases"])
