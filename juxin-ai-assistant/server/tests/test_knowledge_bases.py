from sqlalchemy import select


def test_admin_can_create_company_knowledge_base(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeBase

    admin = client_for_user("admin-1", role="admin")

    response = admin.post(
        "/api/knowledge/bases",
        json={
            "name": "公司产品知识库",
            "description": "产品白皮书、方案和手册",
            "scope": "company",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "公司产品知识库"
    assert body["scope"] == "company"
    assert body["created_by"] == "admin-1"
    assert body["owner_user_id"] == ""

    stored = generation_db.scalar(
        select(KnowledgeBase).where(KnowledgeBase.uuid == body["base_id"])
    )
    assert stored is not None
    assert stored.scope == "company"
    assert stored.deleted_at is None


def test_employee_cannot_create_company_knowledge_base(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeBase

    employee = client_for_user("user-1")

    response = employee.post(
        "/api/knowledge/bases",
        json={"name": "越权公司库", "scope": "company"},
    )

    assert response.status_code == 403
    assert generation_db.scalar(select(KnowledgeBase)) is None


def test_employee_can_create_personal_base_and_list_authorized_bases(
    client_for_user,
) -> None:
    user_1 = client_for_user("user-1")
    user_2 = client_for_user("user-2")
    admin = client_for_user("admin-1", role="admin")

    company = admin.post(
        "/api/knowledge/bases",
        json={"name": "公司正式知识库", "scope": "company"},
    ).json()
    own = user_1.post(
        "/api/knowledge/bases",
        json={"name": "我的资料库", "scope": "personal"},
    ).json()
    other = user_2.post(
        "/api/knowledge/bases",
        json={"name": "他人的资料库", "scope": "personal"},
    ).json()

    user_1_list = user_1.get("/api/knowledge/bases")

    assert user_1_list.status_code == 200
    visible_ids = {item["base_id"] for item in user_1_list.json()["items"]}
    assert visible_ids == {company["base_id"], own["base_id"]}
    assert other["base_id"] not in visible_ids


def test_employee_cannot_update_or_delete_company_base(
    client_for_user,
) -> None:
    admin = client_for_user("admin-1", role="admin")
    employee = client_for_user("user-1")
    company = admin.post(
        "/api/knowledge/bases",
        json={"name": "公司正式知识库", "scope": "company"},
    ).json()

    update = employee.patch(
        f"/api/knowledge/bases/{company['base_id']}",
        json={"name": "员工改名"},
    )
    delete = employee.delete(f"/api/knowledge/bases/{company['base_id']}")

    assert update.status_code == 403
    assert delete.status_code == 403


def test_owner_can_update_and_soft_delete_personal_base(
    client_for_user,
) -> None:
    owner = client_for_user("user-1")
    created = owner.post(
        "/api/knowledge/bases",
        json={"name": "我的资料库", "scope": "personal"},
    ).json()

    renamed = owner.patch(
        f"/api/knowledge/bases/{created['base_id']}",
        json={"name": "我的常用资料"},
    )
    deleted = owner.delete(f"/api/knowledge/bases/{created['base_id']}")
    listed = owner.get("/api/knowledge/bases")

    assert renamed.status_code == 200
    assert renamed.json()["name"] == "我的常用资料"
    assert deleted.status_code == 204
    assert created["base_id"] not in {
        item["base_id"] for item in listed.json()["items"]
    }
