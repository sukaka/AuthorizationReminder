"""Composite readiness probe for 6.0/7.0 operational go-live."""

from __future__ import annotations

from time import perf_counter
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from .config import Settings
from .feature_flags import load_feature_flags
from .ops_ga import build_ga_report


def run_readiness_probe(db: Session, settings: Settings) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    started = perf_counter()

    # DB
    try:
        t0 = perf_counter()
        db.execute(text("SELECT 1"))
        checks.append(
            {
                "id": "database",
                "name": "数据库连通",
                "status": "pass",
                "latency_ms": int((perf_counter() - t0) * 1000),
            }
        )
    except Exception as exc:
        checks.append(
            {
                "id": "database",
                "name": "数据库连通",
                "status": "fail",
                "detail": str(exc)[:200],
            }
        )

    # Feature flags / secrets posture
    flags = load_feature_flags(settings)
    learning_auto = bool(flags.get("learning_auto_publish"))
    checks.append(
        {
            "id": "learning_safety",
            "name": "学习禁止自动发布",
            "status": "fail" if learning_auto else "pass",
            "detail": "learning_auto_publish must be false",
        }
    )

    # Model optional
    model_ok = bool(
        getattr(settings, "server_model_base_url", "")
        and getattr(settings, "server_model_api_key", "")
        and getattr(settings, "server_model_id", "")
    )
    checks.append(
        {
            "id": "server_model",
            "name": "服务端模型配置",
            "status": "pass" if model_ok else "warn",
            "detail": "已配置" if model_ok else "未配置（润色/生成将回落骨架或本地）",
        }
    )

    # Offline GA suite (lightweight)
    try:
        from .ga_offline_eval import run_ga_offline_eval

        t0 = perf_counter()
        offline = run_ga_offline_eval(use_synthetic=True)
        lat = int((perf_counter() - t0) * 1000)
        ans = offline.get("answer_eval") or {}
        total = int(ans.get("total") or 0)
        passed = int(ans.get("passed") or 0)
        rate = (passed / total) if total else 0.0
        checks.append(
            {
                "id": "offline_eval",
                "name": "离线评测套件",
                "status": "pass" if rate >= 0.8 else "fail",
                "detail": f"{passed}/{total} passed ({rate:.0%})",
                "latency_ms": lat,
                "ga_rates": offline.get("ga_rates"),
            }
        )
    except Exception as exc:
        checks.append(
            {
                "id": "offline_eval",
                "name": "离线评测套件",
                "status": "fail",
                "detail": str(exc)[:200],
            }
        )

    # GA report
    try:
        ga = build_ga_report(db, sample_limit=100, include_offline_eval=False)
        failed = int(ga.get("summary", {}).get("failed") or 0)
        checks.append(
            {
                "id": "ga_report",
                "name": "GA 门禁代理报告",
                "status": "pass" if failed == 0 else "fail",
                "detail": f"overall={ga.get('overall')} failed={failed}",
                "summary": ga.get("summary"),
            }
        )
    except Exception as exc:
        checks.append(
            {
                "id": "ga_report",
                "name": "GA 门禁代理报告",
                "status": "fail",
                "detail": str(exc)[:200],
            }
        )

    # Durable Agent Loop SLO invariants.  The result is deliberately a warning
    # when crash/recovery sample rates have not yet been observed; staging
    # evidence remains a separate release prerequisite.
    try:
        from .ops_slo import build_slo_audit

        slo = build_slo_audit(db)
        slo_overall = str(slo.get("overall") or "unavailable")
        checks.append(
            {
                "id": "agent_loop_slo",
                "name": "Agent Loop 持久化不变量",
                "status": (
                    "fail"
                    if slo_overall == "fail"
                    else ("pass" if slo_overall == "pass" else "warn")
                ),
                "detail": (
                    f"overall={slo_overall} fail={slo.get('fail_count', 0)} "
                    f"gaps={slo.get('gap_count', 0)}"
                ),
                "summary": {
                    "metrics": slo.get("metrics", {}),
                    "notes": slo.get("notes", []),
                },
            }
        )
    except Exception as exc:
        checks.append(
            {
                "id": "agent_loop_slo",
                "name": "Agent Loop 持久化不变量",
                "status": "fail",
                "detail": str(exc)[:200],
            }
        )

    # Core routes import smoke
    try:
        from .agent_hub import get_agent_hub
        from .workflow_engine import list_workflow_definitions

        agents = get_agent_hub().list_agents()
        wfs = list_workflow_definitions(settings)
        checks.append(
            {
                "id": "hub_workflows",
                "name": "Agent Hub / 工作流",
                "status": "pass" if agents and wfs else "warn",
                "detail": f"agents={len(agents)} workflows={len(wfs)}",
            }
        )
    except Exception as exc:
        checks.append(
            {
                "id": "hub_workflows",
                "name": "Agent Hub / 工作流",
                "status": "fail",
                "detail": str(exc)[:200],
            }
        )

    # Security / privilege / checkpoint audit (embedded summary)
    try:
        from .ops_security_audit import run_security_audit

        sec = run_security_audit(db, settings)
        checks.append(
            {
                "id": "security_audit",
                "name": "安全与特权审计",
                "status": "pass"
                if sec.get("overall") == "pass"
                else ("warn" if sec.get("overall") == "pass_with_warnings" else "fail"),
                "detail": f"overall={sec.get('overall')} fail={sec.get('fail_count')} warn={sec.get('warn_count')}",
                "summary": {
                    "overall": sec.get("overall"),
                    "fail_count": sec.get("fail_count"),
                    "warn_count": sec.get("warn_count"),
                },
            }
        )
    except Exception as exc:
        checks.append(
            {
                "id": "security_audit",
                "name": "安全与特权审计",
                "status": "fail",
                "detail": str(exc)[:200],
            }
        )

    # Enterprise Intelligence 5.0 deployment boundary.  This is intentionally
    # reported as a nested check so the existing Ops dashboard can expose the
    # exact missing gate without changing its response contract.
    try:
        from .enterprise_intelligence.readiness import build_enterprise_readiness

        enterprise = build_enterprise_readiness(db, settings)
        enterprise_overall = str(enterprise.get("overall") or "not_ready")
        checks.append(
            {
                "id": "enterprise_5_0",
                "name": "企业智能 5.0 运行门禁",
                "status": (
                    "fail"
                    if enterprise_overall == "not_ready"
                    else ("warn" if enterprise_overall == "ready_with_warnings" else "pass")
                ),
                "detail": (
                    f"overall={enterprise_overall} "
                    f"fail={enterprise.get('fail_count', 0)} "
                    f"warn={enterprise.get('warn_count', 0)}"
                ),
                "summary": enterprise,
            }
        )
    except Exception as exc:
        checks.append(
            {
                "id": "enterprise_5_0",
                "name": "企业智能 5.0 运行门禁",
                "status": "fail",
                "detail": str(exc)[:200],
            }
        )

    hard_fail = sum(1 for c in checks if c["status"] == "fail")
    warns = sum(1 for c in checks if c["status"] == "warn")
    if hard_fail:
        overall = "not_ready"
    elif warns:
        overall = "ready_with_warnings"
    else:
        overall = "ready"

    return {
        "overall": overall,
        "elapsed_ms": int((perf_counter() - started) * 1000),
        "checks": checks,
        "fail_count": hard_fail,
        "warn_count": warns,
        "pass_count": sum(1 for c in checks if c["status"] == "pass"),
        "recommendation": {
            "ready": "可进入灰度：管理员 → 5% → 20% → 50% → 全量",
            "ready_with_warnings": "可小流量灰度，先处理 warn 项",
            "not_ready": "存在 fail 项，修复后再灰度",
        }.get(overall, ""),
    }
