import hashlib

from fastapi import Request
from fastapi.testclient import TestClient

from app.auth import get_session
from app.database import get_db
from app.main import app
from app.models import (
    AgentToolCallLog,
    ChatMessage,
    ChatMessageSource,
    ChatSession,
    ExportRecord,
    GenerationRecord,
    KnowledgeSearchLog,
)
from app.schemas import AuthScope, SessionPayload, UserPayload


def _generation(
    task_id: int,
    uuid: str,
    department: str,
    status: str,
) -> GenerationRecord:
    return GenerationRecord(
        uuid=uuid,
        sso_user_id=f"user-{uuid}",
        username_snapshot=f"user-{uuid}",
        department_snapshot=department,
        task_id=task_id,
        prompt_external_id=7,
        prompt_version=1,
        input_ciphertext=f"private-input-{uuid}".encode(),
        input_nonce=b"i" * 12,
        output_ciphertext=f"private-output-{uuid}".encode(),
        output_nonce=b"o" * 12,
        key_version="v1",
        completion_token_hash=hashlib.sha256(uuid.encode()).digest(),
        status=status,
        usage_json={},
    )


def test_manager_stats_are_scoped_without_decrypting_bodies(
    generation_db,
    seeded_task,
) -> None:
    # Given: generation metadata in two departments.
    rows = [
        _generation(seeded_task.id, "sales-1", "销售", "COMPLETED"),
        _generation(seeded_task.id, "sales-2", "销售", "FAILED"),
        _generation(seeded_task.id, "tender-1", "商务投标", "COMPLETED"),
    ]
    generation_db.add_all(rows)
    generation_db.commit()

    async def manager_session(_request: Request) -> SessionPayload:
        return SessionPayload(
            user=UserPayload(id="manager-1", username="manager", role="manager"),
            scope=AuthScope(
                department="销售",
                managed_departments=["销售"],
            ),
            apps=["ai-assistant"],
        )

    app.dependency_overrides[get_db] = lambda: generation_db
    app.dependency_overrides[get_session] = manager_session

    # When: the manager requests department statistics.
    try:
        with TestClient(app) as client:
            response = client.get("/api/ai/department-stats")
    finally:
        app.dependency_overrides.pop(get_session, None)
        app.dependency_overrides.pop(get_db, None)

    # Then: only managed department metadata contributes.
    assert response.status_code == 200
    payload = response.json()
    assert payload["departments"] == ["销售"]
    assert payload["total"] == 2
    assert payload["by_department"] == {"销售": 2}
    assert "private-input" not in response.text
    assert "private-output" not in response.text


def test_admin_stats_cover_all_departments(
    generation_db,
    seeded_task,
) -> None:
    # Given: global generation metadata.
    generation_db.add_all(
        [
            _generation(seeded_task.id, "global-sales", "销售", "COMPLETED"),
            _generation(seeded_task.id, "global-tender", "商务投标", "FAILED"),
        ]
    )
    generation_db.commit()
    app.dependency_overrides[get_db] = lambda: generation_db

    # When: an administrator requests global statistics.
    try:
        with TestClient(app) as client:
            response = client.get("/api/ai/admin/stats")
    finally:
        app.dependency_overrides.pop(get_db, None)

    # Then: every department is aggregated.
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 2
    assert payload["by_department"] == {"商务投标": 1, "销售": 1}


def test_admin_stats_include_agent_quality_metrics(
    generation_db,
    seeded_task,
) -> None:
    generation_db.add_all(
        [
            _generation(seeded_task.id, "quality-ok", "交付", "COMPLETED"),
            _generation(seeded_task.id, "quality-fail", "交付", "FAILED"),
        ]
    )
    session = ChatSession(
        uuid="quality-session",
        sso_user_id="user-quality",
        title="质量统计",
        mode="NORMAL",
        status="active",
    )
    generation_db.add(session)
    generation_db.flush()
    with_source = ChatMessage(
        uuid="assistant-with-source",
        session_id=session.id,
        sso_user_id="user-quality",
        role="assistant",
        status="COMPLETED",
    )
    without_source = ChatMessage(
        uuid="assistant-without-source",
        session_id=session.id,
        sso_user_id="user-quality",
        role="assistant",
        status="COMPLETED",
    )
    generation_db.add_all([with_source, without_source])
    generation_db.flush()
    generation_db.add_all(
        [
            ChatMessageSource(
                message_id=with_source.id,
                source_type="official_knowledge",
                source_uuid="file-1",
                file_name="白皮书.docx",
            ),
            AgentToolCallLog(
                user_id="user-quality",
                tool_name="company_knowledge_search",
                status="success",
                source_count=1,
            ),
            AgentToolCallLog(
                user_id="user-quality",
                tool_name="word_export",
                status="error",
                source_count=0,
                error_code="EXPORT_FAILED",
            ),
            KnowledgeSearchLog(
                user_id="user-quality",
                question="查资料",
                mode="knowledge",
                search_type="official_rag",
                retrieved_chunk_ids_json=["chunk-1"],
                answer_message_id=with_source.uuid,
            ),
            KnowledgeSearchLog(
                user_id="user-quality",
                question="没命中",
                mode="knowledge",
                search_type="official_rag",
                retrieved_chunk_ids_json=[],
                answer_message_id=without_source.uuid,
            ),
            ExportRecord(
                conversation_id=session.uuid,
                message_id=with_source.uuid,
                file_name="导出.docx",
                file_path="/tmp/export.docx",
                export_type="single_answer",
                template_name="juxin_standard",
                created_by="user-quality",
            ),
        ]
    )
    generation_db.commit()
    app.dependency_overrides[get_db] = lambda: generation_db

    try:
        with TestClient(app) as client:
            response = client.get("/api/ai/admin/stats")
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert response.status_code == 200
    payload = response.json()
    assert payload["tool_call_total"] == 2
    assert payload["tool_call_success"] == 1
    assert payload["tool_call_success_rate"] == 0.5
    assert payload["knowledge_search_total"] == 2
    assert payload["knowledge_search_hit"] == 1
    assert payload["knowledge_search_hit_rate"] == 0.5
    assert payload["assistant_answer_total"] == 2
    assert payload["assistant_answer_with_sources"] == 1
    assert payload["citation_coverage_rate"] == 0.5
    assert payload["answer_without_source_rate"] == 0.5
    assert payload["word_export_total"] == 1
    assert payload["tool_error_distribution"] == {"EXPORT_FAILED": 1}


def test_stats_reject_ranges_over_366_days(generation_db) -> None:
    # Given: the global statistics endpoint.
    app.dependency_overrides[get_db] = lambda: generation_db

    # When: a range beyond the governance cap is requested.
    try:
        with TestClient(app) as client:
            response = client.get(
                "/api/ai/admin/stats",
                params={
                    "date_from": "2025-01-01",
                    "date_to": "2026-06-20",
                },
            )
    finally:
        app.dependency_overrides.pop(get_db, None)

    # Then: the query is rejected before database aggregation.
    assert response.status_code == 422
    assert response.json()["code"] == "STATS_RANGE_TOO_LARGE"
