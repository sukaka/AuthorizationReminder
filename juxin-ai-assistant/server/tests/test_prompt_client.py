import httpx
import pytest

from app.prompt_client import PromptCenterClient, render_prompt


PUBLISHED_PROMPT = {
    "prompt_id": 7,
    "version_id": 9,
    "version_no": 2,
    "title": "工作总结",
    "summary": "",
    "content": "请总结 {{ 工作内容 }}",
    "tags": ["通用"],
    "variables": ["工作内容"],
}


@pytest.mark.asyncio
async def test_prompt_client_reads_published_version_with_runtime_token(
    respx_mock,
) -> None:
    route = respx_mock.get(
        "http://prompt.test:5189/api/prompt-center/runtime/prompts/7/published",
        params={"version": "2"},
    ).mock(return_value=httpx.Response(200, json=PUBLISHED_PROMPT))
    client = PromptCenterClient(
        "http://prompt.test:5189",
        "r" * 32,
        timeout_seconds=2,
    )

    result = await client.get_published(7, version=2)

    assert result == PUBLISHED_PROMPT
    outbound = route.calls[0].request
    assert outbound.headers["x-prompt-runtime-token"] == "r" * 32
    assert "authorization" not in outbound.headers
    assert "cookie" not in outbound.headers


@pytest.mark.asyncio
async def test_prompt_client_maps_missing_published_prompt_to_lookup_error(
    respx_mock,
) -> None:
    respx_mock.get(
        "http://prompt.test:5189/api/prompt-center/runtime/prompts/7/published"
    ).mock(return_value=httpx.Response(404, json={"error": "已发布提示词不存在"}))
    client = PromptCenterClient("http://prompt.test:5189", "r" * 32)

    with pytest.raises(LookupError, match="已发布 Prompt 不存在"):
        await client.get_published(7)


@pytest.mark.asyncio
async def test_prompt_client_validates_staged_version_with_runtime_token(
    respx_mock,
) -> None:
    staged_prompt = {
        "prompt_id": 7,
        "version_no": 4,
        "content": "草稿版本 {{工作内容}}",
    }
    route = respx_mock.get(
        "http://prompt.test:5189/api/prompt-center/runtime/prompts/7/staged",
        params={"version": "4"},
    ).mock(return_value=httpx.Response(200, json=staged_prompt))
    client = PromptCenterClient("http://prompt.test:5189", "r" * 32)

    result = await client.get_staged(7, version=4)

    assert result == staged_prompt
    assert route.calls[0].request.headers["x-prompt-runtime-token"] == "r" * 32


@pytest.mark.asyncio
async def test_prompt_client_maps_missing_staged_version_to_lookup_error(
    respx_mock,
) -> None:
    respx_mock.get(
        "http://prompt.test:5189/api/prompt-center/runtime/prompts/7/staged",
        params={"version": "99"},
    ).mock(return_value=httpx.Response(404, json={"error": "暂存 Prompt 版本不存在"}))
    client = PromptCenterClient("http://prompt.test:5189", "r" * 32)

    with pytest.raises(LookupError, match="暂存 Prompt 版本不存在"):
        await client.get_staged(7, version=99)


def test_render_prompt_supports_spaced_variables_and_structured_values() -> None:
    rendered = render_prompt(
        "客户：{{ 客户名称 }}\n事项：{{事项}}",
        {"客户名称": "聚信", "事项": ["统一登录", "加密存储"]},
    )

    assert rendered == '客户：聚信\n事项：["统一登录","加密存储"]'


def test_render_prompt_rejects_missing_variables() -> None:
    with pytest.raises(ValueError, match="缺少 Prompt 变量：事项"):
        render_prompt("客户：{{客户名称}}；事项：{{事项}}", {"客户名称": "聚信"})
