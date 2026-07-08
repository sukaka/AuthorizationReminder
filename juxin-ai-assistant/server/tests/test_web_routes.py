from datetime import UTC, datetime

from sqlalchemy import select

from app.models import KnowledgeChunk, KnowledgeFile, WebCapture
from app.web_sources import WebFetchResult


def _fetch_result() -> WebFetchResult:
    html = """
    <html>
      <head>
        <title>WDSP 白皮书</title>
        <meta property="og:site_name" content="聚信官网">
        <meta name="description" content="WDSP 产品能力介绍">
      </head>
      <body>
        <h1>WEB 动态安全管理平台</h1>
        <p>产品支持 SQL 识别、Webshell 动态检测和 API 资产发现。</p>
      </body>
    </html>
    """.encode("utf-8")
    return WebFetchResult(
        url="https://example.com/wdsp",
        final_url="https://example.com/wdsp",
        status_code=200,
        content_type="text/html",
        content=html,
        fetched_at=datetime.now(UTC),
    )


def test_preview_web_capture_creates_preview_record(client_for_user, monkeypatch, generation_db) -> None:
    from app import web_routes

    monkeypatch.setattr(web_routes.WebFetcher, "fetch", lambda self, url: _fetch_result())
    client = client_for_user("u-web")

    response = client.post("/api/web/captures/preview", json={"url": "https://example.com/wdsp"})

    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "WDSP 白皮书"
    assert body["site_name"] == "聚信官网"
    assert body["suggested_category"] == "产品资料"
    assert body["suggested_document_type"] == "产品白皮书"
    assert generation_db.scalar(select(WebCapture).where(WebCapture.uuid == body["capture_id"])) is not None


def test_confirm_web_capture_saves_personal_reference(client_for_user, monkeypatch, generation_db) -> None:
    from app import web_routes

    monkeypatch.setattr(web_routes.WebFetcher, "fetch", lambda self, url: _fetch_result())
    client = client_for_user("u-web")
    preview = client.post("/api/web/captures/preview", json={"url": "https://example.com/wdsp"}).json()

    response = client.post(
        f"/api/web/captures/{preview['capture_id']}/confirm",
        json={
            "save_target": "personal_reference",
            "category": "产品资料",
            "document_type": "产品白皮书",
            "tags": ["WDSP"],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["knowledge_file_uuid"]
    file_record = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == body["knowledge_file_uuid"])
    )
    assert file_record is not None
    assert file_record.usage_type == "personal_reference"
    assert file_record.source_type == "web_capture"
    assert file_record.source_origin == "web_capture"
    assert file_record.web_capture_id == preview["capture_id"]
    assert file_record.source_url == "https://example.com/wdsp"
    assert file_record.file_type == "webpage"
    assert file_record.review_status == "draft"
    assert file_record.category == "产品资料"
    chunk = generation_db.scalar(select(KnowledgeChunk).where(KnowledgeChunk.file_id == file_record.id))
    assert chunk is not None
    assert chunk.metadata_json["source_origin"] == "web_capture"
    assert chunk.metadata_json["web_capture_id"] == preview["capture_id"]
    assert chunk.metadata_json["source_url"] == "https://example.com/wdsp"


def test_confirm_web_capture_submit_review_marks_pending(client_for_user, monkeypatch, generation_db) -> None:
    from app import web_routes

    monkeypatch.setattr(web_routes.WebFetcher, "fetch", lambda self, url: _fetch_result())
    client = client_for_user("u-web")
    preview = client.post("/api/web/captures/preview", json={"url": "https://example.com/wdsp"}).json()

    response = client.post(
        f"/api/web/captures/{preview['capture_id']}/confirm",
        json={"save_target": "official_knowledge_candidate"},
    )

    assert response.status_code == 200
    file_record = generation_db.scalar(
        select(KnowledgeFile).where(KnowledgeFile.uuid == response.json()["knowledge_file_uuid"])
    )
    assert file_record is not None
    assert file_record.review_status == "pending"
    assert file_record.usage_type == "personal_reference"
    assert file_record.source_origin == "web_capture"
    assert file_record.web_capture_id == preview["capture_id"]
    assert file_record.source_type == "web_capture"
    assert file_record.file_type == "webpage"
    capture = generation_db.scalar(select(WebCapture).where(WebCapture.uuid == preview["capture_id"]))
    assert capture is not None
    assert capture.review_status == "pending"


def test_confirm_web_capture_temporary_requires_conversation(client_for_user, monkeypatch) -> None:
    from app import web_routes

    monkeypatch.setattr(web_routes.WebFetcher, "fetch", lambda self, url: _fetch_result())
    client = client_for_user("u-web")
    preview = client.post("/api/web/captures/preview", json={"url": "https://example.com/wdsp"}).json()

    response = client.post(
        f"/api/web/captures/{preview['capture_id']}/confirm",
        json={"save_target": "temporary"},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "仅本次使用必须关联当前会话"
