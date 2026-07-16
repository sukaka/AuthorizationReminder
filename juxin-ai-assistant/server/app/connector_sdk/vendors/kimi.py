"""Kimi (Moonshot) long-document / reasoning connector.

OpenAI-compatible Chat Completions API.
Dry-run mode when api_key is empty — safe for local CI and market listing.
"""

from __future__ import annotations

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

DEFAULT_BASE_URL = "https://api.moonshot.cn/v1"
DEFAULT_MODEL = "moonshot-v1-8k"


class KimiConnector(BaseConnector):
    """External LLM connector for long-context analysis (7.0 §11.7)."""

    def __init__(
        self,
        *,
        api_key: str = "",
        base_url: str = DEFAULT_BASE_URL,
        model: str = DEFAULT_MODEL,
        connector_id: str = "kimi.chat",
        name: str = "Kimi 长文分析",
        timeout_sec: float = 60.0,
        dry_run: bool | None = None,
        max_calls_per_minute: int = 30,
    ) -> None:
        self._api_key = (api_key or "").strip()
        self._base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self._model = model or DEFAULT_MODEL
        self._timeout_sec = timeout_sec
        # dry_run when no key; explicit dry_run=True always mocks
        self._dry_run = bool(dry_run) if dry_run is not None else not bool(self._api_key)
        self.meta = ConnectorMeta(
            connector_id=connector_id,
            name=name,
            vendor="moonshot",
            version="1.0.0",
            description="Kimi/Moonshot 长文档分析与复杂推理（出域 L0–L1 默认；敏感需确认）。",
            capabilities=(
                CapabilitySpec(
                    name="long_document",
                    description="长文档阅读与摘要",
                    max_data_level="L1",
                    timeout_sec=timeout_sec,
                    cost_per_call_micros=2000,
                ),
                CapabilitySpec(
                    name="reasoning",
                    description="复杂推理与写作辅助",
                    max_data_level="L1",
                    timeout_sec=timeout_sec,
                    cost_per_call_micros=2500,
                ),
            ),
            endpoint=f"{self._base_url}/chat/completions",
            status="available" if self._api_key or self._dry_run else "draft",
        )
        self.breaker = CircuitBreaker(
            name=connector_id,
            failure_threshold=5,
            recovery_timeout_sec=45.0,
        )
        self.limiter = RateLimiter(max_calls=max_calls_per_minute, per_seconds=60.0)
        self.retry = RetryPolicy(
            max_attempts=3,
            base_delay_sec=0.2,
            max_delay_sec=3.0,
            retry_on=(TimeoutError, ConnectionError, OSError, httpx.TransportError),
        )

    @property
    def dry_run(self) -> bool:
        return self._dry_run

    def public_auth_hint(self) -> str:
        if not self._api_key:
            return "unset (dry-run)" if self._dry_run else "unset"
        return mask_secret(self._api_key)

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
        t0 = time.perf_counter()
        try:
            with httpx.Client(timeout=min(8.0, self._timeout_sec)) as client:
                resp = client.get(
                    f"{self._base_url}/models",
                    headers={"Authorization": f"Bearer {self._api_key}"},
                )
            latency = int((time.perf_counter() - t0) * 1000)
            ok = resp.status_code < 500
            return ConnectorHealth(
                ok=ok,
                status="ok" if resp.status_code < 400 else "degraded",
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
        t0 = time.perf_counter()
        if self._dry_run:
            text = (request.input_text or "").strip()
            preview = text if len(text) <= 180 else text[:180] + "…"
            return InvokeResult(
                ok=True,
                output=f"[kimi-dry-run] 已接收 {len(text)} 字任务。摘要草稿：{preview}",
                data={
                    "mode": "dry_run",
                    "model": self._model,
                    "vendor": "moonshot",
                    "char_count": len(text),
                },
                latency_ms=int((time.perf_counter() - t0) * 1000),
                attempts=1,
                connector_id=self.meta.connector_id,
            )

        attempts = 0
        timeout = request.timeout_sec or self._timeout_sec
        system = (
            "你是企业知识助手的外部分析引擎。只根据用户提供的内容作答，"
            "不要编造企业内部机密；输出简洁、可引用。"
        )
        if isinstance(request.context.get("system"), str) and request.context["system"].strip():
            system = str(request.context["system"]).strip()

        def _call() -> dict[str, Any]:
            nonlocal attempts
            attempts += 1
            payload = {
                "model": self._model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": request.input_text},
                ],
                "temperature": float(request.context.get("temperature", 0.3) or 0.3),
            }
            with httpx.Client(timeout=timeout) as client:
                resp = client.post(
                    f"{self._base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
            try:
                data: Any = resp.json()
            except Exception:
                data = {"raw": (resp.text or "")[:1000]}
            if resp.status_code >= 500:
                raise ConnectionError(f"kimi_http_{resp.status_code}")
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
                error_code="kimi_invoke_failed",
                latency_ms=int((time.perf_counter() - t0) * 1000),
                attempts=attempts or 1,
                connector_id=self.meta.connector_id,
            )

        latency = int((time.perf_counter() - t0) * 1000)
        if data.get("_error"):
            return InvokeResult(
                ok=False,
                error=f"kimi_http_{data.get('status_code')}",
                error_code="remote_http_error",
                data={"body": data.get("body"), "status_code": data.get("status_code")},
                latency_ms=latency,
                attempts=attempts,
                connector_id=self.meta.connector_id,
            )

        output = ""
        choices = data.get("choices")
        if isinstance(choices, list) and choices:
            msg = choices[0].get("message") if isinstance(choices[0], dict) else None
            if isinstance(msg, dict):
                output = str(msg.get("content") or "")
        if not output:
            output = str(data.get("output") or data)[:4000]

        usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
        return InvokeResult(
            ok=True,
            output=output,
            data={
                "model": self._model,
                "vendor": "moonshot",
                "usage": usage,
            },
            latency_ms=latency,
            attempts=attempts,
            connector_id=self.meta.connector_id,
        )
