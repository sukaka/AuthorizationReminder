import base64

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import get_db
from app.crypto import ContentCipher
from app.knowledge import KnowledgeRetriever
from app.main import app
from app.models import KnowledgeItem, KnowledgeTaskLink


def test_create_knowledge_encrypts_content_and_links_tasks(
    generation_db,
    seeded_task,
) -> None:
    # Given: an active task and an administrator.
    app.dependency_overrides[get_db] = lambda: generation_db

    # When: knowledge content is created and assigned to the task.
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/ai/admin/knowledge",
                json={
                    "title": "公司介绍",
                    "category": "COMPANY",
                    "tags": ["公司"],
                    "keywords": ["聚信"],
                    "content": "北京聚信得仁科技有限公司",
                    "task_uuids": [seeded_task.uuid],
                    "priority": 10,
                },
            )
    finally:
        app.dependency_overrides.pop(get_db, None)

    # Then: the body is encrypted and the validated association is persisted.
    assert response.status_code == 201
    row = generation_db.scalar(select(KnowledgeItem))
    assert row is not None
    assert "北京聚信得仁科技有限公司".encode() not in row.content_ciphertext
    link = generation_db.scalar(
        select(KnowledgeTaskLink).where(
            KnowledgeTaskLink.knowledge_id == row.id,
            KnowledgeTaskLink.task_id == seeded_task.id,
        )
    )
    assert link is not None


def test_knowledge_list_never_returns_content(
    generation_db,
    seeded_task,
) -> None:
    # Given: knowledge created through the administration boundary.
    app.dependency_overrides[get_db] = lambda: generation_db
    try:
        with TestClient(app) as client:
            create_response = client.post(
                "/api/ai/admin/knowledge",
                json={
                    "title": "产品资料",
                    "category": "PRODUCT",
                    "content": "只允许详情接口解密的正文",
                    "task_uuids": [seeded_task.uuid],
                },
            )

            # When: the metadata list is queried.
            response = client.get("/api/ai/admin/knowledge")
    finally:
        app.dependency_overrides.pop(get_db, None)

    # Then: list output contains metadata but no decrypted body.
    assert create_response.status_code == 201
    assert response.status_code == 200
    assert response.json()["items"][0]["content"] is None
    assert "只允许详情接口解密的正文" not in response.text


def test_disable_knowledge_removes_it_from_retrieval(
    generation_db,
    seeded_task,
) -> None:
    # Given: active knowledge available to the retriever.
    app.dependency_overrides[get_db] = lambda: generation_db
    try:
        with TestClient(app) as client:
            created = client.post(
                "/api/ai/admin/knowledge",
                json={
                    "title": "停用测试",
                    "category": "FAQ",
                    "keywords": ["停用"],
                    "content": "停用后不可检索",
                    "task_uuids": [seeded_task.uuid],
                },
            ).json()

            # When: the administrator disables the item.
            response = client.delete(
                f"/api/ai/admin/knowledge/{created['uuid']}"
            )
    finally:
        app.dependency_overrides.pop(get_db, None)

    # Then: the item is retained for audit but excluded from retrieval.
    assert response.status_code == 204
    retriever = KnowledgeRetriever(
        ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode("ascii"))
    )
    row = generation_db.scalar(
        select(KnowledgeItem).where(KnowledgeItem.uuid == created["uuid"])
    )
    assert row is not None
    assert row.status == "DISABLED"
    assert retriever.retrieve(generation_db, seeded_task.id, {"query": "停用"}) == []
