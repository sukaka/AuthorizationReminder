from app.faq_matcher import normalize_question
from app.models import SharedFaq


def test_create_run_faq_path_via_api(generation_client, generation_db) -> None:
    generation_db.add(
        SharedFaq(
            question="VPN 如何连接",
            question_normalized=normalize_question("VPN 如何连接"),
            aliases_json=["怎么连VPN"],
            answer="请使用公司客户端并选择总部节点。",
            status="active",
        )
    )
    generation_db.commit()

    response = generation_client.post(
        "/api/ai/runs",
        json={"input_text": "VPN 如何连接", "title": "统一问答"},
    )
    assert response.status_code == 202, response.text
    body = response.json()
    run_id = body["run"]["run_id"]
    assert body["run"]["status"] in {"succeeded", "completed"}
    assert body["snapshot"]["model_calls"] == 0

    detail = generation_client.get(f"/api/ai/runs/{run_id}")
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["result"]["kind"] == "faq"
    assert payload["result"]["model_calls"] == 0
    assert any(e["event_type"] == "completed" for e in payload["events"])


def test_run_api_owner_isolation(generation_client, generation_db) -> None:
    # create as default dev user
    created = generation_client.post(
        "/api/ai/runs",
        json={"input_text": "隔离测试问题"},
    )
    assert created.status_code == 202
    run_id = created.json()["run"]["run_id"]

    from app.auth import get_session
    from app.main import app
    from app.schemas import AuthScope, SessionPayload, UserPayload

    async def other_session():
        return SessionPayload(
            user=UserPayload(id="other", username="other", role="user"),
            scope=AuthScope(department="通用", managed_departments=[]),
            apps=["ai-assistant"],
        )

    app.dependency_overrides[get_session] = other_session
    try:
        forbidden = generation_client.get(f"/api/ai/runs/{run_id}")
        assert forbidden.status_code == 404, forbidden.text
    finally:
        app.dependency_overrides.pop(get_session, None)
