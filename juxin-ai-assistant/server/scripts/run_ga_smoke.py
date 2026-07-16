#!/usr/bin/env python3
"""GA smoke + light load probe against a running server.

Usage:
  # with auth bypass / test headers (dev):
  python scripts/run_ga_smoke.py --base-url http://127.0.0.1:18093

  # optional concurrency:
  python scripts/run_ga_smoke.py --base-url http://127.0.0.1:18093 --concurrency 8 --requests 40
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

try:  # package import for tests; direct import for `python scripts/foo.py`
    from scripts.staging_auth import build_headers, validate_bearer_transport
except ModuleNotFoundError:  # pragma: no cover - exercised by script entrypoint
    from staging_auth import build_headers, validate_bearer_transport

try:
    from scripts.ops_probe_semantics import semantic_ok as _semantic_ok
except ModuleNotFoundError:  # pragma: no cover - exercised by script entrypoint
    from ops_probe_semantics import semantic_ok as _semantic_ok


def _req(
    method: str,
    url: str,
    *,
    data: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 30.0,
) -> tuple[int, dict[str, Any] | str, float]:
    body = None
    hdrs = {"Accept": "application/json", **(headers or {})}
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        hdrs["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=body, headers=hdrs, method=method)
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
    parser = argparse.ArgumentParser(description="GA smoke + load probe")
    parser.add_argument("--base-url", default="http://127.0.0.1:18093")
    parser.add_argument("--user-id", default="dev")
    parser.add_argument("--role", default="admin")
    parser.add_argument(
        "--bearer-token-env",
        default="",
        help="Environment variable containing a staging Bearer token; never printed",
    )
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--requests", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args()
    try:
        base = validate_bearer_transport(
            base_url=args.base_url,
            bearer_token_env=args.bearer_token_env,
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

    print("=== GA Smoke ===")
    smoke_paths = [
        ("GET", "/api/ai/health", None),
        ("GET", "/health", None),
        ("GET", "/api/ai/ops/readiness", None),
        ("GET", "/api/ai/ops/security-audit", None),
        ("GET", "/api/ai/ops/ga-report", None),
        ("GET", "/api/ai/agent-hub/health", None),
        ("POST", "/api/ai/ops/checkpoint-suite?cases=5", None),
        ("GET", "/api/ai/ops/snapshot", None),
        ("GET", "/api/ai/ops/cost-summary", None),
        ("GET", "/api/ai/workflows", None),
        ("GET", "/api/ai/agent-hub/market", None),
        ("POST", "/api/ai/learning-eval/ga-suite", {}),
        (
            "POST",
            "/api/ai/workflows/route",
            {"input_text": "请做摘要", "preferred_agent_id": "local.summary", "create_run_audit": False},
        ),
    ]
    smoke_ok = 0
    for method, path, payload in smoke_paths:
        status, body, ms = _req(method, base + path, data=payload, headers=headers, timeout=args.timeout)
        ok = 200 <= status < 300 and _semantic_ok(path, body)
        smoke_ok += int(ok)
        mark = "OK" if ok else "FAIL"
        summary = ""
        if isinstance(body, dict):
            summary = str(body.get("overall") or body.get("status") or body.get("total") or "")[:60]
        print(f"  [{mark}] {method} {path} -> {status} ({ms:.0f}ms) {summary}")

    print("\n=== Light Load: GET /api/ai/workflows ===")
    latencies: list[float] = []
    errors = 0

    def one(_: int) -> float:
        status, _, ms = _req("GET", base + "/api/ai/workflows", headers=headers, timeout=args.timeout)
        if not (200 <= status < 300):
            raise RuntimeError(f"status={status}")
        return ms

    with ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as pool:
        futures = [pool.submit(one, i) for i in range(args.requests)]
        for fut in as_completed(futures):
            try:
                latencies.append(fut.result())
            except Exception:
                errors += 1

    if latencies:
        latencies.sort()
        p50 = latencies[len(latencies) // 2]
        p95 = latencies[min(len(latencies) - 1, int(len(latencies) * 0.95))]
        print(
            f"  n={len(latencies)} errors={errors} "
            f"avg={statistics.mean(latencies):.0f}ms p50={p50:.0f}ms p95={p95:.0f}ms "
            f"max={max(latencies):.0f}ms"
        )
    else:
        print(f"  all failed errors={errors}")

    print("\n=== Summary ===")
    print(f"  smoke {smoke_ok}/{len(smoke_paths)}")
    print(f"  load errors {errors}/{args.requests}")
    ready = smoke_ok == len(smoke_paths) and errors == 0
    print("  result:", "PASS" if ready else "FAIL")
    return 0 if ready else 1


if __name__ == "__main__":
    sys.exit(main())
