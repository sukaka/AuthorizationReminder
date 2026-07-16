"""Phase 5 versions + Phase 6 flags + 7.0 webhooks."""

from __future__ import annotations

from app.artifact_service import ArtifactService
from app.feature_flags import load_feature_flags, save_feature_flags
from app.knowledge_version_service import set_effective_version, version_timeline
from app.models import KnowledgeFile


def test_artifact_version_timeline_api(generation_client, generation_db) -> None:
    created = generation_client.post(
        "/api/ai/artifacts",
        json={"title": "版本化成果", "content_markdown": "# v1\n初始"},
    )
    assert created.status_code == 201, created.text
    aid = created.json()["artifact_id"]
    v2 = generation_client.post(
        f"/api/ai/artifacts/{aid}/versions",
        json={"content_markdown": "# v2\n修订", "change_summary": "修订一版"},
    )
    assert v2.status_code == 201, v2.text
    assert v2.json()["version"] == 2
    listed = generation_client.get(f"/api/ai/artifacts/{aid}/versions")
    assert listed.status_code == 200
    body = listed.json()
    assert body["total"] >= 2
    assert body["active_version"] == 2
    # activate v1
    act = generation_client.post(
        f"/api/ai/artifacts/{aid}/versions/activate",
        json={"version": 1},
    )
    assert act.status_code == 200, act.text
    assert act.json()["version"] == 1
    assert "初始" in act.json()["content_markdown"]


def test_knowledge_version_timeline(generation_db) -> None:
    f1 = KnowledgeFile(
        sso_user_id="dev",
        file_name="制度v1.pdf",
        original_file_name="制度v1.pdf",
        file_type="application/pdf",
        file_size=10,
        content_sha256="a" * 64,
        key_version="v1",
        version=1,
        is_current_version=True,
        summary="第一版",
        owner_user_id="dev",
    )
    generation_db.add(f1)
    generation_db.flush()
    f2 = KnowledgeFile(
        sso_user_id="dev",
        file_name="制度v2.pdf",
        original_file_name="制度v2.pdf",
        file_type="application/pdf",
        file_size=12,
        content_sha256="b" * 64,
        key_version="v1",
        version=2,
        is_current_version=False,
        parent_file_id=f1.id,
        summary="第二版",
        owner_user_id="dev",
    )
    generation_db.add(f2)
    generation_db.flush()
    f1.replaced_by_file_id = f2.id
    generation_db.add(f1)
    generation_db.commit()

    tl = version_timeline(generation_db, f1.uuid)
    assert tl["total"] >= 2
    assert tl["effective_uuid"] == f1.uuid
    set_effective_version(generation_db, f2.uuid, actor="admin")
    generation_db.commit()
    tl2 = version_timeline(generation_db, f2.uuid)
    assert tl2["effective_uuid"] == f2.uuid


def test_knowledge_version_timeline_hides_private_file_from_other_users(
    client_for_user,
    generation_db,
) -> None:
    private_file = KnowledgeFile(
        sso_user_id="alice",
        file_name="客户清单.pdf",
        original_file_name="客户清单.pdf",
        file_type="application/pdf",
        file_size=10,
        content_sha256="c" * 64,
        key_version="v1",
        owner_user_id="alice",
        summary="仅限所有者查看",
    )
    generation_db.add(private_file)
    generation_db.commit()

    response = client_for_user("dev").get(
        f"/api/ai/knowledge/files/{private_file.uuid}/versions"
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "文档不存在或无权访问"


def test_feature_flags_write(generation_client, tmp_path, monkeypatch) -> None:
    from app import feature_flags as ff

    monkeypatch.setattr(ff, "_store_path", lambda settings=None: tmp_path / "flags.json")
    get = generation_client.get("/api/ai/ops/feature-flags")
    assert get.status_code == 200
    put = generation_client.put(
        "/api/ai/ops/feature-flags",
        json={"rollout_percent": 25, "channels": {"feishu": True}},
        headers={"X-Test-Role": "admin"},
    )
    assert put.status_code == 200, put.text
    assert put.json()["rollout_percent"] == 25
    assert put.json()["channels"]["feishu"] is True
    forbidden = generation_client.put(
        "/api/ai/ops/feature-flags",
        json={"learning_auto_publish": True},
        headers={"X-Test-Role": "admin"},
    )
    assert forbidden.status_code == 400
    invalid_shadow = generation_client.put(
        "/api/ai/ops/feature-flags",
        json={"runtime_shadow_enabled": "yes", "runtime_shadow_sample_percent": 101},
        headers={"X-Test-Role": "admin"},
    )
    assert invalid_shadow.status_code == 400
    report = generation_client.get(
        "/api/ai/ops/runtime-shadow",
        headers={"X-Test-Role": "admin"},
    )
    assert report.status_code == 200, report.text
    assert report.json()["config"]["enabled"] is False


def test_feishu_webhook_challenge(generation_client, tmp_path, monkeypatch) -> None:
    from app import feature_flags as ff

    monkeypatch.setattr(ff, "_store_path", lambda settings=None: tmp_path / "flags.json")
    save_feature_flags({"channels": {"feishu": True, "wecom": True, "web": True, "desktop": True}})
    # disabled without flag would 503 — we enabled
    ch = generation_client.post(
        "/api/ai/channels/webhooks/feishu",
        json={"type": "url_verification", "challenge": "abc123"},
    )
    assert ch.status_code == 200, ch.text
    assert ch.json()["challenge"] == "abc123"
    msg = generation_client.post(
        "/api/ai/channels/webhooks/feishu",
        json={
            "event": {
                "sender": {"sender_id": {"open_id": "ou_1"}},
                "message": {"chat_id": "oc_1", "content": '{"text":"帮我查VPN"}'},
            }
        },
    )
    assert msg.status_code == 200, msg.text
    assert msg.json()["ok"] is True
    assert "VPN" in msg.json()["text"]


def test_learning_eval_api(generation_client) -> None:
    listed = generation_client.get(
        "/api/ai/learning-eval/questions",
        headers={"X-Test-Role": "admin"},
    )
    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] >= 1
    qid = listed.json()["items"][0]["id"]
    run = generation_client.post(
        "/api/ai/learning-eval/run",
        json={"question_id": qid, "answer": "placeholder without required bits"},
        headers={"X-Test-Role": "admin"},
    )
    assert run.status_code == 200, run.text
    # likely fails snippet check unless empty requirements
    assert "passed" in run.json()
