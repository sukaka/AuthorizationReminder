"""即梦 (Jimeng) visual generation connector.

Supports a generic HTTP image API contract and dry-run for CI.
Production can point endpoint/api_key to Volcengine or internal proxy.
"""

from __future__ import annotations

import hashlib
import time
from typing import Any

import httpx

from ..base import (
    BaseConnector,
    CapabilitySpec,
    ConnectorHealth,
    ConnectorMeta,
    InvokeRequest,
    InvokeResult,
)
from ..credentials import mask_secret
from ..resilience import CircuitBreaker, CircuitOpenError, RateLimiter, RetryPolicy, call_with_resilience

DEFAULT_ENDPOINT = "https://visual.volcengineapi.com/"  # placeholder; real deploy uses proxy


class JimengConnector(BaseConnector):
    """Image / visual asset generation (7.0 §11.8)."""

    def __init__(
        self,
        *,
        api_key: str = "",
        endpoint: str = "",
        connector_id: str = "jimeng.image",
        name: str = "即梦视觉生成",
        timeout_sec: float = 90.0,
        dry_run: bool | None = None,
        max_calls_per_minute: int = 20,
        brand_blocklist: list[str] | None = None,
    ) -> None:
        self._api_key = (api_key or "").strip()
        self._endpoint = (endpoint or DEFAULT_ENDPOINT).strip()
        self._timeout_sec = timeout_sec
        self._dry_run = bool(dry_run) if dry_run is not None else not bool(self._api_key)
        self._brand_blocklist = [b.lower() for b in (brand_blocklist or ["竞品商标伪造", "违法"])]
        self.meta = ConnectorMeta(
            connector_id=connector_id,
            name=name,
            vendor="jimeng",
            version="1.0.0",
            description="即梦等视觉能力：封面、插图、培训素材（结果需审核后入库）。",
            capabilities=(
                CapabilitySpec(
                    name="image_generation",
                    description="文生图",
                    max_data_level="L1",
                    timeout_sec=timeout_sec,
                    cost_per_call_micros=5000,
                ),
                CapabilitySpec(
                    name="cover",
                    description="PPT/报告封面",
                    max_data_level="L1",
                    timeout_sec=timeout_sec,
                    cost_per_call_micros=4000,
                ),
            ),
            endpoint=self._endpoint,
            status="available" if self._api_key or self._dry_run else "draft",
        )
        self.breaker = CircuitBreaker(
            name=connector_id,
            failure_threshold=4,
            recovery_timeout_sec=60.0,
        )
        self.limiter = RateLimiter(max_calls=max_calls_per_minute, per_seconds=60.0)
        self.retry = RetryPolicy(
            max_attempts=2,
            base_delay_sec=0.3,
            max_delay_sec=4.0,
            retry_on=(TimeoutError, ConnectionError, OSError, httpx.TransportError),
        )

    @property
    def dry_run(self) -> bool:
        return self._dry_run

    def public_auth_hint(self) -> str:
        if not self._api_key:
            return "unset (dry-run)" if self._dry_run else "unset"
        return mask_secret(self._api_key)

    def _policy_block(self, prompt: str) -> str | None:
        lowered = (prompt or "").lower()
        for word in self._brand_blocklist:
            if word and word in lowered:
                return f"brand_policy_blocked:{word}"
        return None

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
        if self._dry_run:
            return ConnectorHealth(
                ok=True,
                status="ok",
                detail="dry_run",
                latency_ms=0,
                circuit_state=state,
            )
        # Live: treat endpoint reachability softly (POST-only APIs often 405 on GET)
        t0 = time.perf_counter()
        try:
            with httpx.Client(timeout=min(8.0, self._timeout_sec)) as client:
                resp = client.get(self._endpoint, headers=self._headers())
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

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    def invoke(self, request: InvokeRequest) -> InvokeResult:
        t0 = time.perf_counter()
        prompt = (request.input_text or "").strip()
        blocked = self._policy_block(prompt)
        if blocked:
            return InvokeResult(
                ok=False,
                error=blocked,
                error_code="brand_policy_blocked",
                latency_ms=int((time.perf_counter() - t0) * 1000),
                attempts=1,
                connector_id=self.meta.connector_id,
            )

        size = str(request.context.get("size") or "1024x1024")
        style = str(request.context.get("style") or "corporate")
        if self._dry_run:
            digest = hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:16]
            asset_id = f"jimeng-dry-{digest}"
            return InvokeResult(
                ok=True,
                output=f"[jimeng-dry-run] 已生成视觉任务占位图 {asset_id}（{size}/{style}）",
                data={
                    "mode": "dry_run",
                    "asset_id": asset_id,
                    "prompt_preview": prompt[:200],
                    "size": size,
                    "style": style,
                    "review_required": True,
                    "copyright_notice": "生成内容需人工审核与用途标注后方可对外使用",
                    "vendor": "jimeng",
                },
                latency_ms=int((time.perf_counter() - t0) * 1000),
                attempts=1,
                connector_id=self.meta.connector_id,
            )

        attempts = 0
        timeout = request.timeout_sec or self._timeout_sec

        def _call() -> dict[str, Any]:
            nonlocal attempts
            attempts += 1
            body = {
                "prompt": prompt,
                "size": size,
                "style": style,
                "context": {
                    "run_id": request.run_id,
                    "step_id": request.step_id,
                },
            }
            with httpx.Client(timeout=timeout) as client:
                resp = client.post(self._endpoint, headers=self._headers(), json=body)
            try:
                data: Any = resp.json()
            except Exception:
                data = {"raw": (resp.text or "")[:1000]}
            if resp.status_code >= 500:
                raise ConnectionError(f"jimeng_http_{resp.status_code}")
            if resp.status_code >= 400:
                return {"_error": True, "status_code": resp.status_code, "body": data}
            return data if isinstance(data, dict) else {"output": str(data)}

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
                error_code="jimeng_invoke_failed",
                latency_ms=int((time.perf_counter() - t0) * 1000),
                attempts=attempts or 1,
                connector_id=self.meta.connector_id,
            )

        latency = int((time.perf_counter() - t0) * 1000)
        if data.get("_error"):
            return InvokeResult(
                ok=False,
                error=f"jimeng_http_{data.get('status_code')}",
                error_code="remote_http_error",
                data={"body": data.get("body"), "status_code": data.get("status_code")},
                latency_ms=latency,
                attempts=attempts,
                connector_id=self.meta.connector_id,
            )

        image_url = str(data.get("image_url") or data.get("url") or "")
        asset_id = str(data.get("asset_id") or data.get("id") or "")
        output = str(data.get("output") or "")
        if not output:
            output = f"已生成视觉素材 {asset_id or image_url or 'ok'}"
        return InvokeResult(
            ok=True,
            output=output,
            data={
                "vendor": "jimeng",
                "asset_id": asset_id,
                "image_url": image_url,
                "size": size,
                "style": style,
                "review_required": True,
                "copyright_notice": "生成内容需人工审核与用途标注后方可对外使用",
                **{k: v for k, v in data.items() if k not in ("api_key", "token")},
            },
            latency_ms=latency,
            attempts=attempts,
            connector_id=self.meta.connector_id,
        )
