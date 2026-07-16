"""Connector SDK resilience + security audit + hub health."""

from __future__ import annotations

import base64
import os

import pytest

from app.connector_sdk import (
    CircuitBreaker,
    CircuitOpenError,
    CredentialVault,
    RateLimiter,
    RetryPolicy,
    call_with_resilience,
    mask_secret,
)
from app.connector_sdk.base import InvokeRequest, InvokeResult
from app.ops_security_audit import run_security_audit


def test_mask_secret_and_redact() -> None:
    assert mask_secret("") == ""
    assert "abcd" in mask_secret("abcdefghijklmnop")
    assert "*" in mask_secret("short")


def test_circuit_breaker_opens_and_recovers() -> None:
    cb = CircuitBreaker(name="t", failure_threshold=2, recovery_timeout_sec=0.01)
    cb.before_call()
    cb.record_failure()
    cb.before_call()
    cb.record_failure()
    assert cb.state == "open"
    with pytest.raises(CircuitOpenError):
        cb.before_call()
    # force half-open via time travel
    cb._opened_at = 0.0  # noqa: SLF001 — intentional test access
    assert cb.state == "half_open"
    cb.before_call()
    cb.record_success()
    assert cb.state == "closed"


def test_rate_limiter() -> None:
    lim = RateLimiter(max_calls=2, per_seconds=60.0)
    assert lim.acquire()
    assert lim.acquire()
    assert not lim.acquire()
    assert lim.wait_time() > 0


def test_retry_policy_calls() -> None:
    attempts = {"n": 0}

    def flaky() -> str:
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise ConnectionError("boom")
        return "ok"

    sleeps: list[float] = []
    result = call_with_resilience(
        flaky,
        retry=RetryPolicy(max_attempts=3, base_delay_sec=0.0, jitter=0),
        sleep=lambda s: sleeps.append(s),
    )
    assert result == "ok"
    assert attempts["n"] == 3


def test_credential_vault_roundtrip() -> None:
    key = base64.urlsafe_b64encode(os.urandom(32)).decode("ascii")
    vault = CredentialVault(key)
    sealed = vault.seal({"token": "super-secret-token", "api_key": "k"})
    assert "ciphertext_b64" in sealed
    opened = vault.open(sealed)
    assert opened["token"] == "super-secret-token"


def test_invoke_result_hub_dict() -> None:
    ok = InvokeResult(ok=True, output="hi", connector_id="x", latency_ms=12)
    d = ok.as_hub_dict()
    assert d["output"] == "hi"
    assert d["agent_id"] == "x"
    bad = InvokeResult(ok=False, error="nope", error_code="circuit_open", connector_id="x")
    assert bad.as_hub_dict()["error"] == "circuit_open"


def test_local_hub_health_and_invoke() -> None:
    from app.agent_hub import AgentHub, reset_agent_hub

    reset_agent_hub()
    hub = AgentHub()
    health = hub.health()
    assert len(health) >= 2
    assert all("agent_id" in h for h in health)
    out = hub.invoke("local.echo", input_text="hello")
    assert "echo" in out.get("output", "")
    reset_agent_hub()


def test_security_audit_api(generation_client, generation_db) -> None:
    resp = generation_client.get(
        "/api/ai/ops/security-audit",
        headers={"X-Test-User-ID": "admin", "X-Test-Role": "admin"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["overall"] in {"pass", "pass_with_warnings", "fail"}
    ids = {c["id"] for c in body["checks"]}
    assert "learning_auto_publish_off" in ids
    assert "egress_sensitive_gate" in ids
    assert "connector_sdk" in ids


def test_hub_health_api(generation_client) -> None:
    resp = generation_client.get(
        "/api/ai/agent-hub/health",
        headers={"X-Test-User-ID": "dev", "X-Test-Role": "user"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] >= 2
    assert "overall" in body


def test_run_security_audit_direct(generation_db) -> None:
    from app.config import get_settings

    report = run_security_audit(generation_db, get_settings())
    assert report["pass_count"] >= 1
    assert isinstance(report["checks"], list)
