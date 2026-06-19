import json
import re
from typing import Any

import httpx


PROMPT_VARIABLE = re.compile(
    r"\{\{\s*([a-zA-Z0-9_\u4e00-\u9fa5-]{1,64})\s*\}\}"
)


class PromptCenterClient:
    def __init__(
        self,
        base_url: str,
        runtime_token: str,
        timeout_seconds: float = 5.0,
    ) -> None:
        self.base_url = str(base_url).rstrip("/")
        self.runtime_token = str(runtime_token)
        self.timeout_seconds = timeout_seconds

    async def get_published(
        self,
        prompt_id: int,
        version: int | None = None,
    ) -> dict[str, Any]:
        params = {"version": str(version)} if version is not None else None
        async with httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self.timeout_seconds,
            headers={"x-prompt-runtime-token": self.runtime_token},
        ) as client:
            response = await client.get(
                f"/api/prompt-center/runtime/prompts/{prompt_id}/published",
                params=params,
            )
        if response.status_code == 404:
            raise LookupError("任务绑定的已发布 Prompt 不存在")
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("Prompt Center 返回格式无效")
        return payload


def _render_value(value: object) -> str:
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if value is None:
        return ""
    return str(value)


def render_prompt(template: str, values: dict[str, object]) -> str:
    required = list(dict.fromkeys(PROMPT_VARIABLE.findall(str(template))))
    missing = [name for name in required if name not in values]
    if missing:
        raise ValueError(f"缺少 Prompt 变量：{'、'.join(missing)}")
    return PROMPT_VARIABLE.sub(
        lambda match: _render_value(values[match.group(1)]),
        str(template),
    )
