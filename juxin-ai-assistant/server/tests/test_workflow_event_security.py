from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.config import Settings, get_settings
from app.main import app
from app.workflow_event_security import (
    CREDENTIAL_HEADER,
    OWNER_HEADER,
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
    WorkflowEventSignatureError,
    parse_workflow_event_credentials,
    resolve_workflow_event_credential,
    sign_workflow_event,
    verify_workflow_event_signature,
)


SECRET = "workflow-event-secret-32-bytes-000000"
CREDENTIALS = (
    '{"reporting-adapter":{"secret":"'
    + SECRET
    + '","owner_user_ids":["owner-a"],"project_ids":["project-a"]}}'
)


def _event_payload() -> dict[str, object]:
    return {
        "workflow_id": "serial_summary_echo",
        "event_type": "project.updated",
        "event_key": "signed-event-1",
        "payload": {"input_text": "签名事件"},
    }


def test_workflow_event_signature_binds_owner_payload_and_timestamp() -> None:
    payload = _event_payload()
    now = datetime(2026, 7, 16, 8, 0, tzinfo=UTC)
    timestamp, signature = sign_workflow_event(
        payload,
        owner_user_id="owner-a",
        secret=SECRET,
        timestamp=int(now.timestamp()),
    )

    verify_workflow_event_signature(
        payload,
        owner_user_id="owner-a",
        timestamp_header=timestamp,
        signature_header=signature,
        secret=SECRET,
        now=now,
    )

    with pytest.raises(WorkflowEventSignatureError, match="signature_invalid"):
        verify_workflow_event_signature(
            {**payload, "event_key": "tampered"},
            owner_user_id="owner-a",
            timestamp_header=timestamp,
            signature_header=signature,
            secret=SECRET,
            now=now,
        )
    with pytest.raises(WorkflowEventSignatureError, match="signature_invalid"):
        verify_workflow_event_signature(
            payload,
            owner_user_id="owner-b",
            timestamp_header=timestamp,
            signature_header=signature,
            secret=SECRET,
            now=now,
        )


def test_workflow_event_signature_rejects_stale_or_malformed_requests() -> None:
    payload = _event_payload()
    now = datetime(2026, 7, 16, 8, 0, tzinfo=UTC)
    timestamp, signature = sign_workflow_event(
        payload,
        owner_user_id="owner-a",
        secret=SECRET,
        timestamp=int((now - timedelta(seconds=301)).timestamp()),
    )
    with pytest.raises(WorkflowEventSignatureError, match="timestamp_out_of_window"):
        verify_workflow_event_signature(
            payload,
            owner_user_id="owner-a",
            timestamp_header=timestamp,
            signature_header=signature,
            secret=SECRET,
            now=now,
        )
    with pytest.raises(WorkflowEventSignatureError, match="signature_format_invalid"):
        verify_workflow_event_signature(
            payload,
            owner_user_id="owner-a",
            timestamp_header=str(int(now.timestamp())),
            signature_header="v2=not-a-signature",
            secret=SECRET,
            now=now,
        )


def test_workflow_event_signature_settings_fail_closed() -> None:
    assert (
        Settings(workflow_event_signature_mode="disabled").workflow_event_signature_mode
        == "disabled"
    )
    with pytest.raises(ValidationError, match="WORKFLOW_EVENT_SIGNATURE_MODE"):
        Settings(workflow_event_signature_mode="unexpected")
    with pytest.raises(ValidationError, match="WORKFLOW_EVENT_SIGNATURE_CREDENTIALS"):
        Settings(
            workflow_event_signature_mode="required",
            workflow_event_signature_secret="short",
        )


def test_workflow_event_credentials_parse_and_enforce_owner_project_scope() -> None:
    resolved = resolve_workflow_event_credential(
        CREDENTIALS,
        credential_id="reporting-adapter",
        owner_user_id="owner-a",
        project_id="project-a",
    )
    assert resolved.credential_id == "reporting-adapter"
    with pytest.raises(WorkflowEventSignatureError, match="owner_not_allowed"):
        resolve_workflow_event_credential(
            CREDENTIALS,
            credential_id="reporting-adapter",
            owner_user_id="owner-b",
            project_id="project-a",
        )
    with pytest.raises(WorkflowEventSignatureError, match="project_not_allowed"):
        resolve_workflow_event_credential(
            CREDENTIALS,
            credential_id="reporting-adapter",
            owner_user_id="owner-a",
            project_id="project-b",
        )
    with pytest.raises(WorkflowEventSignatureError, match="credential_not_allowed"):
        resolve_workflow_event_credential(
            CREDENTIALS,
            credential_id="unknown",
            owner_user_id="owner-a",
            project_id="project-a",
        )
    with pytest.raises(WorkflowEventSignatureError, match="credentials_config_invalid"):
        parse_workflow_event_credentials("{}")


def test_workflow_event_credentials_rejects_unscoped_project() -> None:
    owner_only = (
        '{"owner-adapter":{"secret":"'
        + SECRET
        + '","owner_user_ids":["owner-a"]}}'
    )
    with pytest.raises(WorkflowEventSignatureError, match="project_not_allowed"):
        resolve_workflow_event_credential(
            owner_only,
            credential_id="owner-adapter",
            owner_user_id="owner-a",
            project_id="project-a",
        )


def test_signed_workflow_event_is_durable_and_idempotent(generation_client) -> None:
    settings = get_settings().model_copy(
        update={
            "workflow_event_signature_mode": "required",
            "workflow_event_signature_secret": SECRET,
        }
    )
    app.dependency_overrides[get_settings] = lambda: settings
    payload = _event_payload()
    timestamp, signature = sign_workflow_event(
        payload,
        owner_user_id="owner-a",
        secret=SECRET,
    )
    headers = {
        OWNER_HEADER: "owner-a",
        TIMESTAMP_HEADER: timestamp,
        SIGNATURE_HEADER: signature,
    }
    try:
        first = generation_client.post(
            "/api/ai/workflows/events/signed", json=payload, headers=headers
        )
        assert first.status_code == 202, first.text
        replay = generation_client.post(
            "/api/ai/workflows/events/signed", json=payload, headers=headers
        )
        assert replay.status_code == 202, replay.text
        assert replay.json()["replayed"] is True
        assert replay.json()["event_uuid"] == first.json()["event_uuid"]
    finally:
        app.dependency_overrides.pop(get_settings, None)


def test_signed_workflow_event_rejects_bad_signature_and_disabled_mode(generation_client) -> None:
    payload = _event_payload()
    timestamp, _ = sign_workflow_event(
        payload,
        owner_user_id="owner-a",
        secret=SECRET,
    )
    disabled = generation_client.post(
        "/api/ai/workflows/events/signed",
        json=payload,
        headers={
            OWNER_HEADER: "owner-a",
            TIMESTAMP_HEADER: timestamp,
            SIGNATURE_HEADER: "v1=" + ("0" * 64),
        },
    )
    assert disabled.status_code == 503

    settings = get_settings().model_copy(
        update={
            "workflow_event_signature_mode": "required",
            "workflow_event_signature_secret": SECRET,
        }
    )
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        rejected = generation_client.post(
            "/api/ai/workflows/events/signed",
            json=payload,
            headers={
                OWNER_HEADER: "owner-a",
                TIMESTAMP_HEADER: timestamp,
                SIGNATURE_HEADER: "v1=" + ("0" * 64),
            },
        )
        assert rejected.status_code == 401
        assert rejected.json()["detail"] == "workflow_event_signature_invalid"
    finally:
        app.dependency_overrides.pop(get_settings, None)


def test_signed_workflow_event_requires_credential_scope_in_deployment_mode(generation_client) -> None:
    payload = _event_payload()
    settings = get_settings().model_copy(
        update={
            "auth_dev_bypass": False,
            "workflow_event_signature_mode": "required",
            "workflow_event_signature_secret": SECRET,
            "workflow_event_signature_credentials": "",
        }
    )
    app.dependency_overrides[get_settings] = lambda: settings
    timestamp, signature = sign_workflow_event(
        payload,
        owner_user_id="owner-a",
        secret=SECRET,
    )
    try:
        rejected = generation_client.post(
            "/api/ai/workflows/events/signed",
            json=payload,
            headers={
                OWNER_HEADER: "owner-a",
                TIMESTAMP_HEADER: timestamp,
                SIGNATURE_HEADER: signature,
            },
        )
        assert rejected.status_code == 503
        assert rejected.json()["detail"] == "workflow_event_credentials_not_configured"
    finally:
        app.dependency_overrides.pop(get_settings, None)


def test_signed_workflow_event_credential_scope_and_project_binding(generation_client) -> None:
    payload = {**_event_payload(), "project_id": "project-a"}
    settings = get_settings().model_copy(
        update={
            "auth_dev_bypass": False,
            "workflow_event_signature_mode": "required",
            "workflow_event_signature_credentials": CREDENTIALS,
        }
    )
    app.dependency_overrides[get_settings] = lambda: settings
    timestamp, signature = sign_workflow_event(
        payload,
        owner_user_id="owner-a",
        secret=SECRET,
    )
    try:
        accepted = generation_client.post(
            "/api/ai/workflows/events/signed",
            json=payload,
            headers={
                CREDENTIAL_HEADER: "reporting-adapter",
                OWNER_HEADER: "owner-a",
                TIMESTAMP_HEADER: timestamp,
                SIGNATURE_HEADER: signature,
            },
        )
        assert accepted.status_code == 202, accepted.text

        _, bad_owner_signature = sign_workflow_event(
            payload,
            owner_user_id="owner-b",
            secret=SECRET,
        )
        denied_owner = generation_client.post(
            "/api/ai/workflows/events/signed",
            json=payload,
            headers={
                CREDENTIAL_HEADER: "reporting-adapter",
                OWNER_HEADER: "owner-b",
                TIMESTAMP_HEADER: timestamp,
                SIGNATURE_HEADER: bad_owner_signature,
            },
        )
        assert denied_owner.status_code == 401
        assert denied_owner.json()["detail"] == "workflow_event_owner_not_allowed"
    finally:
        app.dependency_overrides.pop(get_settings, None)
