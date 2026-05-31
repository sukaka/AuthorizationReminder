from __future__ import annotations

import json
import re
from typing import Any

import httpx

from .config import Settings
from .models import VulnerabilityRecord


SENSITIVE_KEYS = {"token", "secret", "password", "authorization", "cookie", "api_key", "apikey"}

AI_TRIAGE_JSON_SCHEMA = {
    "name": "sca_ai_triage_batch",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "vulnerability_id": {"type": "integer"},
                        "ai_risk_level": {"type": "string", "enum": ["P0", "P1", "P2", "P3", "Ignore", "Review"]},
                        "noise_reason": {"type": "string"},
                        "immediate_fix": {"type": "boolean"},
                        "suspected_false_positive": {"type": "boolean"},
                        "remediation": {"type": "string"},
                        "fix_deadline": {"type": "string"},
                        "risk_explanation": {"type": "string"},
                        "priority_score": {"type": "number"},
                    },
                    "required": [
                        "vulnerability_id",
                        "ai_risk_level",
                        "noise_reason",
                        "immediate_fix",
                        "suspected_false_positive",
                        "remediation",
                        "fix_deadline",
                        "risk_explanation",
                        "priority_score",
                    ],
                },
            }
        },
        "required": ["items"],
    },
    "strict": True,
}


def sanitize_for_ai(value: Any) -> Any:
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            lowered = str(key).lower()
            if lowered in SENSITIVE_KEYS or any(part in lowered for part in SENSITIVE_KEYS):
                result[key] = "[REDACTED]"
            else:
                result[key] = sanitize_for_ai(item)
        return result
    if isinstance(value, list):
        return [sanitize_for_ai(item) for item in value]
    if isinstance(value, str):
        return re.sub(r"://([^:/\s]+):([^@\s]+)@", "://[REDACTED]:[REDACTED]@", value)
    return value


def build_prompt(vulnerabilities: list[VulnerabilityRecord], context: dict[str, Any]) -> list[dict[str, str]]:
    payload = {
        "context": sanitize_for_ai(context),
        "vulnerabilities": [
            {
                "id": item.id,
                "cve_id": item.cve_id,
                "package": item.package_name,
                "version": item.package_version,
                "ecosystem": item.ecosystem,
                "cvss": item.cvss_score,
                "severity": item.severity,
                "description": item.description[:1200],
                "fixed_version": item.fixed_version,
                "has_poc": item.has_poc,
                "exploited_in_wild": item.exploited_in_wild,
            }
            for item in vulnerabilities
        ],
    }
    system = (
        "你是企业软件成分安全分析专家。不要只按 CVSS 排序，要综合公网暴露、核心业务、实际调用、"
        "运行路径、POC、在野利用、依赖范围、WAF/IPS、修复复杂度判断优先级。只输出符合 JSON Schema 的 JSON。"
    )
    user = "请对以下漏洞批量降噪与优先级排序：\n" + json.dumps(payload, ensure_ascii=False)
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _heuristic_result(item: VulnerabilityRecord, context: dict[str, Any]) -> dict[str, Any]:
    runtime = bool(context.get("runtime_path") or context.get("actually_called"))
    exposed = bool(context.get("internet_exposed"))
    core = bool(context.get("core_business"))
    waf = bool(context.get("has_waf_ips"))
    test_dep = item.package_version.lower().startswith("dev") or item.ecosystem == "test"
    score = item.cvss_score
    score += 20 if item.exploited_in_wild else 0
    score += 12 if item.has_poc else 0
    score += 10 if exposed else 0
    score += 8 if core else 0
    score += 8 if runtime else 0
    score -= 12 if waf else 0
    score -= 15 if test_dep else 0
    if score >= 45:
        level = "P0"
        deadline = "24小时内"
    elif score >= 30:
        level = "P1"
        deadline = "3天内"
    elif score >= 18:
        level = "P2"
        deadline = "7天内"
    elif test_dep:
        level = "Review"
        deadline = "下个迭代"
    else:
        level = "P3"
        deadline = "30天内"
    return {
        "vulnerability_id": item.id,
        "ai_risk_level": level,
        "noise_reason": "未配置 OpenAI API Key，使用本地规则降噪；结果需人工复核",
        "immediate_fix": level in {"P0", "P1"},
        "suspected_false_positive": level in {"Ignore", "Review"} and not runtime,
        "remediation": f"升级 {item.package_name} 到 {item.fixed_version or '安全版本'}，并验证运行路径",
        "fix_deadline": deadline,
        "risk_explanation": "综合 CVSS、POC、在野利用、暴露面、业务重要性与运行路径得到优先级",
        "priority_score": max(0, min(100, score)),
        "token_usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        "model": "local-heuristic",
        "raw": {},
    }


def analyze_vulnerabilities_with_ai(
    vulnerabilities: list[VulnerabilityRecord],
    context: dict[str, Any],
    settings: Settings,
) -> list[dict[str, Any]]:
    if not settings.openai_api_key:
        return [_heuristic_result(item, context) for item in vulnerabilities]

    messages = build_prompt(vulnerabilities, context)
    body = {
        "model": settings.openai_model,
        "messages": messages,
        "response_format": {"type": "json_schema", "json_schema": AI_TRIAGE_JSON_SCHEMA},
    }
    headers = {"Authorization": f"Bearer {settings.openai_api_key}", "Content-Type": "application/json"}
    with httpx.Client(timeout=settings.openai_timeout_ms / 1000) as client:
        response = client.post(settings.openai_api_url, headers=headers, json=body)
        response.raise_for_status()
    data = response.json()
    content = data["choices"][0]["message"]["content"]
    parsed = json.loads(content)
    usage = data.get("usage") or {}
    results = []
    for item in parsed.get("items", []):
        item["token_usage"] = {
            "prompt_tokens": int(usage.get("prompt_tokens") or 0),
            "completion_tokens": int(usage.get("completion_tokens") or 0),
            "total_tokens": int(usage.get("total_tokens") or 0),
        }
        item["model"] = settings.openai_model
        item["raw"] = data
        results.append(item)
    return results
