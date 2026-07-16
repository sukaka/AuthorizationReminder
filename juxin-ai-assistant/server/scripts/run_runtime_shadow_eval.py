#!/usr/bin/env python3
"""Evaluate checked-in or exported Runtime shadow records without network access."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from app.agent_runtime.runtime_shadow import aggregate_shadow_records


def _load_records(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        payload = [json.loads(line) for line in text.splitlines() if line.strip()]
    if isinstance(payload, dict):
        payload = payload.get("records", [])
    if not isinstance(payload, list):
        raise ValueError("input must be a JSON array, JSONL, or {records: []}")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--max-mismatch-percent", type=float, default=0)
    args = parser.parse_args()
    try:
        report = aggregate_shadow_records(
            _load_records(args.input),
            max_mismatch_percent=args.max_mismatch_percent,
        )
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "invalid_input", "error": str(exc)}, ensure_ascii=False))
        return 2
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
