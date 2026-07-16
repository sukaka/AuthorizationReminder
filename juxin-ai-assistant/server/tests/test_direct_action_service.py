from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.direct_action_service import DirectActionService
from app.models import DirectActionInvocation


def test_expired_direct_action_requires_reconciliation(generation_db) -> None:
    service = DirectActionService(generation_db)
    request = {"capture_id": "capture-1", "save_target": "personal_reference"}
    invocation, replay = service.begin(
        user_id="user-1",
        action_name="web_capture_confirm",
        idempotency_key="confirm-expired",
        request_payload=request,
        timeout_seconds=1,
    )

    assert invocation is not None
    assert replay is None
    invocation.started_at = (datetime.now(UTC) - timedelta(seconds=5)).replace(tzinfo=None)
    generation_db.commit()

    retry_invocation, retry = service.begin(
        user_id="user-1",
        action_name="web_capture_confirm",
        idempotency_key="confirm-expired",
        request_payload=request,
        timeout_seconds=1,
    )

    assert retry_invocation is None
    assert retry is not None
    assert retry.status_code == 409
    assert retry.error_code == "DIRECT_ACTION_RECONCILIATION_REQUIRED"
    stored = generation_db.scalar(select(DirectActionInvocation))
    assert stored is not None
    assert stored.status == "reconciliation_required"


def test_direct_action_rejects_undeclared_action_without_reservation(generation_db) -> None:
    service = DirectActionService(generation_db)

    with pytest.raises(ValueError, match="direct action is not declared"):
        service.begin(
            user_id="user-1",
            action_name="undeclared_side_effect",
            idempotency_key="unknown-action-key",
            request_payload={"value": "x"},
            timeout_seconds=30,
        )

    assert generation_db.scalar(select(DirectActionInvocation)) is None
