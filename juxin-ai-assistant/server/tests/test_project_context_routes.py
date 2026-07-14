from __future__ import annotations

from app.models import ChatSession, KnowledgeBase, KnowledgeFile, WorkArtifact


def _create_project(client, name: str = "项目上下文") -> dict:
    response = client.post(
        "/api/ai/projects",
        json={"name": name, "description": "项目上下文测试"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _seed_project_file(generation_db, project_uuid: str) -> KnowledgeFile:
    knowledge_base = KnowledgeBase(
        name="项目知识库",
        description="项目专属知识库",
        scope="project",
        owner_user_id="u-1",
        project_id=project_uuid,
        created_by="u-1",
    )
    generation_db.add(knowledge_base)
    generation_db.flush()
    knowledge_file = KnowledgeFile(
        knowledge_base_id=knowledge_base.id,
        sso_user_id="u-1",
        key_version="v1",
        owner_user_id="u-1",
        file_name="范围说明.docx",
        file_type="docx",
        file_size=128,
        content_sha256="a" * 64,
        review_status="approved",
        rag_scope="project",
        permission_scope="project",
    )
    generation_db.add(knowledge_file)
    generation_db.commit()
    return knowledge_file


def test_project_context_isolated_and_ai_memory_requires_confirmation(client_for_user):
    owner = client_for_user("u-1")
    member = client_for_user("u-2")
    outsider = client_for_user("u-3")
    project_uuid = _create_project(owner)["project_uuid"]
    assert owner.post(
        f"/api/ai/projects/{project_uuid}/members",
        json={"user_id": "u-2", "role": "member"},
    ).status_code == 201

    active = member.post(
        f"/api/ai/projects/{project_uuid}/memories",
        json={
            "memory_type": "customer_preference",
            "title": "报告偏好",
            "content": "客户希望报告先给结论。",
        },
    )
    assert active.status_code == 201, active.text
    assert active.json()["confirmation_status"] == "active"

    suggestion = member.post(
        f"/api/ai/projects/{project_uuid}/memories",
        json={
            "memory_type": "rule",
            "title": "AI 建议",
            "content": "可能需要每周复盘。",
            "source": "ai_suggestion",
        },
    )
    assert suggestion.status_code == 201, suggestion.text
    assert suggestion.json()["confirmation_status"] == "pending_confirmation"
    assert member.post(
        f"/api/ai/projects/{project_uuid}/memories/{suggestion.json()['memory_uuid']}/confirm",
        json={},
    ).status_code == 403

    confirmed = owner.post(
        f"/api/ai/projects/{project_uuid}/memories/{suggestion.json()['memory_uuid']}/confirm",
        json={},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["confirmation_status"] == "active"
    assert outsider.get(f"/api/ai/projects/{project_uuid}/memories").status_code == 404


def test_project_files_sessions_and_artifacts_are_scoped(
    client_for_user,
    generation_db,
):
    owner = client_for_user("u-1")
    member = client_for_user("u-2")
    outsider = client_for_user("u-3")
    project_uuid = _create_project(owner, "项目资源隔离")["project_uuid"]
    assert owner.post(
        f"/api/ai/projects/{project_uuid}/members",
        json={"user_id": "u-2", "role": "member"},
    ).status_code == 201

    project_file = _seed_project_file(generation_db, project_uuid)
    linked_file = owner.post(
        f"/api/ai/projects/{project_uuid}/files/{project_file.uuid}",
        json={},
    )
    assert linked_file.status_code == 201, linked_file.text
    assert member.get(f"/api/ai/projects/{project_uuid}/files").json()[0]["file_uuid"] == project_file.uuid
    assert outsider.get(f"/api/ai/projects/{project_uuid}/files").status_code == 404

    chat_session = ChatSession(
        uuid="personal-session-to-move",
        sso_user_id="u-1",
        title="待迁移会话",
        workspace_type="personal",
        project_uuid=None,
    )
    artifact = WorkArtifact(
        uuid="personal-artifact-to-link",
        owner_user_id="u-1",
        conversation_id=chat_session.uuid,
        title="项目交付物",
        artifact_type="ordinary_answer",
        content_summary="原始客户内容",
        file_name="交付物.docx",
        file_path_or_blob_ref="private/blob/ref",
    )
    generation_db.add_all([chat_session, artifact])
    generation_db.commit()

    moved = owner.post(
        f"/api/ai/projects/{project_uuid}/sessions/{chat_session.uuid}/move",
        json={
            "move_attachments": False,
            "move_artifacts": True,
            "extract_project_memory": False,
            "keep_personal_copy": False,
        },
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["project_uuid"] == project_uuid
    assert moved.json()["moved_artifact_count"] == 1

    linked_artifact = owner.post(
        f"/api/ai/projects/{project_uuid}/artifacts/{artifact.uuid}",
        json={},
    )
    assert linked_artifact.status_code == 409
    assert member.get(f"/api/ai/projects/{project_uuid}/artifacts").json()[0]["artifact_uuid"] == artifact.uuid

    copied = owner.post(
        f"/api/ai/projects/{project_uuid}/artifacts/{artifact.uuid}/copy-to-personal",
        json={
            "sanitized_title": "个人版交付物",
            "sanitized_content_summary": "已脱敏的交付物摘要",
        },
    )
    assert copied.status_code == 201, copied.text
    copied_row = generation_db.get(WorkArtifact, copied.json()["artifact_id"])
    assert copied_row is not None
    assert copied_row.file_path_or_blob_ref == ""
    assert copied_row.content_summary == "已脱敏的交付物摘要"
