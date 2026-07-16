"""Side-effect-free comparison helpers for Native/LangGraph runtime shadowing."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .protocol import RunRequest, RunSnapshot

SCHEMA_VERSION = "1.0"


def _sha256(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def request_hash(request: RunRequest | dict[str, Any]) -> str:
    """Hash identifying fields without persisting the user's raw input."""
    data = request.model_dump() if isinstance(request, RunRequest) else dict(request)
    return _sha256({
        "run_id": str(data.get("run_id", "")),
        "conversation_id": str(data.get("conversation_id", "")),
        "message_id": str(data.get("message_id", "")),
        "run_type": str(data.get("run_type", "")),
        "input_hash": _sha256(str(data.get("input_text", ""))),
    })


def _snapshot_dict(snapshot: RunSnapshot | dict[str, Any]) -> dict[str, Any]:
    if isinstance(snapshot, RunSnapshot):
        return snapshot.model_dump()
    return dict(snapshot)


def normalize_snapshot(snapshot: RunSnapshot | dict[str, Any]) -> dict[str, Any]:
    """Keep only contract metadata; raw answers, citations and safe messages never leave memory."""
    data = _snapshot_dict(snapshot)
    result = data.get("result") if isinstance(data.get("result"), dict) else {}
    answer = result.get("answer", "")
    citations = result.get("citations", [])
    if not isinstance(citations, list):
        citations = []
    return {
        "status": str(data.get("status", "")),
        "stage": str(data.get("stage", "")),
        "progress": int(data.get("progress", 0) or 0),
        "model_calls": int(data.get("model_calls", 0) or 0),
        "error_code": str(data.get("error_code", "")),
        "result": {
            "kind": str(result.get("kind", "")),
            "refused": bool(result.get("refused", False)),
            "snippet_count": int(result.get("snippet_count", 0) or 0),
            "citation_count": len(citations),
            "workflow": str(result.get("workflow", "")),
            "artifact_present": bool(result.get("artifact_id")),
            "answer_hash": _sha256(str(answer)),
            "answer_length": len(str(answer)),
        },
    }


def compare_snapshots(baseline: RunSnapshot | dict[str, Any], candidate: RunSnapshot | dict[str, Any]) -> list[str]:
    left = normalize_snapshot(baseline)
    right = normalize_snapshot(candidate)
    categories: list[str] = []
    for key in ("status", "stage", "error_code", "progress", "model_calls"):
        if left[key] != right[key]:
            categories.append(key)
    for key in ("kind", "refused", "snippet_count", "citation_count", "workflow", "artifact_present", "answer_hash"):
        if left["result"][key] != right["result"][key]:
            categories.append("answer" if key == "answer_hash" else key)
    return sorted(set(categories))


def aggregate_shadow_records(records: list[dict[str, Any]], *, max_mismatch_percent: float = 0) -> dict[str, Any]:
    if not 0 <= float(max_mismatch_percent) <= 100:
        raise ValueError("max_mismatch_percent must be between 0 and 100")
    cases: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()
    for index, record in enumerate(records):
        if not isinstance(record, dict) or not isinstance(record.get("baseline"), dict) or not isinstance(record.get("candidate"), dict):
            raise ValueError(f"invalid shadow record at index {index}")
        mismatches = compare_snapshots(record["baseline"], record["candidate"])
        counts.update(mismatches)
        cases.append({
            "case_id": str(record.get("case_id") or index),
            "input_hash": request_hash(record.get("request") or {}),
            "equivalent": not mismatches,
            "mismatch_categories": mismatches,
            "baseline": normalize_snapshot(record["baseline"]),
            "candidate": normalize_snapshot(record["candidate"]),
        })
    total = len(cases)
    mismatch_count = sum(not case["equivalent"] for case in cases)
    mismatch_rate = (mismatch_count / total * 100) if total else 100.0
    passed = bool(total) and mismatch_rate <= float(max_mismatch_percent)
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(UTC).isoformat(),
        "status": "pass" if passed else ("insufficient_data" if not total else "fail"),
        "total_cases": total,
        "equivalent_cases": total - mismatch_count,
        "mismatch_cases": mismatch_count,
        "mismatch_rate_percent": round(mismatch_rate, 4),
        "max_mismatch_percent": float(max_mismatch_percent),
        "category_counts": dict(sorted(counts.items())),
        "cases": cases,
    }


def should_sample(run_id: str, *, enabled: bool, sample_percent: int) -> bool:
    if not enabled or not 0 <= int(sample_percent) <= 100:
        return False
    if int(sample_percent) == 100:
        return True
    bucket = int(hashlib.sha256(str(run_id).encode("utf-8")).hexdigest()[:8], 16) % 100
    return bucket < int(sample_percent)


def report_path(settings: Any) -> Path:
    base = Path(getattr(settings, "knowledge_storage_dir", None) or "./storage")
    base.mkdir(parents=True, exist_ok=True)
    return base / "runtime_shadow_report.json"


def load_report(settings: Any) -> dict[str, Any] | None:
    path = report_path(settings)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def save_report(report: dict[str, Any], settings: Any) -> Path:
    path = report_path(settings)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
