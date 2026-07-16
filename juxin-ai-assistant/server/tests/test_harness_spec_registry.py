from __future__ import annotations

import base64
from copy import deepcopy

import pytest

from app.agent_run_service import AgentRunService
from app.crypto import ContentCipher
from app.harness_spec import load_harness_spec
from app.harness_spec_registry import HarnessSpecRegistry, HarnessSpecRegistryError


def _next_spec_version(version: str) -> dict:
    payload = deepcopy(load_harness_spec())
    payload["spec_version"] = version
    return payload


def _service(db) -> AgentRunService:
    return AgentRunService(db, ContentCipher(base64.urlsafe_b64encode(b"a" * 32).decode("ascii")))


def test_bootstrap_creates_one_active_repository_spec(generation_db):
    registry = HarnessSpecRegistry(generation_db)

    active = registry.get_or_bootstrap_active()

    assert active.semantic_version == "1.0.0"
    assert active.status == "active"
    assert active.content_hash
    assert registry.get_or_bootstrap_active().uuid == active.uuid


def test_independent_approval_activation_rollback_and_run_binding(generation_db):
    registry = HarnessSpecRegistry(generation_db)
    registry.get_or_bootstrap_active()

    candidate = registry.register(
        payload=_next_spec_version("1.0.1"),
        actor_id="author-user",
    )
    registry.submit_for_approval(candidate.uuid, actor_id="author-user")

    with pytest.raises(HarnessSpecRegistryError, match="independent_approval_required"):
        registry.approve(candidate.uuid, actor_id="author-user")

    registry.approve(candidate.uuid, actor_id="reviewer-user")
    active = registry.activate(candidate.uuid, actor_id="operator-user")

    service = _service(generation_db)
    run = service.create_run(owner_user_id="101", input_text="test")

    assert run.harness_spec_uuid == active.uuid
    assert run.harness_spec_version == "1.0.1"
    assert run.harness_spec_hash == active.content_hash

    newer = registry.register(payload=_next_spec_version("1.0.2"), actor_id="author-two")
    registry.submit_for_approval(newer.uuid, actor_id="author-two")
    registry.approve(newer.uuid, actor_id="reviewer-two")
    registry.activate(newer.uuid, actor_id="operator-two")

    restored = registry.rollback(active.uuid, actor_id="operator-three")

    assert restored.uuid == active.uuid
    assert restored.status == "active"
    assert run.harness_spec_version == "1.0.1"
    assert registry.list_audit_actions(restored.uuid)[-1] == "rollback"


def test_active_spec_fails_closed_when_registry_has_history_but_no_active_version(generation_db):
    registry = HarnessSpecRegistry(generation_db)
    active = registry.get_or_bootstrap_active()
    active.status = "retired"
    generation_db.flush()

    with pytest.raises(HarnessSpecRegistryError, match="active_spec_missing"):
        registry.get_or_bootstrap_active()
