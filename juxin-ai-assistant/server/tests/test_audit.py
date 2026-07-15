from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app import models  # noqa: F401
from app.audit import (
    AuditActor,
    AuditEvent,
    AuditRequest,
    sanitize_metadata,
    stable_request_hash,
    write_audit,
)
from app.database import Base
from app.governance_models import AuditLog


def test_sanitize_metadata_keeps_only_whitelisted_non_content_fields() -> None:
    # Given: metadata containing unknown, secret, and nested content fields.
    metadata = {
        "task_uuid": "task-1",
        "risk_confirmation": True,
        "from_version": 1,
        "to_version": 2,
        "api_key": "secret",
        "authorization": "Bearer secret",
        "input": "private input",
        "output": "private output",
        "status": {
            "name": "COMPLETE",
            "nested": {
                "cookie": "session=secret",
                "token": "secret",
                "prompt_content": "private prompt",
                "apiKey": "camel-case secret",
                "access_token": "access secret",
                "password": "password secret",
                "notes": "private body disguised as notes",
                "safe": "kept",
            },
        },
        "unexpected": "drop me",
    }

    # When: the metadata crosses the audit boundary.
    cleaned = sanitize_metadata(metadata)

    # Then: only approved structure remains and sensitive keys are removed recursively.
    assert cleaned == {
        "task_uuid": "task-1",
        "risk_confirmation": True,
        "from_version": 1,
        "to_version": 2,
        "status": {"name": "COMPLETE", "nested": {"safe": "kept"}},
    }


def test_sanitize_metadata_keeps_prompt_identity_but_removes_prompt_body() -> None:
    # Given: audit metadata separates Prompt Center identity from prompt content.
    metadata = {
        "prompt_external_id": 88,
        "prompt_version": 12,
        "prompt": "private prompt body",
        "status": {
            "prompt_external_id": 99,
            "prompt_version": 13,
            "prompt_content": "nested private prompt body",
            "secret": "nested secret",
        },
    }

    # When: metadata crosses the audit boundary.
    cleaned = sanitize_metadata(metadata)

    # Then: allowlisted identifiers remain while all prompt bodies and secrets go.
    assert cleaned == {
        "prompt_external_id": 88,
        "prompt_version": 12,
        "status": {
            "prompt_external_id": 99,
            "prompt_version": 13,
        },
    }


def test_request_hash_is_stable_and_salted() -> None:
    # Given: one request attribute and two salts.
    value = "10.0.0.8"

    # When: hashes are generated repeatedly.
    first = stable_request_hash(value, "salt")
    repeated = stable_request_hash(value, "salt")
    other_salt = stable_request_hash(value, "other")

    # Then: the same inputs are stable while the salt separates domains.
    assert first == repeated
    assert first != other_salt
    assert len(first) == 64


def test_write_audit_persists_only_sanitized_metadata_and_hashes() -> None:
    # Given: an isolated database and an event containing forbidden body fields.
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    actor = AuditActor(sso_user_id="user-1", username="张三")
    request = AuditRequest(ip_address="10.0.0.8", user_agent="test-agent")
    event = AuditEvent(
        action="generation.complete",
        entity_type="generation",
        entity_uuid="generation-1",
        result="SUCCESS",
        metadata={
            "generation_uuid": "generation-1",
            "input": "private input",
            "output": "private output",
            "prompt_content": "private prompt",
        },
    )

    # When: the event is added to the caller-owned transaction.
    with Session(engine, expire_on_commit=False) as db:
        write_audit(db, actor, request, event, hash_salt="audit-salt")
        db.commit()
        stored = db.scalar(select(AuditLog))

    # Then: no body is stored and request attributes are irreversibly represented.
    assert stored is not None
    assert stored.metadata_json == {"generation_uuid": "generation-1"}
    assert stored.ip_hash == stable_request_hash("10.0.0.8", "audit-salt")
    assert stored.user_agent_hash == stable_request_hash("test-agent", "audit-salt")
    serialized = repr(stored.metadata_json)
    assert "private input" not in serialized
    assert "private output" not in serialized
    assert "private prompt" not in serialized
    engine.dispose()
