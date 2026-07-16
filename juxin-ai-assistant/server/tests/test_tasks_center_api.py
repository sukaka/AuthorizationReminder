"""任务中心 list API + 学习候选用户可见。"""


def test_list_runs_api(generation_client) -> None:
    created = generation_client.post(
        "/api/ai/runs",
        json={"input_text": "任务中心测试：VPN 如何申请", "title": "VPN 申请"},
    )
    assert created.status_code == 202, created.text
    run_id = created.json()["run"]["run_id"]
    listed = generation_client.get("/api/ai/runs")
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert body["total"] >= 1
    assert any(i["run_id"] == run_id for i in body["items"])
    assert "title" in body["items"][0]
    detail = generation_client.get(f"/api/ai/runs/{run_id}")
    assert detail.status_code == 200
    assert "result" in detail.json()


def test_learning_candidates_visible_to_user(generation_client, generation_db) -> None:
    from app.learning_candidate_service import LearningCandidateService

    LearningCandidateService(generation_db).create(
        owner_user_id="dev",
        source_run_id="r1",
        candidate_type="correction",
        title="用户可见候选",
        payload={"comment": "x"},
        actor="dev",
    )
    generation_db.commit()
    # employee role (default)
    listed = generation_client.get("/api/ai/learning-candidates")
    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] >= 1
