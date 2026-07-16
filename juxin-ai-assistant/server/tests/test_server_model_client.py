import asyncio

import httpx
import pytest
from fastapi import HTTPException

from app import server_model_client as client_module
from app.server_model_client import ModelRequestConfig, generate_with_model_config, stream_with_model_config


def _config() -> ModelRequestConfig:
    return ModelRequestConfig(
        base_url="https://model.example.test/v1",
        api_key="test-key",
        model_id="test-model",
        display_name="Test model",
        timeout_seconds=5,
        max_output_tokens=32,
    )


class _FakeStreamContext:
    def __init__(self, response):
        self.response = response

    async def __aenter__(self):
        return self.response

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class _FakeStreamResponse:
    def __init__(self, status_code: int):
        self.status_code = status_code
        self.request = httpx.Request("POST", "https://model.example.test/v1/chat/completions")

    def raise_for_status(self):
        if self.status_code >= 400:
            response = httpx.Response(self.status_code, request=self.request)
            raise httpx.HTTPStatusError("upstream failure", request=self.request, response=response)

    async def aiter_lines(self):
        yield "data: [DONE]"


class _FakeClient:
    def __init__(self, *, post_response=None, post_error=None, stream_response=None):
        self.post_response = post_response
        self.post_error = post_error
        self.stream_response = stream_response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    async def post(self, *args, **kwargs):
        if self.post_error:
            raise self.post_error
        return self.post_response

    def stream(self, *args, **kwargs):
        return _FakeStreamContext(self.stream_response)


@pytest.mark.parametrize(
    ("status_code", "detail", "expected_status"),
    [
        (401, "SERVER_MODEL_AUTH_FAILED", 502),
        (403, "SERVER_MODEL_AUTH_FAILED", 502),
        (408, "SERVER_MODEL_TIMEOUT", 504),
        (429, "SERVER_MODEL_RATE_LIMITED", 429),
        (500, "SERVER_MODEL_UPSTREAM_UNAVAILABLE", 503),
        (503, "SERVER_MODEL_UPSTREAM_UNAVAILABLE", 503),
        (404, "SERVER_MODEL_FAILED", 502),
    ],
)
def test_generate_classifies_model_http_failures(monkeypatch, status_code, detail, expected_status):
    request = httpx.Request("POST", "https://model.example.test/v1/chat/completions")
    response = httpx.Response(status_code, request=request)
    monkeypatch.setattr(
        client_module.httpx,
        "AsyncClient",
        lambda **kwargs: _FakeClient(post_response=response),
    )

    with pytest.raises(HTTPException) as captured:
        asyncio.run(generate_with_model_config(_config(), [{"role": "user", "content": "hi"}], 0.2))

    assert captured.value.detail == detail
    assert captured.value.status_code == expected_status


def test_generate_classifies_timeout(monkeypatch):
    request = httpx.Request("POST", "https://model.example.test/v1/chat/completions")
    monkeypatch.setattr(
        client_module.httpx,
        "AsyncClient",
        lambda **kwargs: _FakeClient(post_error=httpx.ReadTimeout("timed out", request=request)),
    )

    with pytest.raises(HTTPException) as captured:
        asyncio.run(generate_with_model_config(_config(), [{"role": "user", "content": "hi"}], 0.2))

    assert captured.value.detail == "SERVER_MODEL_TIMEOUT"
    assert captured.value.status_code == 504


@pytest.mark.parametrize(
    ("status_code", "detail"),
    [(429, "SERVER_MODEL_RATE_LIMITED"), (500, "SERVER_MODEL_UPSTREAM_UNAVAILABLE")],
)
def test_stream_classifies_model_http_failures(monkeypatch, status_code, detail):
    monkeypatch.setattr(
        client_module.httpx,
        "AsyncClient",
        lambda **kwargs: _FakeClient(stream_response=_FakeStreamResponse(status_code)),
    )

    async def collect():
        return [event async for event in stream_with_model_config(_config(), [{"role": "user", "content": "hi"}], 0.2)]

    with pytest.raises(HTTPException) as captured:
        asyncio.run(collect())

    assert captured.value.detail == detail
