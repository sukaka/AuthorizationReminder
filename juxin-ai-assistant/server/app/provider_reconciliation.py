"""Provider boundary for durable workflow side effects.

The control plane owns leases and Outbox state.  Providers only report an
outcome for an idempotency key and can query an unknown result during
reconciliation.  The fake provider in this module is deliberately local and
deterministic so failure paths can be exercised without credentials or a
network connection.
"""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from enum import StrEnum
import hashlib
from typing import Any, Protocol

from .models import WorkflowNotificationOutbox


class ProviderOutcome(StrEnum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    UNKNOWN = "unknown"


class ProviderOutcomeUnknown(RuntimeError):
    """Raised when a provider call cannot tell whether the side effect ran."""


@dataclass(frozen=True, slots=True)
class ProviderDeliveryResult:
    outcome: ProviderOutcome
    provider: str
    receipt: dict[str, Any] | None = None
    error_code: str = ""
    error_message: str = ""
    replayed: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "outcome", ProviderOutcome(self.outcome))
        if not self.provider:
            raise ValueError("provider_key_required")

    @classmethod
    def success(
        cls,
        provider: str,
        *,
        receipt: dict[str, Any] | None = None,
        replayed: bool = False,
    ) -> "ProviderDeliveryResult":
        return cls(ProviderOutcome.SUCCEEDED, provider, receipt, replayed=replayed)

    @classmethod
    def failed(
        cls,
        provider: str,
        *,
        error_code: str = "provider_rejected",
        error_message: str = "",
    ) -> "ProviderDeliveryResult":
        return cls(
            ProviderOutcome.FAILED,
            provider,
            error_code=str(error_code or "provider_rejected")[:128],
            error_message=str(error_message or "")[:500],
        )

    @classmethod
    def unknown(
        cls,
        provider: str,
        *,
        error_code: str = "provider_outcome_unknown",
        error_message: str = "",
    ) -> "ProviderDeliveryResult":
        return cls(
            ProviderOutcome.UNKNOWN,
            provider,
            error_code=str(error_code or "provider_outcome_unknown")[:128],
            error_message=str(error_message or "")[:500],
        )

    def as_metadata(self) -> dict[str, Any]:
        """Return a bounded JSON-compatible record safe to persist in Outbox."""

        return {
            "provider": self.provider[:128],
            "outcome": self.outcome.value,
            "receipt": dict(self.receipt or {}),
            "error_code": self.error_code[:128],
            "error_message": self.error_message[:500],
            "replayed": bool(self.replayed),
        }


class NotificationProvider(Protocol):
    """Minimal provider contract used by :class:`WorkflowControlWorker`."""

    provider_key: str

    def send(self, row: WorkflowNotificationOutbox) -> ProviderDeliveryResult:
        """Attempt delivery using ``row.idempotency_key``."""

    def reconcile(self, row: WorkflowNotificationOutbox) -> ProviderDeliveryResult:
        """Query provider state without issuing a second side effect."""


class FakeNotificationProvider:
    """Deterministic, in-memory provider for local tests and runbooks.

    ``scenarios`` maps an idempotency key to one mode or a queue of modes:
    ``success``, ``failure``, ``timeout``/``unknown`` and ``duplicate``.
    A duplicate call for an already successful key is always replayed and does
    not increment ``effect_count``.  ``resolve`` supplies an explicit answer
    for a previously unknown key, which ``reconcile`` returns without sending.
    """

    _KNOWN_MODES = {"success", "failure", "timeout", "unknown", "duplicate", "repeat"}

    def __init__(
        self,
        scenarios: dict[str, str | list[str] | tuple[str, ...]] | None = None,
        *,
        provider_key: str = "fake-local",
    ) -> None:
        self.provider_key = str(provider_key or "fake-local")[:128]
        self._scenario_queue: dict[str, deque[str]] = {}
        for key, scenario in (scenarios or {}).items():
            values = [scenario] if isinstance(scenario, str) else list(scenario)
            if not values:
                values = ["success"]
            normalized = [self._normalize_mode(value) for value in values]
            self._scenario_queue[str(key)] = deque(normalized)
        self._receipts: dict[str, dict[str, Any]] = {}
        self._resolutions: dict[str, ProviderOutcome] = {}
        self.send_calls: defaultdict[str, int] = defaultdict(int)
        self.reconcile_calls: defaultdict[str, int] = defaultdict(int)
        self.effect_count: defaultdict[str, int] = defaultdict(int)

    @classmethod
    def _normalize_mode(cls, value: str) -> str:
        mode = str(value or "success").strip().lower()
        if mode not in cls._KNOWN_MODES:
            raise ValueError(f"unknown_fake_provider_scenario:{mode}")
        return mode

    def _next_mode(self, key: str) -> str:
        queue = self._scenario_queue.get(key)
        if not queue:
            return "success"
        if len(queue) > 1:
            return queue.popleft()
        return queue[0]

    @staticmethod
    def _key(row: WorkflowNotificationOutbox) -> str:
        key = str(getattr(row, "idempotency_key", "") or "")
        if not key:
            raise ValueError("provider_idempotency_key_required")
        return key

    def _receipt(self, key: str) -> dict[str, Any]:
        return {
            "provider": self.provider_key,
            "provider_message_id": hashlib.sha256(key.encode("utf-8")).hexdigest()[:16],
            "idempotency_key": key,
        }

    def send(self, row: WorkflowNotificationOutbox) -> ProviderDeliveryResult:
        key = self._key(row)
        self.send_calls[key] += 1
        existing = self._receipts.get(key)
        if existing is not None:
            return ProviderDeliveryResult.success(self.provider_key, receipt=existing, replayed=True)

        mode = self._next_mode(key)
        if mode in {"timeout", "unknown"}:
            return ProviderDeliveryResult.unknown(
                self.provider_key,
                error_code="fake_timeout" if mode == "timeout" else "fake_unknown",
                error_message="fake provider did not confirm the outcome",
            )
        if mode == "failure":
            return ProviderDeliveryResult.failed(
                self.provider_key,
                error_code="fake_rejected",
                error_message="fake provider rejected the delivery",
            )

        receipt = self._receipt(key)
        self._receipts[key] = receipt
        self.effect_count[key] += 1
        # ``duplicate`` is a useful explicit scenario label; its first call is
        # the original effect and subsequent calls use the idempotent path.
        return ProviderDeliveryResult.success(self.provider_key, receipt=receipt)

    def reconcile(self, row: WorkflowNotificationOutbox) -> ProviderDeliveryResult:
        key = self._key(row)
        self.reconcile_calls[key] += 1
        receipt = self._receipts.get(key)
        if receipt is not None:
            return ProviderDeliveryResult.success(self.provider_key, receipt=receipt, replayed=True)
        resolution = self._resolutions.get(key)
        if resolution is ProviderOutcome.SUCCEEDED:
            receipt = self._receipt(key)
            self._receipts[key] = receipt
            self.effect_count[key] += 1
            return ProviderDeliveryResult.success(self.provider_key, receipt=receipt, replayed=True)
        if resolution is ProviderOutcome.FAILED:
            return ProviderDeliveryResult.failed(
                self.provider_key,
                error_code="fake_reconciled_failure",
                error_message="fake provider confirmed no delivery",
            )
        return ProviderDeliveryResult.unknown(
            self.provider_key,
            error_code="fake_unresolved",
            error_message="fake provider has no confirmed outcome",
        )

    def resolve(self, idempotency_key: str, outcome: ProviderOutcome | str) -> None:
        """Set an explicit reconciliation answer for a key."""

        normalized = "succeeded" if str(outcome).strip().lower() == "success" else outcome
        normalized = ProviderOutcome(normalized)
        self._resolutions[str(idempotency_key)] = normalized


__all__ = [
    "FakeNotificationProvider",
    "NotificationProvider",
    "ProviderDeliveryResult",
    "ProviderOutcome",
    "ProviderOutcomeUnknown",
]
