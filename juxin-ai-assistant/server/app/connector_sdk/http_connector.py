"""Reference HTTP connector with resilience wrappers."""

from __future__ import annotations

import time
from typing import Any

import httpx

from .base import (
    BaseConnector,
    CapabilitySpec,
    ConnectorHealth,
    ConnectorMeta,
    InvokeRequest,
    InvokeResult,
)
from .credentials import mask_secret
from .resilience import CircuitBreaker, CircuitOpenError, RateLimiter, RetryPolicy, call_with_resilience


class HttpConnector(BaseConnector):
    """POST JSON ``{input_text, context}`` to a remote endpoint."""

    def __init__(
        self,
        *,
        connector_id: str,
        name: str,
        endpoint: str,
        description: str = "",
        vendor: str = "external",
        version: str = "0.1.0",
        capabilities: list[str] | None = None,
        auth_header: str = "",
        timeout_sec: float = 30.0,
        max_calls_per_minute: int = 60,
        failure_threshold: int = 5,
        recovery_timeout_sec: float = 30.0,
        max_retries: int = 2,
    ) -> None:
        caps = tuple(
            CapabilitySpec(name=c, timeout_sec=timeout_sec) for c in (capabilities or ["http"])
        )
        self.meta = ConnectorMeta(
            connector_id=connector_id,
            name=name or connector_id,
            vendor=vendor,
            version=version,
            description=description,
            capabilities=caps,
            endpoint=endpoint,
            status="available",
        )
        self._auth_header = auth_header or ""
        self._timeout_sec = timeout_sec
        self.breaker = CircuitBreaker(
            name=connector_id,
            failure_threshold=failure_threshold,
            recovery_timeout_sec=recovery_timeout_sec,
        )
        self.limiter = RateLimiter(max_calls=max_calls_per_minute, per_seconds=60.0)
        self.retry = RetryPolicy(
            max_attempts=max(1, max_retries + 1),
            base_delay_sec=0.15,
            max_delay_sec=2.0,
            retry_on=(TimeoutError, ConnectionError, OSError, httpx.TransportError),
        )

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if not self._auth_header:
            return headers
        if ":" in self._auth_header and not self._auth_header.lower().startswith("bearer "):
            name, _, value = self._auth_header.partition(":")
            headers[name.strip()] = value.strip()
        else:
            headers["Authorization"] = self._auth_header
        return headers

    def health(self) -> ConnectorHealth:
        state = self.breaker.state
        if state == "open":
            return ConnectorHealth(
                ok=False,
                status="down",
                detail="circuit_open",
                circuit_state=state,
                consecutive_failures=self.breaker.consecutive_failures,
            )
        if not self.meta.endpoint:
            return ConnectorHealth(
                ok=False,
                status="down",
                detail="missing_endpoint",
                circuit_state=state,
            )
        t0 = time.perf_counter()
        try:
            with httpx.Client(timeout=min(5.0, self._timeout_sec)) as client:
                # Prefer HEAD; some stubs only accept POST — treat 404/405 as reachable.
                resp = client.request("GET", self.meta.endpoint, headers=self._headers())
            latency = int((time.perf_counter() - t0) * 1000)
            ok = resp.status_code < 500
            return ConnectorHealth(
                ok=ok,
                status="ok" if ok else "degraded",
                latency_ms=latency,
                detail=f"http_{resp.status_code}",
                circuit_state=self.breaker.state,
                consecutive_failures=self.breaker.consecutive_failures,
            )
        except Exception as exc:
            return ConnectorHealth(
                ok=False,
                status="down",
                detail=str(exc)[:200],
                circuit_state=self.breaker.state,
                consecutive_failures=self.breaker.consecutive_failures,
            )

    def invoke(self, request: InvokeRequest) -> InvokeResult:
        timeout = request.timeout_sec or self._timeout_sec
        t0 = time.perf_counter()
        attempts = 0

        def _call() -> dict[str, Any]:
            nonlocal attempts
            attempts += 1
            with httpx.Client(timeout=timeout) as client:
                resp = client.post(
                    self.meta.endpoint,
                    headers=self._headers(),
                    json={
                        "input_text": request.input_text,
                        "context": request.context or {},
                        "run_id": request.run_id,
                        "step_id": request.step_id,
                    },
                )
            try:
                data: Any = resp.json()
            except Exception:
                data = {"raw": (resp.text or "")[:1000]}
            if resp.status_code >= 500:
                raise ConnectionError(f"remote_http_{resp.status_code}")
            if resp.status_code >= 400:
                return {
                    "_error": True,
                    "status_code": resp.status_code,
                    "body": data,
                }
            if isinstance(data, dict):
                return data
            return {"output": str(data)}

        try:
            data = call_with_resilience(
                _call,
                breaker=self.breaker,
                limiter=self.limiter,
                retry=self.retry,
            )
        except CircuitOpenError as exc:
            return InvokeResult(
                ok=False,
                error=str(exc),
                error_code="circuit_open",
                latency_ms=int((time.perf_counter() - t0) * 1000),
                attempts=attempts or 1,
                connector_id=self.meta.connector_id,
            )
        except Exception as exc:
            return InvokeResult(
                ok=False,
                error=str(exc)[:300],
                error_code="remote_invoke_failed",
                latency_ms=int((time.perf_counter() - t0) * 1000),
                attempts=attempts or 1,
                connector_id=self.meta.connector_id,
            )

        latency = int((time.perf_counter() - t0) * 1000)
        if data.get("_error"):
            return InvokeResult(
                ok=False,
                error=f"remote_http_{data.get('status_code')}",
                error_code="remote_http_error",
                data={"body": data.get("body"), "status_code": data.get("status_code")},
                latency_ms=latency,
                attempts=attempts,
                connector_id=self.meta.connector_id,
            )
        output = ""
        if isinstance(data.get("output"), str):
            output = data["output"]
        elif isinstance(data.get("answer"), str):
            output = data["answer"]
        else:
            output = str(data)[:2000]
        # Never echo auth into result
        safe = {k: v for k, v in data.items() if k not in ("auth", "token", "api_key")}
        return InvokeResult(
            ok=True,
            output=output,
            data=safe,
            latency_ms=latency,
            attempts=attempts,
            connector_id=self.meta.connector_id,
        )

    def public_auth_hint(self) -> str:
        """Masked auth presence for admin UI — never raw secret."""
        if not self._auth_header:
            return ""
        if ":" in self._auth_header:
            name, _, value = self._auth_header.partition(":")
            return f"{name.strip()}: {mask_secret(value.strip())}"
        return mask_secret(self._auth_header)
