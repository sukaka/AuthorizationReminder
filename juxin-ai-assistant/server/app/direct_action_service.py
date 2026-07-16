"""Durable guard for user-triggered side effects that are not AgentRun tools."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
import hashlib
import json
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .direct_action_inventory import direct_action_contract
from .models import DirectActionInvocation


def _utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _request_hash(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class DirectActionReplay:
    status_code: int
    payload: dict[str, Any] | None = None
    error_code: str = ""
    error_message_safe: str = ""


class DirectActionService:
    """Reserves a client idempotency key before executing a durable side effect."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def begin(
        self,
        *,
        user_id: str,
        action_name: str,
        idempotency_key: str,
        request_payload: dict[str, Any],
        timeout_seconds: int,
    ) -> tuple[DirectActionInvocation | None, DirectActionReplay | None]:
        if direct_action_contract(action_name) is None:
            raise ValueError(f"direct action is not declared: {action_name}")
        request_hash = _request_hash(request_payload)
        existing = self.db.scalar(
            select(DirectActionInvocation).where(
                DirectActionInvocation.user_id == user_id,
                DirectActionInvocation.action_name == action_name,
                DirectActionInvocation.idempotency_key == idempotency_key,
            )
        )
        if existing is not None:
            return None, self._existing(existing, request_hash, timeout_seconds)

        invocation = DirectActionInvocation(
            user_id=user_id,
            action_name=action_name,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            status="in_progress",
            started_at=_utc_now(),
        )
        try:
            with self.db.begin_nested():
                self.db.add(invocation)
                self.db.flush()
            # Persist the reservation before networking or file-system writes. A crash
            # therefore becomes reconcilable instead of silently executing twice.
            self.db.commit()
        except IntegrityError:
            existing = self.db.scalar(
                select(DirectActionInvocation).where(
                    DirectActionInvocation.user_id == user_id,
                    DirectActionInvocation.action_name == action_name,
                    DirectActionInvocation.idempotency_key == idempotency_key,
                )
            )
            if existing is not None:
                return None, self._existing(existing, request_hash, timeout_seconds)
            raise
        return invocation, None

    def succeed(self, invocation: DirectActionInvocation, *, status_code: int, payload: dict[str, Any]) -> None:
        invocation.status = "succeeded"
        invocation.response_status = status_code
        invocation.response_payload_json = payload
        invocation.finished_at = _utc_now()
        self.db.commit()

    def fail(self, invocation: DirectActionInvocation, *, error_code: str, error_message_safe: str) -> None:
        self.db.rollback()
        current = self.db.scalar(select(DirectActionInvocation).where(DirectActionInvocation.id == invocation.id))
        if current is None:
            return
        current.status = "failed"
        current.error_code = error_code
        current.error_message_safe = error_message_safe[:1000]
        current.finished_at = _utc_now()
        self.db.commit()

    def require_reconciliation(
        self,
        invocation: DirectActionInvocation,
        *,
        error_message_safe: str,
    ) -> None:
        """Discard local work when an external side effect may already have happened."""
        self.db.rollback()
        current = self.db.scalar(select(DirectActionInvocation).where(DirectActionInvocation.id == invocation.id))
        if current is None:
            return
        current.status = "reconciliation_required"
        current.error_code = "DIRECT_ACTION_RECONCILIATION_REQUIRED"
        current.error_message_safe = error_message_safe[:1000]
        current.finished_at = _utc_now()
        self.db.commit()

    def _existing(
        self,
        existing: DirectActionInvocation,
        request_hash: str,
        timeout_seconds: int,
    ) -> DirectActionReplay:
        if existing.request_hash != request_hash:
            return DirectActionReplay(
                status_code=409,
                error_code="DIRECT_ACTION_IDEMPOTENCY_KEY_CONFLICT",
                error_message_safe="同一幂等键不能用于不同的请求内容",
            )
        if existing.status == "succeeded" and isinstance(existing.response_payload_json, dict):
            return DirectActionReplay(
                status_code=existing.response_status or 200,
                payload=dict(existing.response_payload_json),
            )
        if existing.status == "failed":
            return DirectActionReplay(
                status_code=409,
                error_code=existing.error_code or "DIRECT_ACTION_PREVIOUSLY_FAILED",
                error_message_safe=existing.error_message_safe or "该操作已失败，请使用新的幂等键重新发起",
            )
        if existing.status == "in_progress" and existing.started_at:
            now = _utc_now()
            reconciled = self.db.execute(
                update(DirectActionInvocation)
                .where(
                    DirectActionInvocation.id == existing.id,
                    DirectActionInvocation.status == "in_progress",
                    DirectActionInvocation.started_at <= now - timedelta(seconds=timeout_seconds),
                )
                .values(
                    status="reconciliation_required",
                    error_code="DIRECT_ACTION_RECONCILIATION_REQUIRED",
                    error_message_safe="操作超过契约超时，结果未知，必须先对账",
                    finished_at=now,
                )
            )
            if reconciled.rowcount:
                self.db.commit()
        return DirectActionReplay(
            status_code=409,
            error_code="DIRECT_ACTION_RECONCILIATION_REQUIRED",
            error_message_safe="该操作仍在执行或结果未知，不能安全地再次执行",
        )
