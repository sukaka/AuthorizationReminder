from sqlalchemy import select


def test_user_memory_center_crud_and_owner_isolation(client_for_user, generation_db):
    from app.models import UserMemory

    owner = client_for_user("u1")
    other = client_for_user("u2")

    created = owner.post(
        "/api/learning/memories",
        json={
            "memory_type": "correction",
            "title": "Word 导出提示",
            "content": "导出成功不能写入历史会话列表。",
            "priority": "high",
            "tags": ["word", "history"],
        },
    )
    assert created.status_code == 201
    body = created.json()
    assert body["priority"] == "high"
    assert body["tags"] == ["word", "history"]

    listed = owner.get("/api/learning/memories").json()
    assert listed["total"] == 1
    assert listed["items"][0]["title"] == "Word 导出提示"

    assert other.get("/api/learning/memories").json()["total"] == 0
    assert other.patch(
        f"/api/learning/memories/{body['uuid']}",
        json={"status": "disabled"},
    ).status_code == 404

    patched = owner.patch(
        f"/api/learning/memories/{body['uuid']}",
        json={"status": "disabled", "content": "导出提示只用 Toast。"},
    )
    assert patched.status_code == 200
    assert patched.json()["status"] == "disabled"
    assert owner.get("/api/learning/memories").json()["total"] == 0
    assert owner.get("/api/learning/memories?status=disabled").json()["total"] == 1

    deleted = owner.delete(f"/api/learning/memories/{body['uuid']}")
    assert deleted.status_code == 200
    assert deleted.json()["status"] == "deleted"
    assert owner.get("/api/learning/memories?status=all").json()["total"] == 0
    assert generation_db.scalar(select(UserMemory).where(UserMemory.uuid == body["uuid"])).status == "deleted"


def test_learning_libraries_and_feedback_are_user_scoped(client_for_user):
    owner = client_for_user("u1")
    other = client_for_user("u2")

    exp = owner.post(
        "/api/learning/experiences",
        json={
            "task_type": "商务投标",
            "title": "投标响应结构",
            "question": "怎么写投标响应？",
            "answer": "先列评分点，再列响应表。",
            "summary": "投标先对齐评分点。",
            "tags": ["投标"],
        },
    )
    assert exp.status_code == 201
    assert owner.get("/api/learning/experiences").json()["total"] == 1
    assert other.get("/api/learning/experiences").json()["total"] == 0

    template = owner.post(
        "/api/learning/templates",
        json={
            "template_name": "会议纪要模板",
            "task_type": "会议纪要",
            "template_content": "一、会议背景\n二、待办事项",
            "variables": {"customer": "客户名称"},
            "scope": "company",
        },
    )
    assert template.status_code == 201
    assert template.json()["review_status"] == "pending"
    assert owner.get("/api/learning/templates").json()["items"][0]["template_name"] == "会议纪要模板"

    failure = owner.post(
        "/api/learning/failure-cases",
        json={
            "task_type": "历史会话",
            "wrong_answer": "把导出路径写入历史标题。",
            "correction": "导出结果只能 Toast 展示。",
            "prevention_rule": "工具结果不得参与标题生成。",
            "tags": ["复发保护"],
        },
    )
    assert failure.status_code == 201
    assert owner.get("/api/learning/failure-cases").json()["total"] == 1

    feedback = owner.post(
        "/api/learning/feedback",
        json={
            "conversation_id": "c1",
            "message_id": "m1",
            "feedback_type": "save_experience",
            "comment": "这个回答以后复用。",
            "saved_as": "experience",
        },
    )
    assert feedback.status_code == 201
    assert feedback.json()["saved_as"] == "experience"
