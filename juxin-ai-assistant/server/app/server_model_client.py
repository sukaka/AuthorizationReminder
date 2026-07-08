from collections.abc import AsyncIterator
from dataclasses import dataclass
import json
from time import perf_counter

import httpx
from fastapi import HTTPException

from .config import Settings


@dataclass(frozen=True)
class ServerModelResult:
    output: str
    model_display_name: str
    model_id: str
    usage: dict
    latency_ms: int


@dataclass(frozen=True)
class ServerModelStreamEvent:
    delta: str = ""
    usage: dict | None = None
    latency_ms: int | None = None


@dataclass(frozen=True)
class ModelRequestConfig:
    base_url: str
    api_key: str
    model_id: str
    display_name: str
    timeout_seconds: int
    max_output_tokens: int


def is_server_model_configured(settings: Settings) -> bool:
    return bool(
        settings.server_model_base_url.strip()
        and settings.server_model_api_key.strip()
        and settings.server_model_id.strip()
    )


def _chat_completions_url(base_url: str) -> str:
    return f"{base_url.rstrip('/')}/chat/completions"


async def generate_with_server_model(
    settings: Settings,
    messages: list[dict[str, str]],
    temperature: float,
) -> ServerModelResult:
    if not is_server_model_configured(settings):
        raise HTTPException(status_code=409, detail="SERVER_MODEL_NOT_CONFIGURED")
    return await generate_with_model_config(
        ModelRequestConfig(
            base_url=settings.server_model_base_url,
            api_key=settings.server_model_api_key,
            model_id=settings.server_model_id,
            display_name=settings.server_model_display_name or settings.server_model_id,
            timeout_seconds=settings.server_model_timeout_seconds,
            max_output_tokens=settings.server_model_max_output_tokens,
        ),
        messages,
        temperature,
    )


async def generate_with_model_config(
    config: ModelRequestConfig,
    messages: list[dict[str, str]],
    temperature: float,
) -> ServerModelResult:
    started = perf_counter()
    try:
        async with httpx.AsyncClient(timeout=config.timeout_seconds) as client:
            response = await client.post(
                _chat_completions_url(config.base_url),
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": config.model_id,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": config.max_output_tokens,
                },
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in {401, 403}:
            raise HTTPException(status_code=502, detail="SERVER_MODEL_AUTH_FAILED") from exc
        raise HTTPException(status_code=502, detail="SERVER_MODEL_FAILED") from exc
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="SERVER_MODEL_FAILED") from exc

    choices = payload.get("choices") if isinstance(payload, dict) else None
    first_choice = choices[0] if isinstance(choices, list) and choices else {}
    message = first_choice.get("message") if isinstance(first_choice, dict) else {}
    output = str((message or {}).get("content") or "").strip()
    if not output:
        raise HTTPException(status_code=502, detail="SERVER_MODEL_EMPTY_OUTPUT")

    usage = payload.get("usage") if isinstance(payload, dict) else {}
    return ServerModelResult(
        output=output,
        model_display_name=config.display_name,
        model_id=config.model_id,
        usage=usage if isinstance(usage, dict) else {},
        latency_ms=max(0, round((perf_counter() - started) * 1000)),
    )


async def stream_with_model_config(
    config: ModelRequestConfig,
    messages: list[dict[str, str]],
    temperature: float,
) -> AsyncIterator[ServerModelStreamEvent]:
    started = perf_counter()
    usage: dict = {}
    try:
        async with httpx.AsyncClient(timeout=config.timeout_seconds) as client:
            async with client.stream(
                "POST",
                _chat_completions_url(config.base_url),
                headers={
                    "Authorization": f"Bearer {config.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": config.model_id,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": config.max_output_tokens,
                    "stream": True,
                },
            ) as response:
                response.raise_for_status()
                async for raw_line in response.aiter_lines():
                    line = raw_line.strip()
                    if not line or line.startswith(":"):
                        continue
                    if line.startswith("data:"):
                        line = line.removeprefix("data:").strip()
                    if line == "[DONE]":
                        break
                    payload = json.loads(line)
                    if not isinstance(payload, dict):
                        continue
                    payload_usage = payload.get("usage")
                    if isinstance(payload_usage, dict):
                        usage = payload_usage
                    choices = payload.get("choices")
                    first_choice = choices[0] if isinstance(choices, list) and choices else {}
                    if not isinstance(first_choice, dict):
                        continue
                    delta = first_choice.get("delta")
                    message = first_choice.get("message")
                    content = ""
                    if isinstance(delta, dict):
                        content = str(delta.get("content") or "")
                    elif isinstance(message, dict):
                        content = str(message.get("content") or "")
                    else:
                        content = str(first_choice.get("text") or "")
                    if content:
                        yield ServerModelStreamEvent(delta=content)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in {401, 403}:
            raise HTTPException(status_code=502, detail="SERVER_MODEL_AUTH_FAILED") from exc
        raise HTTPException(status_code=502, detail="SERVER_MODEL_FAILED") from exc
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=502, detail="SERVER_MODEL_FAILED") from exc

    yield ServerModelStreamEvent(
        usage=usage,
        latency_ms=max(0, round((perf_counter() - started) * 1000)),
    )
