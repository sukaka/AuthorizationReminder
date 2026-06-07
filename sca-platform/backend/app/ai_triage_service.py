from __future__ import annotations

import json
import re
import time
from hashlib import sha256
from typing import Any

import httpx
from sqlalchemy.orm import Session

from .config import Settings
import logging

logger = logging.getLogger(__name__)

from .models import AiTriageResult, Component, Project, RemediationEvent, RemediationTicket, VulnerabilityRecord


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
                        "ai_priority": {"type": "string", "enum": ["P0", "P1", "P2", "P3", "Review", "Ignore"]},
                        "confidence": {"type": "number"},
                        "is_likely_false_positive": {"type": "boolean"},
                        "reason": {"type": "string"},
                        "evidence_summary": {"type": "string"},
                        "business_impact": {"type": "string"},
                        "fix_advice": {"type": "string"},
                        "fix_deadline": {"type": "string"},
                        "temporary_mitigation": {"type": "string"},
                        "need_manual_review": {"type": "boolean"},
                        "manual_review_reason": {"type": "string"},
                    },
                    "required": [
                        "vulnerability_id",
                        "ai_priority",
                        "confidence",
                        "is_likely_false_positive",
                        "reason",
                        "evidence_summary",
                        "business_impact",
                        "fix_advice",
                        "fix_deadline",
                        "temporary_mitigation",
                        "need_manual_review",
                        "manual_review_reason",
                    ],
                },
            }
        },
        "required": ["items"],
    },
    "strict": True,
}

JSON_SCHEMA_UNAVAILABLE_PATTERN = "response_format type is unavailable"

AI_TRIAGE_JSON_FORMAT_INSTRUCTIONS = (
    "\n你必须严格按以下 JSON Schema 输出，只输出 JSON，不要包含 markdown 代码块标记：\n"
    + json.dumps(AI_TRIAGE_JSON_SCHEMA["schema"], ensure_ascii=False)
)

AI_SCHEMA_VERSION = "ai-triage-v2"

AI_TRIAGE_PROMPT_TEMPLATE = (
    "你是企业软件供应链安全分析专家。必须只基于系统提供的结构化上下文分析，禁止捏造 PoC、"
    "在野利用、KEV、EPSS、可达性或业务事实。不要只按照 CVSS 排序，必须综合公网暴露、"
    "核心业务、实际调用、运行路径、PoC、在野利用、开发/测试依赖、WAF/IPS、防护措施和修复复杂度。"
    "如果上下文不足，必须输出 Review 并说明人工复核原因。只输出符合 JSON Schema 的 JSON。"
)


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


def _component_payload(item: VulnerabilityRecord) -> dict[str, Any]:
    try:
        component = getattr(item, "component", None)
    except Exception:
        component = None
    if not isinstance(component, Component):
        return {"name": item.package_name, "version": item.package_version, "ecosystem": item.ecosystem}
    return {
        "id": component.id,
        "package_name": component.package_name,
        "normalized_name": component.normalized_name,
        "package_manager": component.package_manager,
        "ecosystem": component.ecosystem,
        "purl": component.purl,
        "cpe": component.cpe,
        "version": component.package_version,
        "version_normalized": component.version_normalized,
        "scope": component.scope,
        "dependency_type": component.dependency_type,
        "evidence_file": component.evidence_file,
        "evidence_line": component.evidence_line,
        "detected_by": component.detected_by,
        "confidence_score": component.confidence_score,
    }


def structured_item(item: VulnerabilityRecord, context: dict[str, Any]) -> dict[str, Any]:
    try:
        component = getattr(item, "component", None)
    except Exception:
        component = None
    return {
        "project_context": sanitize_for_ai(context),
        "component": _component_payload(item),
        "vulnerability": {
            "id": item.id,
            "source": item.source,
            "advisory_id": item.advisory_id,
            "cve_id": item.cve_id,
            "cvss": item.cvss_score,
            "severity": item.severity,
            "description": item.description[:1200],
            "fixed_version": item.fixed_version,
            "published_at": item.published_at_text,
            "has_poc": item.has_poc,
            "exploited_in_wild": item.exploited_in_wild,
            "epss_score": item.epss_score,
            "cisa_kev": item.cisa_kev,
        },
        "matching_evidence": {
            "confidence_score": item.confidence_score,
            "match_status": item.match_status,
            "matched_by": item.matched_by,
            "match_reason": item.match_reason,
            "version_range": item.version_range,
            "needs_human_review": item.needs_human_review,
            "false_positive_possibility": item.false_positive_possibility,
        },
        "reachability": {
            "status": item.reachability_status,
            "evidence": item.reachability_evidence,
            "entry_points": item.entry_points,
            "related_files": item.related_files,
            "call_path_summary": item.call_path_summary,
        },
        "runtime_and_business": {
            "runtime_dependency": bool(component is not None and getattr(component, "scope", "") == "runtime"),
            "development_dependency": bool(component is not None and "dev" in f"{getattr(component, 'scope', '')} {getattr(component, 'dependency_type', '')}".lower()),
            "test_dependency": bool(component is not None and "test" in f"{getattr(component, 'scope', '')} {getattr(component, 'dependency_type', '')}".lower()),
            "internet_exposed": bool(context.get("internet_exposed")),
            "core_business": bool(context.get("core_business")),
            "actually_called": bool(context.get("actually_called")),
            "runtime_path": bool(context.get("runtime_path")),
            "has_waf_ips": bool(context.get("has_waf_ips")),
            "fix_complexity": context.get("fix_complexity", "medium"),
        },
    }


def triage_input_hash(item: VulnerabilityRecord, context: dict[str, Any]) -> str:
    payload = {"schema": AI_SCHEMA_VERSION, "item": structured_item(item, context)}
    return sha256(json.dumps(sanitize_for_ai(payload), ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def build_prompt(vulnerabilities: list[VulnerabilityRecord], context: dict[str, Any]) -> list[dict[str, str]]:
    payload = {
        "schema_version": AI_SCHEMA_VERSION,
        "context": sanitize_for_ai(context),
        "items": [structured_item(item, context) for item in vulnerabilities],
    }
    system = AI_TRIAGE_PROMPT_TEMPLATE
    user = "请对以下漏洞批量降噪与优先级排序：\n" + json.dumps(payload, ensure_ascii=False)
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _heuristic_result(item: VulnerabilityRecord, context: dict[str, Any]) -> dict[str, Any]:
    runtime = bool(context.get("runtime_path") or context.get("actually_called") or item.reachability_status == "reachable")
    exposed = bool(context.get("internet_exposed"))
    core = bool(context.get("core_business"))
    waf = bool(context.get("has_waf_ips"))
    try:
        component = getattr(item, "component", None)
    except Exception:
        component = None
    dependency_text = f"{getattr(component, 'scope', '')} {getattr(component, 'dependency_type', '')}".lower()
    dev_dep = "dev" in dependency_text
    test_dep = "test" in dependency_text or item.package_version.lower().startswith("dev") or item.ecosystem == "test"
    fix_complexity = str(context.get("fix_complexity") or "medium").lower()
    score = item.cvss_score
    score += 20 if item.exploited_in_wild else 0
    score += 12 if item.has_poc else 0
    score += 10 if exposed else 0
    score += 8 if core else 0
    score += 8 if runtime else 0
    score -= 12 if waf else 0
    score -= 10 if dev_dep else 0
    score -= 15 if test_dep else 0
    score -= 8 if fix_complexity == "high" else 0
    score += 4 if fix_complexity == "low" and item.fixed_version else 0
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
    if item.needs_human_review or item.match_status != "affected":
        level = "Review"
        deadline = "人工确认后排期"
    if test_dep and item.reachability_status == "not_found" and not item.exploited_in_wild:
        level = "Ignore" if item.match_status == "affected" else "Review"
        deadline = "下个迭代复核"
    evidence = (
        f"匹配：{item.matched_by or 'unknown'}；版本：{item.match_status}；可达性：{item.reachability_status}；"
        f"公网：{exposed}；核心业务：{core}；PoC：{item.has_poc}；在野利用：{item.exploited_in_wild}；"
        f"开发依赖：{dev_dep}；测试依赖：{test_dep}；WAF/IPS：{waf}；修复复杂度：{fix_complexity}"
    )
    reason = "未配置 OpenAI API Key，使用本地结构化规则；结论仅基于系统上下文"
    return {
        "vulnerability_id": item.id,
        "ai_priority": level,
        "confidence": 0.72 if level != "Review" else 0.35,
        "is_likely_false_positive": level in {"Ignore", "Review"} and item.reachability_status == "not_found",
        "reason": reason,
        "evidence_summary": evidence,
        "business_impact": item.business_impact or ("公网核心业务风险较高" if exposed and core else "需结合业务暴露面确认"),
        "fix_advice": f"升级 {item.package_name} 到 {item.fixed_version or '安全版本'}，并复测入口和调用路径",
        "temporary_mitigation": "启用 WAF/IPS、限制暴露面、最小权限和访问控制" if not waf else "确认现有 WAF/IPS 规则覆盖该攻击面",
        "need_manual_review": level == "Review",
        "manual_review_reason": "匹配、版本范围或可达性证据不足" if level == "Review" else "",
        "ai_risk_level": level,
        "noise_reason": reason,
        "immediate_fix": level in {"P0", "P1"},
        "suspected_false_positive": level in {"Ignore", "Review"} and not runtime,
        "remediation": f"升级 {item.package_name} 到 {item.fixed_version or '安全版本'}，并验证运行路径",
        "fix_deadline": deadline,
        "risk_explanation": evidence,
        "priority_score": max(0, min(100, score)),
        "ai_schema_version": AI_SCHEMA_VERSION,
        "input_hash": triage_input_hash(item, context),
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
    data, usage, model_used = _call_openai_with_fallback(messages, settings)
    try:
        response_content = data["choices"][0]["message"]["content"]
        parsed = json.loads(response_content)
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise ValueError(f"模型服务响应格式不符合预期：{exc}") from exc
    results = []
    for item in parsed.get("items", []):
        source = next((vulnerability for vulnerability in vulnerabilities if vulnerability.id == int(item["vulnerability_id"])), None)
        priority = str(item["ai_priority"])
        item["ai_risk_level"] = priority
        item["noise_reason"] = str(item["reason"])
        item["immediate_fix"] = priority in {"P0", "P1"}
        item["suspected_false_positive"] = bool(item["is_likely_false_positive"])
        item["remediation"] = str(item["fix_advice"])
        item["risk_explanation"] = str(item["evidence_summary"])
        item["priority_score"] = float(item.get("confidence") or 0) * 100
        item["ai_schema_version"] = AI_SCHEMA_VERSION
        item["input_hash"] = triage_input_hash(source, context) if source else ""
        item["token_usage"] = {
            "prompt_tokens": int(usage.get("prompt_tokens") or 0),
            "completion_tokens": int(usage.get("completion_tokens") or 0),
            "total_tokens": int(usage.get("total_tokens") or 0),
        }
        item["model"] = model_used
        item["raw"] = data
        results.append(item)
    return results


def _call_openai_with_fallback(
    messages: list[dict[str, str]],
    settings: Settings,
) -> tuple[dict[str, Any], dict[str, Any], str]:
    """Call OpenAI-compatible API with json_schema, fallback to text mode if unsupported."""
    headers = {"Authorization": f"Bearer {settings.openai_api_key}", "Content-Type": "application/json"}
    body: dict[str, Any] = {
        "model": settings.openai_model,
        "messages": messages,
        "temperature": 0,
        "max_tokens": 16384,
        "response_format": {"type": "json_schema", "json_schema": AI_TRIAGE_JSON_SCHEMA},
    }
    max_retries = 2
    last_exc: Exception | None = None
    for attempt in range(max_retries):
        try:
            with httpx.Client(timeout=settings.openai_timeout_ms / 1000) as client:
                response = client.post(settings.openai_api_url, headers=headers, json=body)
                if response.status_code == 400:
                    try:
                        error_data = response.json()
                        error_msg = str(error_data.get("error", {}).get("message", ""))
                    except Exception:
                        error_msg = response.text
                    if JSON_SCHEMA_UNAVAILABLE_PATTERN in error_msg:
                        logger.warning("json_schema unsupported by model %s, falling back to text mode", settings.openai_model)
                        body.pop("response_format", None)
                        body["messages"] = _append_json_instructions(messages)
                        response = client.post(settings.openai_api_url, headers=headers, json=body)
                response.raise_for_status()
            data = response.json()
            usage = data.get("usage") or {}
            model_used = str(data.get("model") or settings.openai_model)
            return data, usage, model_used
        except httpx.TimeoutException as exc:
            last_exc = exc
            if attempt < max_retries - 1:
                logger.warning(
                    "AI model timeout on attempt %d/%d, retrying in 3s...", 
                    attempt + 1, max_retries
                )
                time.sleep(3)
        except Exception:
            raise
    raise last_exc  # type: ignore[misc]


def _append_json_instructions(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    result = []
    for msg in messages:
        if msg["role"] == "system":
            result.append({"role": "system", "content": msg["content"] + AI_TRIAGE_JSON_FORMAT_INSTRUCTIONS})
        else:
            result.append(dict(msg))
    return result


def cached_ai_result(db: Session, project_id: int, vulnerability: VulnerabilityRecord, context: dict[str, Any]) -> AiTriageResult | None:
    input_hash = triage_input_hash(vulnerability, context)
    return (
        db.query(AiTriageResult)
        .filter_by(project_id=project_id, vulnerability_id=vulnerability.id, ai_schema_version=AI_SCHEMA_VERSION, input_hash=input_hash)
        .order_by(AiTriageResult.created_at.desc())
        .first()
    )
