#!/usr/bin/env python3
"""Append a daily GA observation snapshot (JSONL) for dual-week gate.

Usage:
  python scripts/run_ga_observe.py --base-url http://127.0.0.1:18093 \\
    --out ../docs/plans/ga-observe.jsonl

Evaluate the resulting JSONL with a 14-day default window:
  python scripts/evaluate_ga_observe.py --in ../docs/plans/ga-observe.jsonl --require-ready
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from scripts.ops_probe_semantics import semantic_ok
    from scripts.staging_auth import (
        build_headers,
        normalize_release_id,
        validate_bearer_transport,
    )
except ModuleNotFoundError:  # pragma: no cover - exercised by script entrypoint
    from ops_probe_semantics import semantic_ok
    from staging_auth import build_headers, normalize_release_id, validate_bearer_transport


def observation_probe_ok(path: str, status_code: int, body: Any) -> bool:
    """Apply both HTTP and endpoint-specific semantic gates to one probe."""

    return 200 <= int(status_code) < 300 and semantic_ok(path, body)


def _req(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: float = 60.0,
) -> tuple[int, Any, float]:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", **(headers or {})},
        method=method,
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            elapsed = (time.perf_counter() - t0) * 1000
            try:
                return resp.status, json.loads(raw), elapsed
            except json.JSONDecodeError:
                return resp.status, raw[:500], elapsed
    except urllib.error.HTTPError as exc:
        elapsed = (time.perf_counter() - t0) * 1000
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(raw), elapsed
        except Exception:
            return exc.code, raw[:500], elapsed
    except Exception as exc:
        elapsed = (time.perf_counter() - t0) * 1000
        return 0, str(exc), elapsed


def main() -> int:
    parser = argparse.ArgumentParser(description="GA continuous observation snapshot")
    parser.add_argument("--base-url", default="http://127.0.0.1:18093")
    parser.add_argument(
        "--release-id",
        default="",
        help="Stable release identity shared by every staging evidence artifact",
    )
    parser.add_argument("--user-id", default="dev")
    parser.add_argument("--role", default="admin")
    parser.add_argument(
        "--bearer-token-env",
        default="",
        help="Environment variable containing a staging Bearer token; never printed",
    )
    parser.add_argument(
        "--out",
        default="",
        help="JSONL path; default docs/plans/ga-observe.jsonl relative to repo root",
    )
    parser.add_argument("--timeout", type=float, default=60.0)
    args = parser.parse_args()
    try:
        base = validate_bearer_transport(
            base_url=args.base_url,
            bearer_token_env=args.bearer_token_env,
        )
    except ValueError as exc:
        parser.error(str(exc))
    try:
        release_id = normalize_release_id(
            args.release_id,
            required=bool(args.bearer_token_env.strip()),
        )
    except ValueError as exc:
        parser.error(str(exc))
    try:
        headers = build_headers(
            user_id=args.user_id,
            role=args.role,
            bearer_token_env=args.bearer_token_env,
        )
    except ValueError as exc:
        parser.error(str(exc))

    paths = [
        "/api/ai/ops/readiness",
        "/api/ai/ops/security-audit",
        "/api/ai/ops/ga-report",
        "/api/ai/ops/snapshot",
        "/api/ai/ops/cost-summary",
        "/api/ai/agent-hub/health",
    ]
    probes: dict[str, Any] = {}
    for path in paths:
        code, body, ms = _req("GET", f"{base}{path}", headers=headers, timeout=args.timeout)
        probe_ok = observation_probe_ok(path, code, body)
        probes[path] = {
            "status_code": code,
            "latency_ms": round(ms, 1),
            "semantic_ok": probe_ok,
            "body": body if isinstance(body, dict) else {"raw": body},
        }

    readiness = probes.get("/api/ai/ops/readiness", {}).get("body") or {}
    security = probes.get("/api/ai/ops/security-audit", {}).get("body") or {}
    ga = probes.get("/api/ai/ops/ga-report", {}).get("body") or {}
    ops_snapshot = probes.get("/api/ai/ops/snapshot", {}).get("body") or {}

    snapshot = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "release_id": release_id,
        "base_url": base,
        "readiness_overall": readiness.get("overall") if isinstance(readiness, dict) else None,
        "security_overall": security.get("overall") if isinstance(security, dict) else None,
        "ga_overall": ga.get("overall") if isinstance(ga, dict) else None,
        "ga_summary": ga.get("summary") if isinstance(ga, dict) else None,
        "ops_snapshot": ops_snapshot if isinstance(ops_snapshot, dict) else None,
        "semantic_failures": [path for path, probe in probes.items() if not probe["semantic_ok"]],
        "probes": probes,
    }

    out = args.out.strip()
    if not out:
        # server/scripts → repo docs/plans
        out = str(
            Path(__file__).resolve().parents[2] / "docs" / "plans" / "ga-observe.jsonl"
        )
    out_path = Path(out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(snapshot, ensure_ascii=False) + "\n")

    print(
        json.dumps(
            {
                "wrote": str(out_path),
                "readiness": snapshot["readiness_overall"],
                "security": snapshot["security_overall"],
                "ga": snapshot["ga_overall"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    # non-zero if any critical probe fails HTTP or its endpoint contract
    bad = bool(snapshot["semantic_failures"])
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
