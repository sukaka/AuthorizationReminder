from sqlalchemy import select

from app.governance_models import AuditLog
from app.models import FeedbackRecord


ALLOWED = {
    "USEFUL",
    "INACCURATE",
    "WRONG_FORMAT",
    "TOO_VAGUE",
    "NEEDS_EXPERTISE",
    "NOT_CLIENT_READY",
    "OTHER",
}


def test_owner_can_submit_each_feedback_type(
    generation_client,
    generation_db,
    completed_generation,
) -> None:
    for feedback_type in ALLOWED:
        response = generation_client.post(
            f"/api/ai/generations/{completed_generation.uuid}/feedback",
            json={
                "feedback_type": feedback_type,
                "content": "补充说明",
            },
        )
        assert response.status_code == 201
        assert response.json()["feedback_type"] == feedback_type

    audits = list(generation_db.scalars(
        select(AuditLog).where(AuditLog.action == "generation.feedback")
    ))
    assert {audit.metadata_json["feedback_type"] for audit in audits} == ALLOWED
    assert all(
        audit.entity_uuid == completed_generation.uuid
        for audit in audits
    )


def test_feedback_never_stores_plain_comment(
    generation_client,
    generation_db,
    completed_generation,
) -> None:
    response = generation_client.post(
        f"/api/ai/generations/{completed_generation.uuid}/feedback",
        json={
            "feedback_type": "OTHER",
            "content": "敏感反馈内容",
        },
    )

    assert response.status_code == 201
    row = generation_db.scalar(select(FeedbackRecord))
    assert row is not None
    assert "敏感反馈内容".encode() not in row.content_ciphertext


def test_feedback_requires_owner_valid_type_and_other_content(
    client_for_user,
    records,
) -> None:
    other_user = client_for_user("u-2")

    assert other_user.post(
        f"/api/ai/generations/{records.u1.uuid}/feedback",
        json={"feedback_type": "USEFUL"},
    ).status_code == 404
    assert client_for_user("u-1").post(
        f"/api/ai/generations/{records.u1.uuid}/feedback",
        json={"feedback_type": "UNKNOWN"},
    ).status_code == 422
    assert client_for_user("u-1").post(
        f"/api/ai/generations/{records.u1.uuid}/feedback",
        json={"feedback_type": "OTHER", "content": "   "},
    ).status_code == 422


def test_duplicate_feedback_type_is_rejected(
    generation_client,
    generation_db,
    completed_generation,
) -> None:
    url = f"/api/ai/generations/{completed_generation.uuid}/feedback"
    body = {"feedback_type": "USEFUL"}

    assert generation_client.post(url, json=body).status_code == 201
    duplicate = generation_client.post(url, json=body)
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"]["code"] == "FEEDBACK_DUPLICATE"
    assert len(list(generation_db.scalars(
        select(AuditLog).where(AuditLog.action == "generation.feedback")
    ))) == 1
