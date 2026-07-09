import base64

import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.admin.errors import GovernanceError
from app.admin.schemas import ReviewDecision, SuggestionReviewIn
from app.admin.suggestion_service import review_suggestion
from app.auth import get_session
from app.crypto import ContentCipher
from app.database import get_db
from app.governance_models import SystemSetting, TaskSuggestion
from app.main import app
from app.schemas import AuthScope, SessionPayload, UserPayload


def _session_for(
    role: str,
    managed_departments: list[str],
) -> SessionPayload:
    return SessionPayload(
        user=UserPayload(id=f"{role}-1", username=role, role=role),
        scope=AuthScope(
            department=managed_departments[0] if managed_departments else None,
            managed_departments=managed_departments,
        ),
        apps=["ai-assistant"],
    )


def test_settings_reject_secret_like_keys(generation_db) -> None:
    # Given: an administrator settings request.
    app.dependency_overrides[get_db] = lambda: generation_db

    # When: a secret-like arbitrary key is submitted.
    try:
        with TestClient(app) as client:
            response = client.put(
                "/api/ai/admin/settings",
                json={"model_api_key": "secret"},
            )
    finally:
        app.dependency_overrides.pop(get_db, None)

    # Then: the boundary rejects it without persisting a setting.
    assert response.status_code == 422
    assert generation_db.scalar(select(SystemSetting)) is None


def test_settings_upsert_only_allowed_non_secret_values(generation_db) -> None:
    # Given: the supported settings boundary.
    app.dependency_overrides[get_db] = lambda: generation_db

    # When: approved settings are updated.
    try:
        with TestClient(app) as client:
            response = client.put(
                "/api/ai/admin/settings",
                json={
                    "history_retention_days": 90,
                    "sensitive_detection_enabled": True,
                },
            )
    finally:
        app.dependency_overrides.pop(get_db, None)

    # Then: each approved key is versionable and queryable.
    assert response.status_code == 200
    assert response.json() == {
        "history_retention_days": 90,
        "sensitive_detection_enabled": True,
    }


def test_settings_allow_admin_vector_model_configuration(generation_db) -> None:
    # Given: an administrator settings request.
    app.dependency_overrides[get_db] = lambda: generation_db

    # When: non-secret embedding model routing fields are updated.
    try:
        with TestClient(app) as client:
            response = client.put(
                "/api/ai/admin/settings",
                json={
                    "embedding_provider": "openai-compatible",
                    "embedding_base_url": "https://model.example/v1",
                    "embedding_model_id": "text-embedding-3-large",
                    "embedding_dimensions": 3072,
                },
            )
    finally:
        app.dependency_overrides.pop(get_db, None)

    # Then: the approved vector model fields are persisted and returned.
    assert response.status_code == 200
    assert response.json() == {
        "embedding_base_url": "https://model.example/v1",
        "embedding_dimensions": 3072,
        "embedding_model_id": "text-embedding-3-large",
        "embedding_provider": "openai-compatible",
    }


def test_manager_can_only_suggest_for_managed_department(
    generation_db,
) -> None:
    # Given: a manager scoped only to the sales department.
    async def manager_session(_request: Request) -> SessionPayload:
        return _session_for("manager", ["销售"])

    app.dependency_overrides[get_db] = lambda: generation_db
    app.dependency_overrides[get_session] = manager_session

    # When: the manager submits an in-scope and an out-of-scope suggestion.
    try:
        with TestClient(app) as client:
            allowed = client.post(
                "/api/ai/suggestions",
                json={
                    "department_code": "销售",
                    "suggestion_type": "PROMPT_CHANGE",
                    "content": "补充回款风险场景",
                },
            )
            denied = client.post(
                "/api/ai/suggestions",
                json={
                    "department_code": "商务投标",
                    "suggestion_type": "PROMPT_CHANGE",
                    "content": "越权建议",
                },
            )
    finally:
        app.dependency_overrides.pop(get_session, None)
        app.dependency_overrides.pop(get_db, None)

    # Then: only the managed department creates an encrypted suggestion.
    assert allowed.status_code == 201
    assert denied.status_code == 403
    rows = list(generation_db.scalars(select(TaskSuggestion)).all())
    assert len(rows) == 1
    assert "补充回款风险场景".encode() not in rows[0].content_ciphertext


def test_suggestion_review_state_is_terminal(generation_db) -> None:
    # Given: one pending manager suggestion.
    async def manager_session(_request: Request) -> SessionPayload:
        return _session_for("manager", ["销售"])

    app.dependency_overrides[get_db] = lambda: generation_db
    app.dependency_overrides[get_session] = manager_session
    try:
        with TestClient(app) as client:
            created = client.post(
                "/api/ai/suggestions",
                json={
                    "department_code": "销售",
                    "suggestion_type": "COMMON_TASK_CHANGE",
                    "content": "增加销售复盘任务",
                },
            ).json()
    finally:
        app.dependency_overrides.pop(get_session, None)

    # When: an administrator approves and then attempts to reject it.
    try:
        with TestClient(app) as client:
            approved = client.post(
                f"/api/ai/admin/suggestions/{created['uuid']}/review",
                json={"decision": "APPROVE", "comment": "同意评估"},
            )
            repeated = client.post(
                f"/api/ai/admin/suggestions/{created['uuid']}/review",
                json={"decision": "REJECT"},
            )
    finally:
        app.dependency_overrides.pop(get_db, None)

    # Then: the first terminal decision wins.
    assert approved.status_code == 200
    assert repeated.status_code == 409
    assert repeated.json()["code"] == "SUGGESTION_ALREADY_REVIEWED"


def test_concurrent_suggestion_review_cannot_overwrite_first_terminal_decision(
    generation_db,
) -> None:
    # Given: two database sessions that both observed the same pending suggestion.
    cipher = ContentCipher(base64.urlsafe_b64encode(b"k" * 32).decode("ascii"))
    encrypted = cipher.encrypt_json({"content": "并发审核"}, b"review-race")
    suggestion = TaskSuggestion(
        uuid="review-race",
        sso_user_id="manager-1",
        department_code="销售",
        suggestion_type="PROMPT_CHANGE",
        content_ciphertext=encrypted.ciphertext,
        content_nonce=encrypted.nonce,
        key_version="v1",
        status="PENDING",
    )
    generation_db.add(suggestion)
    generation_db.commit()
    competing_session = Session(
        generation_db.get_bind(),
        expire_on_commit=False,
    )
    stale = competing_session.scalar(
        select(TaskSuggestion).where(TaskSuggestion.uuid == suggestion.uuid)
    )
    assert stale is not None
    assert stale.status == "PENDING"

    # When: the first session approves and the stale session attempts rejection.
    try:
        review_suggestion(
            generation_db,
            suggestion.uuid,
            SuggestionReviewIn(decision=ReviewDecision.APPROVE),
            "admin-first",
            cipher,
        )
        generation_db.commit()
        with pytest.raises(GovernanceError, match="建议已完成审核"):
            review_suggestion(
                competing_session,
                suggestion.uuid,
                SuggestionReviewIn(decision=ReviewDecision.REJECT),
                "admin-stale",
                cipher,
            )
    finally:
        competing_session.rollback()
        competing_session.close()

    # Then: the first terminal decision remains persisted.
    generation_db.expire_all()
    persisted = generation_db.scalar(
        select(TaskSuggestion).where(TaskSuggestion.uuid == suggestion.uuid)
    )
    assert persisted is not None
    assert persisted.status == "APPROVED"
    assert persisted.reviewed_by == "admin-first"
