from sqlalchemy import select


def test_list_categories_seeds_default_options(client_for_user) -> None:
    employee = client_for_user("user-1")

    response = employee.get("/api/knowledge/categories")

    assert response.status_code == 200
    names = [item["name"] for item in response.json()["items"]]
    assert "产品资料" in names
    assert "安全运维" in names
    assert all(item["status"] == "ACTIVE" for item in response.json()["items"])


def test_employee_cannot_manage_categories(client_for_user) -> None:
    employee = client_for_user("user-1")

    response = employee.post(
        "/api/knowledge/categories",
        json={"name": "越权分类", "scope": "company"},
    )

    assert response.status_code == 403


def test_admin_can_create_update_disable_and_delete_category(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeCategory

    admin = client_for_user("admin-1", role="admin")

    created = admin.post(
        "/api/knowledge/categories",
        json={"name": "客户交付", "scope": "company", "sort_order": 88},
    )
    assert created.status_code == 201
    created_body = created.json()
    assert created_body["name"] == "客户交付"
    assert created_body["status"] == "ACTIVE"

    updated = admin.patch(
        f"/api/knowledge/categories/{created_body['category_id']}",
        json={"name": "项目交付材料", "status": "DISABLED", "sort_order": 99},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "项目交付材料"
    assert updated.json()["status"] == "DISABLED"

    listed = admin.get("/api/knowledge/categories?include_disabled=true")
    assert "项目交付材料" in {item["name"] for item in listed.json()["items"]}

    deleted = admin.delete(f"/api/knowledge/categories/{created_body['category_id']}")
    assert deleted.status_code == 204
    stored = generation_db.scalar(
        select(KnowledgeCategory).where(KnowledgeCategory.uuid == created_body["category_id"])
    )
    assert stored is not None
    assert stored.deleted_at is not None


def test_admin_cannot_delete_category_with_files(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeFile

    admin = client_for_user("admin-1", role="admin")
    created = admin.post(
        "/api/knowledge/categories",
        json={"name": "不可删除分类", "scope": "company"},
    ).json()
    generation_db.add(
        KnowledgeFile(
            sso_user_id="admin-1",
            file_name="demo.txt",
            file_type="text/plain",
            file_size=4,
            content_sha256="a" * 64,
            visibility="PUBLIC",
            status="READY",
            key_version="v1",
            category="不可删除分类",
        )
    )
    generation_db.commit()

    response = admin.delete(f"/api/knowledge/categories/{created['category_id']}")

    assert response.status_code == 409
    assert "分类下还有资料" in response.text
