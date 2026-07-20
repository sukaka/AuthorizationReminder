#!/usr/bin/env python3
"""Validate that the production Agentic RAG course alignment remains auditable.

This gate is intentionally static and offline: it reads the alignment plan and
repository files, but does not connect to a database, model endpoint, cache, or
the network. Runtime quality and staging evidence remain separate gates.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
ALIGNMENT_DOC = Path("docs/plans/2026-07-18-production-agentic-rag-course-alignment.md")
REQUIRED_PATHS = (
    "server/app/agent_run_routes.py",
    "server/app/knowledge_files.py",
    "server/app/knowledge_keyword_index.py",
    "server/app/retrieval_fusion.py",
    "server/app/agent_runtime/deep_retrieve.py",
    "server/app/knowledge_cache.py",
    "server/app/agent_runtime/native_langgraph_adapter.py",
    "server/scripts/export_retrieval_rankings.py",
    "server/scripts/run_retrieval_eval.py",
)
REQUIRED_MARKERS = (
    "https://github.com/jamwithai/production-agentic-rag-course",
    "## 对齐结果",
    "## 评测与发布边界",
    "仍不能在本地替代的证据",
    "版本、commit、push",
)


def _check(check_id: str, passed: bool, detail: str) -> dict[str, Any]:
    return {"id": check_id, "status": "passed" if passed else "failed", "detail": detail}


def run_alignment_gate(*, root: Path = ROOT) -> dict[str, Any]:
    """Return a redacted, deterministic report for the alignment document."""

    root = root.resolve()
    doc_path = root / ALIGNMENT_DOC
    checks: list[dict[str, Any]] = []

    try:
        document = doc_path.read_text(encoding="utf-8")
    except OSError:
        document = ""
        checks.append(_check("alignment_document", False, str(ALIGNMENT_DOC)))
    else:
        checks.append(_check("alignment_document", True, str(ALIGNMENT_DOC)))

    for marker in REQUIRED_MARKERS:
        checks.append(
            _check(
                f"document_marker:{marker}",
                marker in document,
                marker,
            )
        )

    for week in range(1, 8):
        marker = f"Week {week}"
        checks.append(_check(f"week:{week}", marker in document, marker))

    for relative_path in REQUIRED_PATHS:
        exists = (root / relative_path).is_file()
        checks.append(_check(f"repository_path:{relative_path}", exists, relative_path))

    cases_path = root / "server/retrieval_eval_cases.json"
    try:
        cases = json.loads(cases_path.read_text(encoding="utf-8"))
        raw_cases = cases.get("cases") if isinstance(cases, dict) else None
        valid_cases = isinstance(raw_cases, list) and bool(raw_cases) and all(
            isinstance(case, dict)
            and isinstance(case.get("query"), str)
            and isinstance(case.get("relevant_chunk_ids"), list)
            and bool(case["relevant_chunk_ids"])
            for case in raw_cases
        )
    except (OSError, json.JSONDecodeError):
        valid_cases = False
    checks.append(_check("retrieval_eval_cases", valid_cases, "server/retrieval_eval_cases.json"))

    failed = [check for check in checks if check["status"] != "passed"]
    return {
        "status": "failed" if failed else "passed",
        "checks": checks,
        "passed": len(checks) - len(failed),
        "failed": len(failed),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate production Agentic RAG course alignment")
    parser.add_argument("--json", action="store_true", help="Print the full machine-readable report")
    args = parser.parse_args()
    report = run_alignment_gate()
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"course_alignment_gate: {report['status']} ({report['passed']} passed, {report['failed']} failed)")
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
