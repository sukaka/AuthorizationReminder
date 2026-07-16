import os

from sqlalchemy import select


def _create_personal_file(client, *, base_id: str | None = None) -> dict:
    data = {"usage_type": "personal_reference"}
    if base_id:
        data["knowledge_base_id"] = base_id
    response = client.post(
        "/api/knowledge/files/upload",
        headers={"Idempotency-Key": "review-upload-proposal"},
        data=data,
        files={
            "file": (
                "proposal.md",
                "一、方案资料\n这是一份可提交审核的个人方案资料。".encode("utf-8"),
                "text/markdown",
            )
        },
    )
    assert response.status_code == 201
    return response.json()


def test_owner_can_submit_personal_file_for_review(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeFile, KnowledgeReviewLog

    owner = client_for_user("user-1")
    created = _create_personal_file(owner)

    response = owner.post(
        f"/api/knowledge/files/{created['file_uuid']}/submit-review",
        json={"comment": "建议加入公司知识库"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["review_status"] == "pending"
    assert body["usage_type"] == "personal_reference"
    assert body["rag_enabled"] is False

    stored = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == created["file_uuid"])
    )
    assert stored is not None
    assert stored.review_status == "pending"
    assert stored.review_comment == "建议加入公司知识库"
    logs = list(generation_db.scalars(select(KnowledgeReviewLog)))
    assert len(logs) == 1
    assert logs[0].action == "submit_review"
    assert logs[0].user_id == "user-1"
    assert logs[0].new_status == "pending"


def test_user_cannot_submit_other_user_file_for_review(client_for_user) -> None:
    owner = client_for_user("user-1")
    other = client_for_user("user-2")
    created = _create_personal_file(owner)

    response = other.post(
        f"/api/knowledge/files/{created['file_uuid']}/submit-review",
        json={"comment": "越权提交"},
    )

    assert response.status_code == 404


def test_admin_can_list_pending_reviews(client_for_user) -> None:
    owner = client_for_user("user-1")
    admin = client_for_user("admin-1", role="admin")
    created = _create_personal_file(owner)
    owner.post(
        f"/api/knowledge/files/{created['file_uuid']}/submit-review",
        json={"comment": "请审核"},
    )

    response = admin.get("/api/knowledge/reviews/pending")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["file_uuid"] == created["file_uuid"]
    assert body["items"][0]["review_status"] == "pending"


def test_employee_cannot_list_pending_reviews(client_for_user) -> None:
    employee = client_for_user("user-1")

    response = employee.get("/api/knowledge/reviews/pending")

    assert response.status_code == 403


def test_admin_can_list_review_history(client_for_user) -> None:
    owner = client_for_user("user-1")
    admin = client_for_user("admin-1", role="admin")
    created = _create_personal_file(owner)
    owner.post(
        f"/api/knowledge/files/{created['file_uuid']}/submit-review",
        json={"comment": "请审核"},
    )
    admin.post(
        f"/api/knowledge/files/{created['file_uuid']}/reject",
        json={"comment": "资料依据不足"},
    )

    response = admin.get("/api/knowledge/reviews/history")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert [item["action"] for item in body["items"]] == ["reject", "submit_review"]
    assert body["items"][0]["file_uuid"] == created["file_uuid"]
    assert body["items"][0]["reviewer_id"] == "admin-1"
    assert body["items"][0]["comment"] == "资料依据不足"


def test_employee_cannot_list_review_history(client_for_user) -> None:
    employee = client_for_user("user-1")

    response = employee.get("/api/knowledge/reviews/history")

    assert response.status_code == 403


def test_admin_approves_pending_file_as_official_knowledge(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeBase, KnowledgeFile, KnowledgeReviewLog
    from app.crypto import ContentCipher
    from app.knowledge_search import search_knowledge_chunks

    owner = client_for_user("user-1")
    admin = client_for_user("admin-1", role="admin")
    company_base = admin.post(
        "/api/knowledge/bases",
        json={"name": "公司正式知识库", "scope": "company"},
    ).json()
    created = _create_personal_file(owner)
    owner.post(
        f"/api/knowledge/files/{created['file_uuid']}/submit-review",
        json={"comment": "请转正式"},
    )
    pending_results = search_knowledge_chunks(
        generation_db,
        sso_user_id="user-2",
        query="方案 资料",
        cipher=ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"]),
    )
    assert pending_results == []

    response = admin.post(
        f"/api/knowledge/files/{created['file_uuid']}/approve",
        json={
            "knowledge_base_id": company_base["base_id"],
            "comment": "审核通过",
            "permission_scope": "company",
            "rag_scope": "company",
            "category": "售前资料",
            "document_type": "服务方案",
            "tags": ["方案", "售前"],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["usage_type"] == "official_knowledge"
    assert body["review_status"] == "official"
    assert body["rag_enabled"] is True
    assert body["permission_scope"] == "company"
    assert body["rag_scope"] == "company"
    assert body["knowledge_base_id"] == company_base["base_id"]
    assert body["category"] == "售前资料"
    assert body["tags"] == ["方案", "售前"]

    stored_base = generation_db.scalar(
        select(KnowledgeBase).where(KnowledgeBase.uuid == company_base["base_id"])
    )
    stored = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == created["file_uuid"])
    )
    assert stored is not None
    assert stored_base is not None
    assert stored.knowledge_base_id == stored_base.id
    assert stored.reviewed_by == "admin-1"
    assert stored.reviewed_at is not None
    assert stored.review_comment == "审核通过"
    results = search_knowledge_chunks(
        generation_db,
        sso_user_id="user-2",
        query="方案 资料",
        cipher=ContentCipher(os.environ["CONTENT_ENCRYPTION_KEY"]),
    )
    assert {result.file_uuid for result in results} == {created["file_uuid"]}
    logs = list(
        generation_db.scalars(
            select(KnowledgeReviewLog).order_by(KnowledgeReviewLog.id.asc())
        )
    )
    assert [log.action for log in logs] == ["submit_review", "approve"]
    assert logs[-1].reviewer_id == "admin-1"
    assert logs[-1].new_status == "official"


def test_admin_approves_web_capture_candidate_and_marks_capture_approved(
    client_for_user,
    monkeypatch,
    generation_db,
) -> None:
    from app import web_routes
    from app.models import KnowledgeFile, WebCapture
    from app.web_sources import WebFetchResult

    def fetch_result() -> WebFetchResult:
        return WebFetchResult(
            url="https://example.com/wdsp",
            final_url="https://example.com/wdsp",
            status_code=200,
            content_type="text/html",
            content="""
            <html>
              <head><title>WDSP 白皮书</title></head>
              <body><p>WDSP 支持 SQL 识别和 Webshell 动态检测。</p></body>
            </html>
            """.encode("utf-8"),
            fetched_at=__import__("datetime").datetime(2026, 7, 3),
        )

    monkeypatch.setattr(web_routes.WebFetcher, "fetch", lambda self, url: fetch_result())
    owner = client_for_user("user-web")
    admin = client_for_user("admin-1", role="admin")
    company_base = admin.post(
        "/api/knowledge/bases",
        json={"name": "网页正式知识库", "scope": "company"},
    ).json()
    preview = owner.post(
        "/api/web/captures/preview",
        json={"url": "https://example.com/wdsp"},
        headers={"Idempotency-Key": "review-web-preview"},
    ).json()
    candidate = owner.post(
        f"/api/web/captures/{preview['capture_id']}/confirm",
        json={"save_target": "official_knowledge_candidate"},
        headers={"Idempotency-Key": "review-web-confirm"},
    ).json()

    response = admin.post(
        f"/api/knowledge/files/{candidate['knowledge_file_uuid']}/approve",
        json={
            "knowledge_base_id": company_base["base_id"],
            "comment": "网页资料审核通过",
            "permission_scope": "company",
            "rag_scope": "company",
            "category": "产品资料",
            "document_type": "产品白皮书",
            "tags": ["WDSP"],
        },
    )

    assert response.status_code == 200
    file_record = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == candidate["knowledge_file_uuid"])
    )
    capture = generation_db.scalar(select(WebCapture).where(WebCapture.uuid == preview["capture_id"]))
    assert file_record is not None
    assert file_record.usage_type == "official_knowledge"
    assert file_record.review_status == "official"
    assert file_record.source_origin == "web_capture"
    assert file_record.file_type == "webpage"
    assert capture is not None
    assert capture.review_status == "approved"
    assert capture.status == "approved"


def test_admin_rejects_pending_file_and_keeps_it_personal(
    client_for_user,
    generation_db,
) -> None:
    from app.models import KnowledgeFile, KnowledgeReviewLog

    owner = client_for_user("user-1")
    admin = client_for_user("admin-1", role="admin")
    created = _create_personal_file(owner)
    owner.post(
        f"/api/knowledge/files/{created['file_uuid']}/submit-review",
        json={"comment": "请审核"},
    )

    response = admin.post(
        f"/api/knowledge/files/{created['file_uuid']}/reject",
        json={"comment": "资料依据不足"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["usage_type"] == "personal_reference"
    assert body["review_status"] == "rejected"
    assert body["rag_enabled"] is False
    assert body["permission_scope"] == "private"

    stored = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == created["file_uuid"])
    )
    assert stored is not None
    assert stored.review_comment == "资料依据不足"
    assert stored.reviewed_by == "admin-1"
    logs = list(
        generation_db.scalars(
            select(KnowledgeReviewLog).order_by(KnowledgeReviewLog.id.asc())
        )
    )
    assert [log.action for log in logs] == ["submit_review", "reject"]
    assert logs[-1].new_status == "rejected"
