"""GA readiness report (plan §8.1)."""

from app.ops_ga import build_ga_report
from app.models import AgentRun


def test_build_ga_report_structure(generation_db) -> None:
    report = build_ga_report(generation_db, sample_limit=50)
    assert "overall" in report
    assert report["summary"]["total"] == 9
    assert len(report["items"]) == 9
    keys = {i["key"] for i in report["items"]}
    assert "complex_task_success_rate" in keys
    assert "faq_model_call_rate" in keys
    assert "user_satisfaction" in keys


def test_ga_report_with_sample_runs(generation_db) -> None:
    generation_db.add(
        AgentRun(
            owner_user_id="dev",
            title="复杂任务样例",
            run_type="chat",
            status="succeeded",
            stage="completed",
            progress=100,
            result_json={
                "kind": "multi_agent",
                "workflow": "research_write_review",
                "citations": [{"citation_id": "f1", "name": "手册"}],
                "quality": {"passed": True, "issues": []},
                "model_calls": 2,
            },
            request_ciphertext=b"x",
            request_nonce=b"n" * 12,
            key_version="v1",
        )
    )
    generation_db.add(
        AgentRun(
            owner_user_id="dev",
            title="FAQ 样例",
            run_type="chat",
            status="succeeded",
            stage="completed",
            progress=100,
            result_json={"kind": "faq", "faq_hit": True, "model_calls": 0, "answer": "统一口径"},
            request_ciphertext=b"y",
            request_nonce=b"m" * 12,
            key_version="v1",
        )
    )
    generation_db.commit()
    report = build_ga_report(generation_db, sample_limit=50)
    assert report["measured"]["complex_total"] >= 1
    assert report["measured"]["faq_runs"] >= 1
    faq_item = next(i for i in report["items"] if i["key"] == "faq_model_call_rate")
    assert faq_item["value"] == 0.0
    assert faq_item["status"] == "pass"


def test_ga_report_api(generation_client, generation_db) -> None:
    resp = generation_client.get(
        "/api/ai/ops/ga-report",
        headers={"X-Test-Role": "admin"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["summary"]["total"] == 9
    assert isinstance(body["items"], list)
