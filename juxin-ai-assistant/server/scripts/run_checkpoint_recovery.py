#!/usr/bin/env python3
"""Run checkpoint recovery suite against a live API or local DB helper.

Usage (API):
  python scripts/run_checkpoint_recovery.py --base-url http://127.0.0.1:18093 --cases 20

Usage (local import, no server):
  python scripts/run_checkpoint_recovery.py --local --cases 20
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from typing import Any

from staging_auth import build_headers, validate_bearer_transport


def _req(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    timeout: float = 120.0,
) -> tuple[int, Any]:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", **(headers or {})},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, raw[:500]
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(raw)
        except Exception:
            return exc.code, raw[:500]
    except Exception as exc:
        return 0, str(exc)


def run_local(cases: int) -> dict[str, Any]:
    import base64
    import os
    import sys
    from pathlib import Path

    # Ensure server package importable
    root = Path(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))

    os.environ.setdefault("AUTH_DEV_BYPASS", "true")
    os.environ.setdefault(
        "AI_LOCAL_BINDING_SECRET",
        "local-binding-secret-for-checkpoint-suite-32",
    )
    if not os.environ.get("CONTENT_ENCRYPTION_KEY"):
        os.environ["CONTENT_ENCRYPTION_KEY"] = base64.urlsafe_b64encode(
            b"local-checkpoint-suite-key-32b!!"
        ).decode("ascii")

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.agent_run_service import AgentRunService
    from app.checkpoint_recovery import simulate_checkpoint_recovery
    from app.crypto import ContentCipher
    from app.models import Base

    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    key = os.environ["CONTENT_ENCRYPTION_KEY"]
    service = AgentRunService(db, ContentCipher(key))
    result = simulate_checkpoint_recovery(service, cases=cases)
    db.commit()
    db.close()
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Checkpoint recovery suite")
    parser.add_argument("--base-url", default="http://127.0.0.1:18093")
    parser.add_argument("--user-id", default="dev")
    parser.add_argument("--role", default="admin")
    parser.add_argument(
        "--bearer-token-env",
        default="",
        help="Environment variable containing a staging Bearer token; never printed",
    )
    parser.add_argument("--cases", type=int, default=20)
    parser.add_argument("--local", action="store_true", help="Run in-process SQLite suite")
    args = parser.parse_args()

    if args.local:
        body = run_local(args.cases)
        print(json.dumps(body, ensure_ascii=False, indent=2))
        return 0 if body.get("passed") else 1

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
    code, body = _req(
        "POST",
        f"{base}/api/ai/ops/checkpoint-suite?cases={int(args.cases)}",
        headers=headers,
    )
    print(json.dumps({"status_code": code, "body": body}, ensure_ascii=False, indent=2))
    if code != 200 or not isinstance(body, dict):
        return 1
    return 0 if body.get("passed") else 2


if __name__ == "__main__":
    sys.exit(main())
