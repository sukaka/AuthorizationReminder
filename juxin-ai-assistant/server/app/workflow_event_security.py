"""Authentication contract for controlled workflow event adapters.

The regular ``/events`` endpoint is an authenticated, first-party API.  A
small number of controlled adapters may use ``/events/signed`` instead.  The
signed envelope deliberately has no provider-specific protocol: adapters
sign a canonical JSON event together with the owner scope and a short-lived
timestamp.  ``event_key`` remains the durable idempotency key in the Inbox,
so a recent duplicate is a safe replay while an old request is rejected.
"""

from __future__ import annotations

from datetime import UTC, datetime
from dataclasses import dataclass
import hashlib
import hmac
import json
from collections.abc import Mapping
from typing import Any


SIGNATURE_VERSION = "v1"
SIGNATURE_HEADER = "X-Workflow-Event-Signature"
TIMESTAMP_HEADER = "X-Workflow-Event-Timestamp"
OWNER_HEADER = "X-Workflow-Owner-Id"
CREDENTIAL_HEADER = "X-Workflow-Event-Credential"
LEGACY_CREDENTIAL_ID = "legacy"


@dataclass(frozen=True)
class WorkflowEventCredential:
    """A bounded trust scope for one non-SSO event adapter.

    Secrets are kept in process memory only.  ``owner_user_ids`` is always
    non-empty for deployment credentials; ``project_ids`` narrows a
    credential further when an event carries a project scope.
    """

    credential_id: str
    secret: str
    owner_user_ids: frozenset[str]
    project_ids: frozenset[str]
    legacy_dev_only: bool = False


class WorkflowEventSignatureError(ValueError):
    """A stable, non-sensitive reason for rejecting a signed event."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _scope_values(value: object, *, field_name: str) -> frozenset[str]:
    if not isinstance(value, list) or not value:
        raise WorkflowEventSignatureError(f"{field_name}_allowlist_required")
    values: set[str] = set()
    for item in value:
        normalized = str(item or "").strip()
        if not normalized or len(normalized) > 128 or normalized == "*":
            raise WorkflowEventSignatureError(f"{field_name}_allowlist_invalid")
        values.add(normalized)
    return frozenset(values)


def parse_workflow_event_credentials(raw: str) -> dict[str, WorkflowEventCredential]:
    """Parse deployment credential scopes without ever exposing secret data.

    ``WORKFLOW_EVENT_SIGNATURE_CREDENTIALS`` is a JSON object whose values
    have the shape::

        {"secret": "...", "owner_user_ids": ["u1"],
         "project_ids": ["p1"]}

    ``project_ids`` is optional for owner-level events.  If it is present,
    the incoming event must carry exactly one matching project scope.
    Wildcards and empty owner lists are rejected so a typo cannot widen
    access.
    """

    text = str(raw or "").strip()
    if not text:
        raise WorkflowEventSignatureError("credentials_not_configured")
    try:
        parsed = json.loads(text)
    except (TypeError, ValueError) as exc:
        raise WorkflowEventSignatureError("credentials_config_invalid") from exc
    if not isinstance(parsed, dict) or not parsed or len(parsed) > 64:
        raise WorkflowEventSignatureError("credentials_config_invalid")
    result: dict[str, WorkflowEventCredential] = {}
    for credential_id, value in parsed.items():
        cid = str(credential_id or "").strip()
        if not cid or len(cid) > 64 or cid == "*" or cid in result:
            raise WorkflowEventSignatureError("credential_id_invalid")
        if not isinstance(value, dict):
            raise WorkflowEventSignatureError("credential_config_invalid")
        secret = str(value.get("secret") or "")
        if len(secret.encode("utf-8")) < 32:
            raise WorkflowEventSignatureError("credential_secret_invalid")
        owners = _scope_values(value.get("owner_user_ids"), field_name="owner")
        projects_raw = value.get("project_ids", [])
        if projects_raw in (None, []):
            projects = frozenset()
        else:
            projects = _scope_values(projects_raw, field_name="project")
        result[cid] = WorkflowEventCredential(
            credential_id=cid,
            secret=secret,
            owner_user_ids=owners,
            project_ids=projects,
        )
    return result


def resolve_workflow_event_credential(
    raw: str,
    *,
    credential_id: str | None,
    owner_user_id: str,
    project_id: str | None = None,
) -> WorkflowEventCredential:
    """Resolve and enforce tenant/project scope for a signed adapter.

    The function intentionally performs exact membership checks.  No wildcard
    or implicit owner/project fallback is accepted for deployment credentials.
    """

    credentials = parse_workflow_event_credentials(raw)
    cid = str(credential_id or "").strip()
    credential = credentials.get(cid)
    if credential is None:
        raise WorkflowEventSignatureError("credential_not_allowed")
    owner = str(owner_user_id or "").strip()
    if owner not in credential.owner_user_ids:
        raise WorkflowEventSignatureError("owner_not_allowed")
    project = str(project_id or "").strip()
    if credential.project_ids:
        if not project:
            raise WorkflowEventSignatureError("project_scope_required")
        if project not in credential.project_ids:
            raise WorkflowEventSignatureError("project_not_allowed")
    elif project:
        # A project-bearing event must not silently use a credential that was
        # only intended for owner-level events.
        raise WorkflowEventSignatureError("project_not_allowed")
    return credential


def workflow_event_project_id(payload: Mapping[str, Any]) -> str:
    """Extract one signed project scope from a top-level or context field."""

    top_level = str(payload.get("project_id") or "").strip()
    context = payload.get("payload")
    nested = ""
    if isinstance(context, Mapping):
        nested = str(context.get("project_id") or "").strip()
    if top_level and nested and top_level != nested:
        raise WorkflowEventSignatureError("project_scope_ambiguous")
    return top_level or nested


def canonical_workflow_event(payload: Mapping[str, Any], owner_user_id: str) -> bytes:
    """Return the bytes covered by the HMAC signature.

    Canonicalization is independent of HTTP whitespace or key ordering.  The
    owner is included in the signed envelope, preventing a valid event from
    being replayed under another owner scope.
    """

    owner = str(owner_user_id or "").strip()
    if not owner or len(owner) > 64:
        raise WorkflowEventSignatureError("owner_scope_invalid")
    envelope = {"owner_user_id": owner, "event": dict(payload)}
    try:
        encoded = json.dumps(
            envelope,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
    except (TypeError, ValueError) as exc:
        raise WorkflowEventSignatureError("event_payload_not_json") from exc
    return encoded.encode("utf-8")


def sign_workflow_event(
    payload: Mapping[str, Any],
    *,
    owner_user_id: str,
    secret: str,
    timestamp: int | None = None,
) -> tuple[str, str]:
    """Create test/adapter headers for a controlled signed event.

    This helper never logs or persists the secret.  A deployment secret must
    be at least 32 characters; enforcing the same minimum here keeps local
    adapter tests honest.
    """

    key = str(secret or "").encode("utf-8")
    if len(key) < 32:
        raise WorkflowEventSignatureError("signing_secret_not_configured")
    ts = int(timestamp if timestamp is not None else datetime.now(UTC).timestamp())
    signing_input = (
        str(ts).encode("ascii")
        + b"."
        + canonical_workflow_event(payload, owner_user_id)
    )
    digest = hmac.new(key, signing_input, hashlib.sha256).hexdigest()
    return str(ts), f"{SIGNATURE_VERSION}={digest}"


def verify_workflow_event_signature(
    payload: Mapping[str, Any],
    *,
    owner_user_id: str,
    timestamp_header: str | None,
    signature_header: str | None,
    secret: str,
    now: datetime | None = None,
    tolerance_seconds: int = 300,
) -> None:
    """Verify timestamp, HMAC and scope for a signed event.

    The durable Inbox unique key is the replay barrier for accepted events;
    this verifier supplies the independent time-window barrier for delayed or
    captured requests.  Error codes intentionally avoid exposing signatures,
    payloads or secret material.
    """

    key = str(secret or "").encode("utf-8")
    if len(key) < 32:
        raise WorkflowEventSignatureError("signing_secret_not_configured")
    owner = str(owner_user_id or "").strip()
    if not owner or len(owner) > 64:
        raise WorkflowEventSignatureError("owner_scope_invalid")
    raw_timestamp = str(timestamp_header or "").strip()
    if not raw_timestamp or not raw_timestamp.isdigit():
        raise WorkflowEventSignatureError("timestamp_invalid")
    try:
        timestamp = int(raw_timestamp)
    except ValueError as exc:  # pragma: no cover - guarded by isdigit
        raise WorkflowEventSignatureError("timestamp_invalid") from exc
    tolerance = max(1, int(tolerance_seconds))
    current = (now or datetime.now(UTC)).astimezone(UTC)
    if abs(int(current.timestamp()) - timestamp) > tolerance:
        raise WorkflowEventSignatureError("timestamp_out_of_window")

    supplied = str(signature_header or "").strip()
    version, separator, digest = supplied.partition("=")
    if separator != "=" or version != SIGNATURE_VERSION or len(digest) != 64:
        raise WorkflowEventSignatureError("signature_format_invalid")
    try:
        bytes.fromhex(digest)
    except ValueError as exc:
        raise WorkflowEventSignatureError("signature_format_invalid") from exc
    signing_input = raw_timestamp.encode("ascii") + b"." + canonical_workflow_event(payload, owner)
    expected = hmac.new(key, signing_input, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(digest, expected):
        raise WorkflowEventSignatureError("signature_invalid")


__all__ = [
    "CREDENTIAL_HEADER",
    "LEGACY_CREDENTIAL_ID",
    "OWNER_HEADER",
    "SIGNATURE_HEADER",
    "SIGNATURE_VERSION",
    "TIMESTAMP_HEADER",
    "WorkflowEventCredential",
    "WorkflowEventSignatureError",
    "canonical_workflow_event",
    "parse_workflow_event_credentials",
    "resolve_workflow_event_credential",
    "sign_workflow_event",
    "verify_workflow_event_signature",
    "workflow_event_project_id",
]
