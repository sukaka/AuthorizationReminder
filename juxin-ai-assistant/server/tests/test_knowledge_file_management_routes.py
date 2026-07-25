from sqlalchemy import func, select


def _upload_personal(client, *, name: str = "personal.md") -> dict:
    response = client.post(
        "/api/knowledge/files/upload",
        headers={"Idempotency-Key": f"upload-personal-{name}"},
        data={"usage_type": "personal_reference", "category": "个人素材"},
        files={
            "file": (
                name,
                "一、个人资料\n个人会议纪要模板。".encode("utf-8"),
                "text/markdown",
            )
        },
    )
    assert response.status_code == 201
    return response.json()


def _upload_official(admin) -> dict:
    base = admin.post(
        "/api/knowledge/bases",
        json={"name": "公司正式知识库", "scope": "company"},
    ).json()
    response = admin.post(
        "/api/knowledge/files/upload",
        headers={"Idempotency-Key": "upload-official"},
        data={
            "knowledge_base_id": base["base_id"],
            "usage_type": "official_knowledge",
            "category": "产品资料",
            "document_type": "产品白皮书",
            "tags": "白皮书,产品",
        },
        files={
            "file": (
                "official.txt",
                "一、正式资料\n公司安全服务正式资料。".encode("utf-8"),
                "text/plain",
            )
        },
    )
    assert response.status_code == 201
    return response.json()


def test_file_list_shows_authorized_company_and_own_files_only(client_for_user) -> None:
    owner = client_for_user("user-1")
    other = client_for_user("user-2")
    admin = client_for_user("admin-1", role="admin")
    own = _upload_personal(owner, name="own.md")
    _upload_personal(other, name="other.md")
    official = _upload_official(admin)

    response = owner.get("/api/knowledge/files")

    assert response.status_code == 200
    items = response.json()["items"]
    ids = {item["file_uuid"] for item in items}
    assert ids == {own["file_uuid"], official["file_uuid"]}
    assert all(item["version"] == 1 for item in items)
    assert all(item["is_current_version"] is True for item in items)
    assert all(len(item["content_sha256"]) == 64 for item in items)
    assert all(item["updated_at"] for item in items)


def test_file_detail_respects_owner_and_official_visibility(client_for_user) -> None:
    owner = client_for_user("user-1")
    other = client_for_user("user-2")
    admin = client_for_user("admin-1", role="admin")
    own = _upload_personal(owner)
    official = _upload_official(admin)

    own_detail = owner.get(f"/api/knowledge/files/{own['file_uuid']}")
    other_detail = other.get(f"/api/knowledge/files/{own['file_uuid']}")
    official_detail = other.get(f"/api/knowledge/files/{official['file_uuid']}")

    assert own_detail.status_code == 200
    assert other_detail.status_code == 404
    assert official_detail.status_code == 200


def test_owner_can_preview_and_download_personal_file_without_path_leak(
    client_for_user,
) -> None:
    owner = client_for_user("user-1")
    other = client_for_user("user-2")
    created = _upload_personal(owner, name="meeting.md")

    preview = owner.get(f"/api/knowledge/files/{created['file_uuid']}/preview")
    download = owner.get(f"/api/knowledge/files/{created['file_uuid']}/download")
    other_preview = other.get(f"/api/knowledge/files/{created['file_uuid']}/preview")
    other_download = other.get(f"/api/knowledge/files/{created['file_uuid']}/download")

    assert preview.status_code == 200
    body = preview.json()
    assert body["file_uuid"] == created["file_uuid"]
    assert body["file_name"] == "meeting.md"
    assert body["source_kind"] == "personal_reference"
    assert body["chunks"]
    assert body["chunks"][0]["chunk_index"] == 0
    assert "个人会议纪要模板" in body["chunks"][0]["text"]
    assert "file_path" not in body
    assert "stored_file_name" not in body

    assert download.status_code == 200
    assert download.content == "一、个人资料\n个人会议纪要模板。".encode("utf-8")
    assert download.headers["content-type"].startswith("text/markdown")
    assert "meeting.md" in download.headers["content-disposition"]
    assert other_preview.status_code == 404
    assert other_download.status_code == 404


def test_image_can_be_uploaded_previewed_and_downloaded(client_for_user) -> None:
    owner = client_for_user("image-owner")
    png = b"\x89PNG\r\n\x1a\n" + b"certificate-image"
    response = owner.post(
        "/api/knowledge/files/upload",
        headers={"Idempotency-Key": "upload-image"},
        data={
            "usage_type": "personal_reference",
            "category": "产品资料",
            "document_type": "证书",
            "tags": "WDSP,网专证书",
        },
        files={"file": ("WDSP 网专证书.png", png, "image/png")},
    )

    assert response.status_code == 201
    created = response.json()
    assert created["file_type"] == "png"
    assert created["chunk_count"] == 1

    preview = owner.get(f"/api/knowledge/files/{created['file_uuid']}/preview")
    assert preview.status_code == 200
    assert preview.json()["media_type"] == "image/png"
    assert preview.json()["asset_url"].endswith(f"/{created['file_uuid']}/download")
    assert "WDSP 网专证书" in preview.json()["chunks"][0]["text"]

    download = owner.get(f"/api/knowledge/files/{created['file_uuid']}/download")
    assert download.status_code == 200
    assert download.headers["content-type"].startswith("image/png")
    assert download.headers["content-disposition"].startswith("inline;")
    assert download.content == png


def test_knowledge_upload_rejects_content_over_the_read_limit(
    client_for_user,
    monkeypatch,
) -> None:
    import app.knowledge_routes as knowledge_routes

    monkeypatch.setattr(knowledge_routes, "MAX_KNOWLEDGE_FILE_BYTES", 8)
    response = client_for_user("upload-limit-user").post(
        "/api/knowledge/files/upload",
        headers={"Idempotency-Key": "upload-over-read-limit"},
        data={"usage_type": "personal_reference"},
        files={"file": ("too-large.txt", b"123456789", "text/plain")},
    )

    assert response.status_code == 413
    assert "不能超过" in response.text


def test_preview_can_focus_source_chunk_by_chunk_id(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeChunk, KnowledgeFile

    owner = client_for_user("user-1")
    response = owner.post(
        "/api/knowledge/files/upload",
        headers={"Idempotency-Key": "upload-long-meeting"},
        data={"usage_type": "personal_reference", "category": "个人素材"},
        files={
            "file": (
                "long-meeting.md",
                (
                    "一、会议背景\n"
                    + "背景内容。" * 260
                    + "\n二、决议事项\n"
                    + "目标片段内容。" * 260
                ).encode("utf-8"),
                "text/markdown",
            )
        },
    )
    assert response.status_code == 201
    created = response.json()
    stored = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == created["file_uuid"])
    )
    assert stored is not None
    chunks = list(
        generation_db.scalars(
            select(KnowledgeChunk)
            .where(KnowledgeChunk.file_id == stored.id)
            .order_by(KnowledgeChunk.chunk_index.asc())
        )
    )
    assert len(chunks) >= 2
    target = chunks[1]

    preview = owner.get(
        f"/api/knowledge/files/{created['file_uuid']}/preview",
        params={"chunk_id": target.chunk_id, "top_k": 1},
    )

    assert preview.status_code == 200
    body = preview.json()
    assert body["chunks"][0]["chunk_id"] == target.chunk_id
    assert body["chunks"][0]["chunk_index"] == target.chunk_index
    assert "目标片段内容" in body["chunks"][0]["text"]


def test_preview_paginates_large_file_chunks(
    client_for_user,
    generation_db,
) -> None:
    import os

    from app.crypto import ContentCipher
    from app.models import KnowledgeChunk, KnowledgeFile

    owner = client_for_user("user-1")
    created = _upload_personal(owner, name="large-bid.md")
    stored = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == created["file_uuid"])
    )
    assert stored is not None
    cipher = ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"])
    for index in range(1, 45):
        chunk_id = f"{stored.uuid}-manual-{index}"
        encrypted = cipher.encrypt_json({"text": f"分页片段 {index + 1}"}, chunk_id.encode())
        generation_db.add(KnowledgeChunk(
            chunk_id=chunk_id,
            file_id=stored.id,
            knowledge_base_id=stored.knowledge_base_id,
            file_name=stored.file_name,
            chunk_text_ciphertext=encrypted.ciphertext,
            chunk_text_nonce=encrypted.nonce,
            page_number=None,
            section_title=f"段落 {index + 1}",
            chunk_index=index,
            token_estimate=10,
            token_count=10,
            metadata_json={},
            embedding_id="",
            status="READY",
        ))
    generation_db.commit()

    preview = owner.get(
        f"/api/knowledge/files/{created['file_uuid']}/preview",
        params={"page": 2, "page_size": 20},
    )

    assert preview.status_code == 200
    body = preview.json()
    assert body["total_chunks"] == 45
    assert body["page"] == 2
    assert body["page_size"] == 20
    assert body["total_pages"] == 3
    assert len(body["chunks"]) == 20
    assert body["chunks"][0]["chunk_index"] == 20
    assert "分页片段 21" in body["chunks"][0]["text"]


def test_owner_can_update_personal_file_metadata(client_for_user) -> None:
    owner = client_for_user("user-1")
    created = _upload_personal(owner)

    response = owner.patch(
        f"/api/knowledge/files/{created['file_uuid']}",
        json={
            "category": "会议纪要",
            "document_type": "个人模板",
            "tags": ["会议", "模板"],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["category"] == "会议纪要"
    assert body["document_type"] == "个人模板"
    assert body["tags"] == ["会议", "模板"]


def test_owner_can_rename_personal_file_and_chunks(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeChunk, KnowledgeFile

    owner = client_for_user("user-1")
    created = _upload_personal(owner, name="old-name.md")

    response = owner.patch(
        f"/api/knowledge/files/{created['file_uuid']}",
        json={"file_name": "../交付会议纪要.md"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["file_name"] == "交付会议纪要.md"
    stored_file = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == created["file_uuid"])
    )
    assert stored_file is not None
    assert stored_file.file_name == "交付会议纪要.md"
    chunk_file_names = set(
        generation_db.scalars(
            select(KnowledgeChunk.file_name).where(KnowledgeChunk.file_id == stored_file.id)
        )
    )
    assert chunk_file_names == {"交付会议纪要.md"}


def test_classify_file_updates_metadata_with_rule_based_suggestion(client_for_user) -> None:
    owner = client_for_user("user-1")
    created = owner.post(
        "/api/knowledge/files/upload",
        headers={"Idempotency-Key": "upload-classify"},
        data={"usage_type": "personal_reference"},
        files={
            "file": (
                "客户会议纪要.md",
                "一、会议纪要\n客户确认培训、验收材料和下一步计划。".encode("utf-8"),
                "text/markdown",
            )
        },
    ).json()

    response = owner.post(f"/api/knowledge/files/{created['file_uuid']}/classify")

    assert response.status_code == 200
    body = response.json()
    assert body["file_uuid"] == created["file_uuid"]
    assert body["category"] == "会议纪要"
    assert body["document_type"] == "会议纪要"
    assert "会议纪要" in body["tags"]
    assert "客户资料" in body["tags"]
    assert body["applied"] is True


def test_upload_requires_idempotency_key_and_replays_successfully(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeFile

    owner = client_for_user("idempotency-user")
    request = {
        "data": {"usage_type": "personal_reference", "category": "个人素材"},
        "files": {"file": ("retry.md", "幂等上传内容".encode("utf-8"), "text/markdown")},
    }

    missing = owner.post("/api/knowledge/files/upload", **request)
    first = owner.post(
        "/api/knowledge/files/upload",
        headers={"Idempotency-Key": "knowledge-upload-replay-1"},
        **request,
    )
    replay = owner.post(
        "/api/knowledge/files/upload",
        headers={"Idempotency-Key": "knowledge-upload-replay-1"},
        **request,
    )

    assert missing.status_code == 400
    assert first.status_code == 201
    assert replay.status_code == 201
    assert replay.json() == first.json()
    assert generation_db.scalar(select(func.count(KnowledgeFile.id))) == 1


def test_employee_cannot_classify_official_file_but_admin_can(client_for_user) -> None:
    employee = client_for_user("user-1")
    admin = client_for_user("admin-1", role="admin")
    official = _upload_official(admin)

    denied = employee.post(f"/api/knowledge/files/{official['file_uuid']}/classify")
    classified = admin.post(f"/api/knowledge/files/{official['file_uuid']}/classify")

    assert denied.status_code == 403
    assert classified.status_code == 200
    assert classified.json()["file_uuid"] == official["file_uuid"]
    assert classified.json()["applied"] is True


def test_employee_cannot_update_official_file_metadata(client_for_user) -> None:
    employee = client_for_user("user-1")
    admin = client_for_user("admin-1", role="admin")
    official = _upload_official(admin)

    response = employee.patch(
        f"/api/knowledge/files/{official['file_uuid']}",
        json={"category": "越权修改"},
    )

    assert response.status_code == 403


def test_soft_delete_moves_file_to_trash_and_restore_reactivates(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeChunk, KnowledgeFile, KnowledgeReviewLog

    owner = client_for_user("user-1")
    created = _upload_personal(owner)

    deleted = owner.delete(f"/api/knowledge/files/{created['file_uuid']}")
    trash = owner.get("/api/knowledge/files/trash")
    listed = owner.get("/api/knowledge/files")
    restored = owner.post(f"/api/knowledge/files/{created['file_uuid']}/restore")

    assert deleted.status_code == 204
    assert created["file_uuid"] in {item["file_uuid"] for item in trash.json()["items"]}
    assert created["file_uuid"] not in {item["file_uuid"] for item in listed.json()["items"]}
    assert restored.status_code == 200
    assert restored.json()["status"] == "READY"

    stored = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == created["file_uuid"])
    )
    assert stored is not None
    assert stored.deleted_at is None
    assert stored.status == "READY"
    chunk_statuses = set(
        generation_db.scalars(
            select(KnowledgeChunk.status).where(KnowledgeChunk.file_id == stored.id)
        )
    )
    assert chunk_statuses == {"READY"}
    logs = list(
        generation_db.scalars(
            select(KnowledgeReviewLog)
            .where(KnowledgeReviewLog.file_id == stored.id)
            .order_by(KnowledgeReviewLog.id.asc())
        )
    )
    assert [log.action for log in logs] == ["delete", "restore"]
    assert logs[0].old_status == "READY"
    assert logs[0].new_status == "DELETED"
    assert logs[1].old_status == "DELETED"
    assert logs[1].new_status == "READY"


def test_owner_can_hard_delete_personal_file_from_trash_after_confirmation(
    client_for_user,
    generation_db,
) -> None:
    from pathlib import Path
    from sqlalchemy import func

    from app.models import KnowledgeChunk, KnowledgeFile

    owner = client_for_user("user-1")
    created = _upload_personal(owner)
    stored = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == created["file_uuid"])
    )
    assert stored is not None
    stored_path = Path(stored.file_path)
    assert stored_path.is_file()
    assert generation_db.scalar(
        select(func.count(KnowledgeChunk.id)).where(KnowledgeChunk.file_id == stored.id)
    )

    missing_confirmation = owner.delete(
        f"/api/knowledge/files/{created['file_uuid']}/hard-delete"
    )
    owner.delete(f"/api/knowledge/files/{created['file_uuid']}")
    hard_deleted = owner.delete(
        f"/api/knowledge/files/{created['file_uuid']}/hard-delete?confirm=true"
    )
    detail = owner.get(f"/api/knowledge/files/{created['file_uuid']}")
    trash = owner.get("/api/knowledge/files/trash")

    assert missing_confirmation.status_code == 400
    assert hard_deleted.status_code == 204
    assert detail.status_code == 404
    assert created["file_uuid"] not in {item["file_uuid"] for item in trash.json()["items"]}
    generation_db.refresh(stored)
    assert stored.status == "HARD_DELETED"
    assert stored.hard_deleted_at is not None
    assert stored.rag_enabled is False
    assert stored_path.exists() is False
    remaining_chunks = generation_db.scalar(
        select(func.count(KnowledgeChunk.id)).where(KnowledgeChunk.file_id == stored.id)
    )
    assert remaining_chunks == 0


def test_admin_can_disable_and_enable_official_rag(client_for_user) -> None:
    admin = client_for_user("admin-1", role="admin")
    employee = client_for_user("user-1")
    official = _upload_official(admin)

    denied = employee.post(f"/api/knowledge/files/{official['file_uuid']}/disable-rag")
    disabled = admin.post(f"/api/knowledge/files/{official['file_uuid']}/disable-rag")
    enabled = admin.post(f"/api/knowledge/files/{official['file_uuid']}/enable-rag")

    assert denied.status_code == 403
    assert disabled.status_code == 200
    assert disabled.json()["rag_enabled"] is False
    assert enabled.status_code == 200
    assert enabled.json()["rag_enabled"] is True


def test_archive_excludes_official_file_from_search_until_restore(
    client_for_user,
    generation_db,
) -> None:
    import os

    from app.crypto import ContentCipher
    from app.knowledge_search import search_knowledge_chunks
    from app.models import KnowledgeFile, KnowledgeReviewLog

    admin = client_for_user("admin-1", role="admin")
    official = _upload_official(admin)

    archived = admin.post(f"/api/knowledge/files/{official['file_uuid']}/archive")
    after_archive = search_knowledge_chunks(
        generation_db,
        sso_user_id="user-1",
        query="正式 资料",
        cipher=ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"]),
    )
    restored = admin.post(f"/api/knowledge/files/{official['file_uuid']}/restore")
    after_restore = search_knowledge_chunks(
        generation_db,
        sso_user_id="user-1",
        query="正式 资料",
        cipher=ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"]),
    )

    assert archived.status_code == 200
    assert archived.json()["status"] == "ARCHIVED"
    assert after_archive == []
    assert restored.status_code == 200
    assert {result.file_uuid for result in after_restore} == {official["file_uuid"]}
    stored = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == official["file_uuid"])
    )
    assert stored is not None
    assert stored.archived_at is None
    logs = list(
        generation_db.scalars(
            select(KnowledgeReviewLog)
            .where(KnowledgeReviewLog.file_id == stored.id)
            .order_by(KnowledgeReviewLog.id.asc())
        )
    )
    assert [log.action for log in logs] == ["archive", "restore"]
    assert logs[0].old_status == "READY"
    assert logs[0].new_status == "ARCHIVED"
    assert logs[1].old_status == "ARCHIVED"
    assert logs[1].new_status == "READY"


def test_owner_can_reparse_personal_file_and_rebuild_chunks(
    client_for_user,
    generation_db,
) -> None:
    import os
    from pathlib import Path

    from app.crypto import ContentCipher, EncryptedPayload
    from app.models import KnowledgeChunk, KnowledgeFile

    owner = client_for_user("user-1")
    other = client_for_user("user-2")
    created = _upload_personal(owner)
    stored = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == created["file_uuid"])
    )
    assert stored is not None
    assert stored.file_path
    Path(stored.file_path).write_text(
        "一、重新解析后的源文件内容\n这是从原始文件重新生成的内容。",
        encoding="utf-8",
    )
    old_chunk_ids = set(
        generation_db.scalars(
            select(KnowledgeChunk.chunk_id).where(KnowledgeChunk.file_id == stored.id)
        )
    )

    denied = other.post(f"/api/knowledge/files/{created['file_uuid']}/reparse")
    reparsed = owner.post(f"/api/knowledge/files/{created['file_uuid']}/reparse")

    assert denied.status_code == 404
    assert reparsed.status_code == 200
    body = reparsed.json()
    assert body["parse_status"] == "parsed"
    assert body["index_status"] == "indexed"
    assert body["chunk_count"] >= 1
    new_chunk_ids = set(
        generation_db.scalars(
            select(KnowledgeChunk.chunk_id).where(KnowledgeChunk.file_id == stored.id)
        )
    )
    assert new_chunk_ids
    assert new_chunk_ids.isdisjoint(old_chunk_ids)
    new_chunks = list(
        generation_db.scalars(
            select(KnowledgeChunk)
            .where(KnowledgeChunk.file_id == stored.id)
            .order_by(KnowledgeChunk.chunk_index.asc())
        )
    )
    cipher = ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"])
    rebuilt_text = "\n".join(
        str(
            cipher.decrypt_json(
                EncryptedPayload(
                    ciphertext=chunk.chunk_text_ciphertext,
                    nonce=chunk.chunk_text_nonce,
                ),
                chunk.chunk_id.encode(),
            ).get("text", "")
        )
        for chunk in new_chunks
    )
    assert "重新解析后的源文件内容" in rebuilt_text
    assert "个人会议纪要模板" not in rebuilt_text


def test_employee_cannot_reparse_official_file(client_for_user) -> None:
    admin = client_for_user("admin-1", role="admin")
    employee = client_for_user("user-1")
    official = _upload_official(admin)

    denied = employee.post(f"/api/knowledge/files/{official['file_uuid']}/reparse")
    allowed = admin.post(f"/api/knowledge/files/{official['file_uuid']}/reparse")

    assert denied.status_code == 403
    assert allowed.status_code == 200
