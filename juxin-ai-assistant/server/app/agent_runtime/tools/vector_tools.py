from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from ..tool_base import BaseTool, ToolContext, ToolResult


class ExternalVectorStoreHealthTool(BaseTool):
    name = "external_vector_store_health"
    description = "Check optional external vector store configuration and health"
    version = "1"

    def run(self, tool_input: dict, context: ToolContext) -> ToolResult:
        provider = str(tool_input.get("provider") or os.getenv("JUXIN_VECTOR_PROVIDER") or "").strip().lower()
        endpoint = str(tool_input.get("endpoint") or os.getenv("JUXIN_VECTOR_URL") or "").strip()
        if not provider or provider in {"local", "local-json"}:
            payload = {
                "configured": False,
                "provider": "local-json",
                "status": "disabled",
                "message": "未配置外部向量库，当前使用本地 JSON 向量检索",
            }
            return ToolResult(
                tool_name=self.name,
                payload=payload,
                output_summary={"provider": payload["provider"], "status": payload["status"]},
            )
        if provider != "qdrant":
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="VECTOR_PROVIDER_UNSUPPORTED",
                error_message_safe="暂不支持该外部向量库类型",
            )
        if not endpoint:
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="VECTOR_ENDPOINT_MISSING",
                error_message_safe="缺少外部向量库地址",
            )

        timeout = float(tool_input.get("timeout_seconds") or 2)
        url = endpoint.rstrip("/") + "/collections"
        request = urllib.request.Request(url, headers={"Accept": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read(4096).decode("utf-8", errors="ignore")
                parsed = json.loads(body) if body else {}
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            return ToolResult(
                tool_name=self.name,
                status="error",
                error_code="VECTOR_HEALTH_CHECK_FAILED",
                error_message_safe="外部向量库健康检查失败",
            )

        collections = parsed.get("result", {}).get("collections", [])
        payload = {
            "configured": True,
            "provider": "qdrant",
            "status": "ok",
            "collection_count": len(collections) if isinstance(collections, list) else 0,
        }
        return ToolResult(
            tool_name=self.name,
            payload=payload,
            output_summary={
                "provider": payload["provider"],
                "status": payload["status"],
                "collection_count": payload["collection_count"],
            },
        )
