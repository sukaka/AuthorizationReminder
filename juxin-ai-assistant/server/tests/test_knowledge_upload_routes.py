from sqlalchemy import select


def test_admin_uploads_official_file_to_company_base(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeBase, KnowledgeFile

    admin = client_for_user("admin-1", role="admin")
    base = admin.post(
        "/api/knowledge/bases",
        json={"name": "公司产品知识库", "scope": "company"},
    ).json()

    response = admin.post(
        "/api/knowledge/files/upload",
        headers={"Idempotency-Key": "official-upload-success"},
        data={
            "knowledge_base_id": base["base_id"],
            "usage_type": "official_knowledge",
            "rag_enabled": "true",
            "rag_scope": "company",
            "permission_scope": "company",
            "category": "产品资料",
            "document_type": "产品白皮书",
            "tags": "Web动态安全管理平台,白皮书",
        },
        files={
            "file": (
                "whitepaper.txt",
                "一、产品资料\n聚信产品正式白皮书。".encode("utf-8"),
                "text/plain",
            )
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["knowledge_base_id"] == base["base_id"]
    assert body["usage_type"] == "official_knowledge"
    assert body["review_status"] == "official"
    assert body["rag_enabled"] is True
    assert body["visibility"] == "PUBLIC"
    assert body["category"] == "产品资料"
    assert body["tags"] == ["Web动态安全管理平台", "白皮书"]

    stored_base = generation_db.scalar(
        select(KnowledgeBase).where(KnowledgeBase.uuid == base["base_id"])
    )
    stored_file = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == body["file_uuid"])
    )
    assert stored_base is not None
    assert stored_file is not None
    assert stored_file.knowledge_base_id == stored_base.id


def test_employee_cannot_upload_official_file_to_company_base(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeFile

    admin = client_for_user("admin-1", role="admin")
    employee = client_for_user("user-1")
    base = admin.post(
        "/api/knowledge/bases",
        json={"name": "公司产品知识库", "scope": "company"},
    ).json()

    response = employee.post(
        "/api/knowledge/files/upload",
        headers={"Idempotency-Key": "official-upload-denied"},
        data={
            "knowledge_base_id": base["base_id"],
            "usage_type": "official_knowledge",
            "rag_enabled": "true",
        },
        files={
            "file": (
                "bypass.txt",
                "越权上传正式知识。".encode("utf-8"),
                "text/plain",
            )
        },
    )

    assert response.status_code == 403
    assert generation_db.scalar(select(KnowledgeFile)) is None


def test_company_base_rejects_personal_reference_upload(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeFile

    admin = client_for_user("admin-1", role="admin")
    base = admin.post(
        "/api/knowledge/bases",
        json={"name": "公司产品知识库", "scope": "company"},
    ).json()

    response = admin.post(
        "/api/knowledge/files/upload",
        headers={"Idempotency-Key": "personal-company-denied"},
        data={
            "knowledge_base_id": base["base_id"],
            "usage_type": "personal_reference",
        },
        files={
            "file": (
                "personal-in-company.txt",
                "个人资料不应进入公司知识库。".encode("utf-8"),
                "text/plain",
            )
        },
    )

    assert response.status_code == 422
    assert generation_db.scalar(select(KnowledgeFile)) is None


def test_employee_uploads_personal_reference_to_own_base_only(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeBase, KnowledgeFile

    owner = client_for_user("user-1")
    other = client_for_user("user-2")
    base = owner.post(
        "/api/knowledge/bases",
        json={"name": "我的资料库", "scope": "personal"},
    ).json()

    response = owner.post(
        "/api/knowledge/files/upload",
        headers={"Idempotency-Key": "personal-base-success"},
        data={
            "knowledge_base_id": base["base_id"],
            "usage_type": "personal_reference",
            "category": "个人素材",
            "document_type": "个人模板",
        },
        files={
            "file": (
                "template.md",
                "一、个人模板\n我的会议纪要模板。".encode("utf-8"),
                "text/markdown",
            )
        },
    )
    denied = other.post(
        "/api/knowledge/files/upload",
        headers={"Idempotency-Key": "personal-base-denied"},
        data={
            "knowledge_base_id": base["base_id"],
            "usage_type": "personal_reference",
        },
        files={
            "file": (
                "other.md",
                "他人尝试上传。".encode("utf-8"),
                "text/markdown",
            )
        },
    )

    assert response.status_code == 201
    assert denied.status_code == 403
    body = response.json()
    assert body["knowledge_base_id"] == base["base_id"]
    assert body["usage_type"] == "personal_reference"
    assert body["rag_enabled"] is False
    assert body["permission_scope"] == "private"

    stored_base = generation_db.scalar(
        select(KnowledgeBase).where(KnowledgeBase.uuid == base["base_id"])
    )
    stored_file = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == body["file_uuid"])
    )
    assert stored_base is not None
    assert stored_file is not None
    assert stored_file.knowledge_base_id == stored_base.id
