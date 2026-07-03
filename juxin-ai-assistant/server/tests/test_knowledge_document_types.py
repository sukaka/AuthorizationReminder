from sqlalchemy import select


def test_list_document_types_seeds_default_options(client_for_user) -> None:
    employee = client_for_user("user-1")

    response = employee.get("/api/knowledge/document-types")

    assert response.status_code == 200
    names = [item["name"] for item in response.json()["items"]]
    assert "产品白皮书" in names
    assert "安全服务报告" in names
    assert all(item["status"] == "ACTIVE" for item in response.json()["items"])


def test_employee_cannot_manage_document_types(client_for_user) -> None:
    employee = client_for_user("user-1")

    response = employee.post(
        "/api/knowledge/document-types",
        json={"name": "越权类型"},
    )

    assert response.status_code == 403


def test_admin_can_create_update_disable_and_delete_document_type(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeDocumentType

    admin = client_for_user("admin-1", role="admin")

    created = admin.post(
        "/api/knowledge/document-types",
        json={"name": "验收报告", "sort_order": 88},
    )
    assert created.status_code == 201
    created_body = created.json()
    assert created_body["name"] == "验收报告"
    assert created_body["status"] == "ACTIVE"

    updated = admin.patch(
        f"/api/knowledge/document-types/{created_body['document_type_id']}",
        json={"name": "验收材料", "status": "DISABLED", "sort_order": 99},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "验收材料"
    assert updated.json()["status"] == "DISABLED"

    listed = admin.get("/api/knowledge/document-types?include_disabled=true")
    assert "验收材料" in {item["name"] for item in listed.json()["items"]}

    deleted = admin.delete(f"/api/knowledge/document-types/{created_body['document_type_id']}")
    assert deleted.status_code == 204
    stored = generation_db.scalar(
        select(KnowledgeDocumentType).where(
            KnowledgeDocumentType.uuid == created_body["document_type_id"],
        )
    )
    assert stored is not None
    assert stored.deleted_at is not None


def test_admin_cannot_delete_document_type_with_files(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeFile

    admin = client_for_user("admin-1", role="admin")
    created = admin.post(
        "/api/knowledge/document-types",
        json={"name": "不可删除类型"},
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
            document_type="不可删除类型",
        )
    )
    generation_db.commit()

    response = admin.delete(f"/api/knowledge/document-types/{created['document_type_id']}")

    assert response.status_code == 409
    assert "类型下还有资料" in response.text
