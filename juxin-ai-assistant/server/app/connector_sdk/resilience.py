"""Rate limit, circuit breaker, and retry for connector calls."""

from __future__ import annotations

import random
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TypeVar

T = TypeVar("T")


class CircuitOpenError(RuntimeError):
    """Raised when the circuit breaker is open and calls are short-circuited."""

    def __init__(self, name: str, retry_after_sec: float) -> None:
        self.name = name
        self.retry_after_sec = retry_after_sec
        super().__init__(f"circuit_open:{name}:retry_after={retry_after_sec:.1f}s")


@dataclass
class RateLimiter:
    """Token-bucket style limiter (per connector instance)."""

    max_calls: int = 60
    per_seconds: float = 60.0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    _timestamps: list[float] = field(default_factory=list, repr=False)

    def acquire(self, *, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        window_start = now - self.per_seconds
        with self._lock:
            self._timestamps = [t for t in self._timestamps if t >= window_start]
            if len(self._timestamps) >= self.max_calls:
                return False
            self._timestamps.append(now)
            return True

    def wait_time(self, *, now: float | None = None) -> float:
        now = time.monotonic() if now is None else now
        window_start = now - self.per_seconds
        with self._lock:
            self._timestamps = [t for t in self._timestamps if t >= window_start]
            if len(self._timestamps) < self.max_calls:
                return 0.0
            oldest = min(self._timestamps)
            return max(0.0, (oldest + self.per_seconds) - now)


@dataclass
class CircuitBreaker:
    """Simple closed → open → half-open circuit breaker."""

    name: str = "default"
    failure_threshold: int = 5
    recovery_timeout_sec: float = 30.0
    half_open_max_calls: int = 1
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    _failures: int = field(default=0, repr=False)
    _state: str = field(default="closed", repr=False)
    _opened_at: float = field(default=0.0, repr=False)
    _half_open_inflight: int = field(default=0, repr=False)

    @property
    def state(self) -> str:
        with self._lock:
            self._maybe_half_open_unlocked()
            return self._state

    @property
    def consecutive_failures(self) -> int:
        with self._lock:
            return self._failures

    def _maybe_half_open_unlocked(self) -> None:
        if self._state == "open":
            if time.monotonic() - self._opened_at >= self.recovery_timeout_sec:
                self._state = "half_open"
                self._half_open_inflight = 0

    def before_call(self) -> None:
        with self._lock:
            self._maybe_half_open_unlocked()
            if self._state == "open":
                remaining = max(
                    0.0,
                    self.recovery_timeout_sec - (time.monotonic() - self._opened_at),
                )
                raise CircuitOpenError(self.name, remaining)
            if self._state == "half_open":
                if self._half_open_inflight >= self.half_open_max_calls:
                    raise CircuitOpenError(self.name, self.recovery_timeout_sec)
                self._half_open_inflight += 1

    def record_success(self) -> None:
        with self._lock:
            self._failures = 0
            self._state = "closed"
            self._half_open_inflight = 0

    def record_failure(self) -> None:
        with self._lock:
            self._failures += 1
            if self._state == "half_open" or self._failures >= self.failure_threshold:
                self._state = "open"
                self._opened_at = time.monotonic()
                self._half_open_inflight = 0


@dataclass
class RetryPolicy:
    max_attempts: int = 3
    base_delay_sec: float = 0.2
    max_delay_sec: float = 5.0
    jitter: float = 0.2
    retry_on: tuple[type[BaseException], ...] = (TimeoutError, ConnectionError, OSError)

    def delay_for_attempt(self, attempt: int) -> float:
        """attempt is 1-based after a failure."""
        exp = self.base_delay_sec * (2 ** max(0, attempt - 1))
        delay = min(self.max_delay_sec, exp)
        if self.jitter > 0:
            delay *= 1.0 + random.uniform(-self.jitter, self.jitter)
        return max(0.0, delay)

    def should_retry(self, exc: BaseException, attempt: int) -> bool:
        if attempt >= self.max_attempts:
            return False
        return isinstance(exc, self.retry_on)


def call_with_resilience(
    fn: Callable[[], T],
    *,
    breaker: CircuitBreaker | None = None,
    limiter: RateLimiter | None = None,
    retry: RetryPolicy | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> T:
    """Execute ``fn`` with optional rate limit, circuit breaker and retries."""
    policy = retry or RetryPolicy(max_attempts=1)
    last_exc: BaseException | None = None
    for attempt in range(1, policy.max_attempts + 1):
        if limiter is not None and not limiter.acquire():
            wait = limiter.wait_time()
            if wait > 0 and attempt < policy.max_attempts:
                sleep(min(wait, policy.max_delay_sec))
                continue
            raise RuntimeError("rate_limited")
        if breaker is not None:
            breaker.before_call()
        try:
            result = fn()
            if breaker is not None:
                breaker.record_success()
            return result
        except CircuitOpenError:
            raise
        except Exception as exc:
            last_exc = exc
            if breaker is not None:
                breaker.record_failure()
            if not policy.should_retry(exc, attempt):
                raise
            sleep(policy.delay_for_attempt(attempt))
    assert last_exc is not None
    raise last_exc
