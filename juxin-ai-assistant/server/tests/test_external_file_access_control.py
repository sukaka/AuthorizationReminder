from sqlalchemy import select


def _upload_official(admin, *, key: str = "external-access-upload") -> dict:
    base = admin.post(
        "/api/knowledge/bases",
        json={"name": f"正式知识库-{key}", "scope": "company"},
    ).json()
    response = admin.post(
        "/api/knowledge/files/upload",
        headers={"Idempotency-Key": key},
        data={
            "knowledge_base_id": base["base_id"],
            "usage_type": "official_knowledge",
            "category": "产品资料",
            "document_type": "产品白皮书",
            "tags": "白皮书,产品",
        },
        files={
            "file": (
                f"{key}.txt",
                "正式资料内容".encode("utf-8"),
                "text/plain",
            )
        },
    )
    assert response.status_code == 201
    return response.json()


def test_external_download_requires_separate_admin_opt_in(client_for_user, generation_db) -> None:
    from app.models import KnowledgeFile

    admin = client_for_user("admin-1", role="admin")
    employee = client_for_user("employee-1")
    created = _upload_official(admin)

    blocked = admin.patch(
        f"/api/knowledge/files/{created['file_uuid']}",
        json={"external_download_allowed": True},
    )
    assert blocked.status_code == 409

    public = admin.patch(
        f"/api/knowledge/files/{created['file_uuid']}",
        json={"external_public": True},
    )
    assert public.status_code == 200
    assert public.json()["external_public"] is True
    assert public.json()["external_download_allowed"] is False

    downloadable = admin.patch(
        f"/api/knowledge/files/{created['file_uuid']}",
        json={"external_download_allowed": True},
    )
    assert downloadable.status_code == 200
    assert downloadable.json()["external_download_allowed"] is True

    forbidden = employee.patch(
        f"/api/knowledge/files/{created['file_uuid']}",
        json={"external_download_allowed": False},
    )
    assert forbidden.status_code == 403

    disabled = admin.patch(
        f"/api/knowledge/files/{created['file_uuid']}",
        json={"external_public": False},
    )
    assert disabled.status_code == 200
    assert disabled.json()["external_public"] is False
    assert disabled.json()["external_download_allowed"] is False

    stored = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == created["file_uuid"])
    )
    assert stored is not None
    assert stored.external_public is False
    assert stored.external_download_allowed is False


def test_external_document_download_filter_is_stricter_than_answer_filter(generation_db) -> None:
    from app.models import KnowledgeFile
    from app.wechat_external_routes import _downloadable_files, _public_files

    files = [
        KnowledgeFile(
            uuid="public-only",
            sso_user_id="admin-1",
            file_name="公开问答.txt",
            file_type="text/plain",
            file_size=10,
            content_sha256="a" * 64,
            usage_type="official_knowledge",
            review_status="official",
            status="READY",
            rag_enabled=True,
            external_public=True,
            external_download_allowed=False,
        ),
        KnowledgeFile(
            uuid="public-download",
            sso_user_id="admin-1",
            file_name="允许下载.txt",
            file_type="text/plain",
            file_size=10,
            content_sha256="b" * 64,
            usage_type="official_knowledge",
            review_status="official",
            status="READY",
            rag_enabled=True,
            external_public=True,
            external_download_allowed=True,
        ),
        KnowledgeFile(
            uuid="internal-only",
            sso_user_id="admin-1",
            file_name="内部资料.txt",
            file_type="text/plain",
            file_size=10,
            content_sha256="c" * 64,
            usage_type="official_knowledge",
            review_status="official",
            status="READY",
            rag_enabled=True,
            external_public=False,
            external_download_allowed=False,
        ),
    ]
    generation_db.add_all(files)
    generation_db.commit()

    public_ids = set(generation_db.scalars(select(KnowledgeFile.uuid).where(*_public_files())))
    downloadable_ids = set(generation_db.scalars(select(KnowledgeFile.uuid).where(*_downloadable_files())))

    assert public_ids == {"public-only", "public-download"}
    assert downloadable_ids == {"public-download"}
