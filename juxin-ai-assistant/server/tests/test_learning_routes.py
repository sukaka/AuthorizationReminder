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


def test_memory_rejects_sensitive_content_and_company_fact_requires_admin(client_for_user):
    owner = client_for_user("u1")
    admin = client_for_user("admin", role="admin")

    sensitive = owner.post(
        "/api/learning/memories",
        json={
            "memory_type": "user_preference",
            "title": "模型密钥",
            "content": "记住我的 API Key 是 sk-test-secret",
            "priority": "high",
        },
    )
    assert sensitive.status_code == 400
    assert sensitive.json()["detail"] == "MEMORY_SENSITIVE_CONTENT_NOT_ALLOWED"

    denied = owner.post(
        "/api/learning/memories",
        json={
            "memory_type": "company_fact",
            "title": "公司产品事实",
            "content": "WDSP 是正式产品资料。",
            "priority": "high",
        },
    )
    assert denied.status_code == 403
    assert denied.json()["detail"] == "COMPANY_FACT_MEMORY_REQUIRES_ADMIN"

    allowed = admin.post(
        "/api/learning/memories",
        json={
            "memory_type": "company_fact",
            "title": "公司产品事实",
            "content": "正式产品事实应优先来自公司知识库。",
            "priority": "high",
        },
    )
    assert allowed.status_code == 201
    assert allowed.json()["memory_type"] == "company_fact"


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
    listed_feedback = owner.get("/api/learning/feedback").json()
    assert listed_feedback["total"] == 1
    assert listed_feedback["items"][0]["feedback_type"] == "save_experience"
    assert other.get("/api/learning/feedback").json()["total"] == 0


def test_learning_libraries_can_be_edited_deleted_and_template_submitted(client_for_user):
    owner = client_for_user("u1")
    other = client_for_user("u2")
    admin = client_for_user("admin", role="admin")

    exp = owner.post(
        "/api/learning/experiences",
        json={
            "task_type": "商务投标",
            "title": "旧标题",
            "question": "怎么写？",
            "answer": "旧答案",
            "summary": "旧摘要",
            "tags": ["旧"],
        },
    ).json()
    denied = other.patch(
        f"/api/learning/experiences/{exp['uuid']}",
        json={"title": "越权"},
    )
    assert denied.status_code == 404
    patched = owner.patch(
        f"/api/learning/experiences/{exp['uuid']}",
        json={"title": "新标题", "tags": ["新"]},
    )
    assert patched.status_code == 200
    assert patched.json()["title"] == "新标题"
    assert patched.json()["tags"] == ["新"]
    deleted = owner.delete(f"/api/learning/experiences/{exp['uuid']}")
    assert deleted.status_code == 200
    assert owner.get("/api/learning/experiences").json()["total"] == 0

    template = owner.post(
        "/api/learning/templates",
        json={
            "template_name": "个人模板",
            "task_type": "会议纪要",
            "template_content": "一、背景",
            "variables": {},
            "scope": "personal",
        },
    ).json()
    submitted = owner.post(f"/api/learning/templates/{template['uuid']}/submit-review")
    assert submitted.status_code == 200
    assert submitted.json()["scope"] == "company"
    assert submitted.json()["review_status"] == "pending"
    assert other.get("/api/learning/templates/review").status_code == 403
    pending_reviews = admin.get("/api/learning/templates/review").json()
    assert pending_reviews["total"] == 1
    assert pending_reviews["items"][0]["uuid"] == template["uuid"]
    approved = admin.post(f"/api/learning/templates/{template['uuid']}/approve")
    assert approved.status_code == 200
    assert approved.json()["scope"] == "company"
    assert approved.json()["review_status"] == "official"
    assert admin.get("/api/learning/templates/review").json()["total"] == 0

    patched_template = owner.patch(
        f"/api/learning/templates/{template['uuid']}",
        json={"template_name": "会议纪要模板", "scope": "personal"},
    )
    assert patched_template.status_code == 200
    assert patched_template.json()["review_status"] == "draft"
    assert owner.delete(f"/api/learning/templates/{template['uuid']}").status_code == 200
    assert owner.get("/api/learning/templates").json()["total"] == 0

    rejected_template = owner.post(
        "/api/learning/templates",
        json={
            "template_name": "待驳回模板",
            "task_type": "投标",
            "template_content": "一、评分点",
            "variables": {},
            "scope": "personal",
        },
    ).json()
    assert owner.post(f"/api/learning/templates/{rejected_template['uuid']}/submit-review").status_code == 200
    rejected = admin.post(f"/api/learning/templates/{rejected_template['uuid']}/reject")
    assert rejected.status_code == 200
    assert rejected.json()["scope"] == "personal"
    assert rejected.json()["review_status"] == "rejected"

    failure = owner.post(
        "/api/learning/failure-cases",
        json={
            "task_type": "导出",
            "wrong_answer": "把路径写入历史",
            "correction": "只显示 Toast",
            "prevention_rule": "路径不进标题",
            "tags": ["导出"],
        },
    ).json()
    patched_failure = owner.patch(
        f"/api/learning/failure-cases/{failure['uuid']}",
        json={"prevention_rule": "工具结果不得改历史标题"},
    )
    assert patched_failure.status_code == 200
    assert patched_failure.json()["prevention_rule"] == "工具结果不得改历史标题"
    assert other.delete(f"/api/learning/failure-cases/{failure['uuid']}").status_code == 404
    assert owner.delete(f"/api/learning/failure-cases/{failure['uuid']}").status_code == 200
    assert owner.get("/api/learning/failure-cases").json()["total"] == 0
