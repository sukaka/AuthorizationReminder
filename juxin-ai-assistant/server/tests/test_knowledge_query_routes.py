from sqlalchemy import select

from app.models import KnowledgeFile


def _upload_text(
    client,
    *,
    base_id: str = "",
    usage_type: str,
    file_name: str,
    text: str,
    category: str = "产品资料",
    document_type: str = "产品白皮书",
):
    data = {"usage_type": usage_type}
    if base_id:
        data["knowledge_base_id"] = base_id
    if usage_type == "official_knowledge":
        data.update({
            "rag_enabled": "true",
            "rag_scope": "company",
            "permission_scope": "company",
            "category": category,
            "document_type": document_type,
        })
    return client.post(
        "/api/knowledge/files/upload",
        data=data,
        files={"file": (file_name, text.encode("utf-8"), "text/plain")},
    )


def test_knowledge_search_returns_only_official_sources(
    client_for_user,
    generation_db,
) -> None:
    admin = client_for_user("admin-1", role="admin")
    employee = client_for_user("user-1")
    base = admin.post(
        "/api/knowledge/bases",
        json={"name": "公司产品知识库", "scope": "company"},
    ).json()
    official = _upload_text(
        admin,
        base_id=base["base_id"],
        usage_type="official_knowledge",
        file_name="Web动态安全管理平台白皮书.txt",
        text="一、部署方式\nWeb动态安全管理平台支持本地化部署。",
    ).json()
    _upload_text(
        employee,
        usage_type="personal_reference",
        file_name="我的部署笔记.txt",
        text="一、个人笔记\nWeb动态安全管理平台支持个人测试部署。",
    )

    response = employee.post(
        "/api/knowledge/search",
        json={
            "question": "Web动态安全管理平台支持什么部署",
            "knowledge_base_ids": [base["base_id"]],
            "top_k": 8,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["sources"][0]["source_kind"] == "official_knowledge"
    assert body["sources"][0]["file_id"] == official["file_uuid"]
    assert body["sources"][0]["file_name"] == "Web动态安全管理平台白皮书.txt"
    assert "本地化部署" in body["sources"][0]["snippet"]
    assert all(source["file_name"] != "我的部署笔记.txt" for source in body["sources"])


def test_knowledge_ask_prepares_official_rag_messages_and_sources(
    client_for_user,
    generation_db,
) -> None:
    admin = client_for_user("admin-1", role="admin")
    employee = client_for_user("user-1")
    base = admin.post(
        "/api/knowledge/bases",
        json={"name": "公司产品知识库", "scope": "company"},
    ).json()
    _upload_text(
        admin,
        base_id=base["base_id"],
        usage_type="official_knowledge",
        file_name="安全服务白皮书.txt",
        text="一、服务范围\n聚信安全服务包含应急响应和安全运维。",
    )

    response = employee.post(
        "/api/knowledge/ask",
        json={
            "question": "聚信安全服务包含什么",
            "mode": "knowledge",
            "knowledge_base_ids": [base["base_id"]],
            "top_k": 8,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == ""
    assert body["sources"][0]["source_kind"] == "official_knowledge"
    assert "## official_knowledge_context" in body["messages"][0]["content"]
    assert "聚信安全服务包含应急响应和安全运维" in body["messages"][0]["content"]
    assert body["messages"][-1]["content"] == "聚信安全服务包含什么"


def test_delivery_mode_applies_default_official_knowledge_filters(
    client_for_user,
) -> None:
    admin = client_for_user("admin-1", role="admin")
    employee = client_for_user("user-1")
    base = admin.post(
        "/api/knowledge/bases",
        json={"name": "公司知识库", "scope": "company"},
    ).json()
    _upload_text(
        admin,
        base_id=base["base_id"],
        usage_type="official_knowledge",
        file_name="售前方案.txt",
        text="一、部署安排\n售前方案中的部署安排用于客户交流。",
        category="售前资料",
        document_type="技术方案",
    )
    delivery = _upload_text(
        admin,
        base_id=base["base_id"],
        usage_type="official_knowledge",
        file_name="交付部署手册.txt",
        text="一、部署安排\n交付部署手册要求先完成环境检查和验收计划。",
        category="产品交付",
        document_type="安装部署手册",
    ).json()

    response = employee.post(
        "/api/knowledge/ask",
        json={
            "question": "部署安排",
            "mode": "delivery",
            "knowledge_base_ids": [base["base_id"]],
            "top_k": 8,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert [source["file_id"] for source in body["sources"]] == [delivery["file_uuid"]]
    assert "交付部署手册要求先完成环境检查" in body["messages"][0]["content"]
    assert "售前方案中的部署安排" not in body["messages"][0]["content"]


def test_knowledge_ask_without_official_sources_returns_no_evidence_answer(
    client_for_user,
) -> None:
    employee = client_for_user("user-1")

    response = employee.post(
        "/api/knowledge/ask",
        json={"question": "不存在的产品参数是什么", "mode": "knowledge"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == "当前正式知识库中未找到明确依据"
    assert body["messages"] == []
    assert body["sources"] == []


def test_ask_single_official_file_prepares_official_context(
    client_for_user,
    generation_db,
) -> None:
    admin = client_for_user("admin-1", role="admin")
    employee = client_for_user("user-1")
    base = admin.post(
        "/api/knowledge/bases",
        json={"name": "公司交付知识库", "scope": "company"},
    ).json()
    official = _upload_text(
        admin,
        base_id=base["base_id"],
        usage_type="official_knowledge",
        file_name="部署手册.txt",
        text="一、部署要求\n正式手册要求先完成环境检查再部署。",
    ).json()

    response = employee.post(
        f"/api/knowledge/files/{official['file_uuid']}/ask",
        json={"question": "部署前要先做什么", "mode": "delivery"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == ""
    assert body["sources"][0]["source_kind"] == "official_knowledge"
    assert body["sources"][0]["file_id"] == official["file_uuid"]
    assert "## official_knowledge_context" in body["messages"][0]["content"]
    assert "正式手册要求先完成环境检查再部署" in body["messages"][0]["content"]
    assert body["messages"][-1]["content"] == "部署前要先做什么"
    file_record = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == official["file_uuid"])
    )
    assert file_record is not None
    assert file_record.usage_count == 1
    assert file_record.last_used_at is not None


def test_summarize_personal_file_uses_personal_reference_context_and_is_private(
    client_for_user,
    generation_db,
) -> None:
    owner = client_for_user("user-1")
    other = client_for_user("user-2")
    personal = _upload_text(
        owner,
        usage_type="personal_reference",
        file_name="我的会议记录.txt",
        text="一、会议记录\n客户希望下周完成培训，并确认验收材料清单。",
    ).json()

    response = owner.post(
        f"/api/knowledge/files/{personal['file_uuid']}/summary",
        json={"mode": "normal"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["answer"] == ""
    assert body["sources"][0]["source_kind"] == "personal_reference"
    assert "## personal_reference_context" in body["messages"][0]["content"]
    assert "客户希望下周完成培训" in body["messages"][0]["content"]
    assert "请总结这个文档" in body["messages"][-1]["content"]
    assert "仅供当前用户使用" in body["notice"]
    file_record = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == personal["file_uuid"])
    )
    assert file_record is not None
    assert file_record.usage_count == 1
    assert file_record.last_used_at is not None

    denied = other.post(
        f"/api/knowledge/files/{personal['file_uuid']}/summary",
        json={"mode": "normal"},
    )
    assert denied.status_code == 404
