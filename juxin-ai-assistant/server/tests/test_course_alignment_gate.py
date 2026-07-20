from __future__ import annotations

import json
from pathlib import Path

from scripts.run_course_alignment_gate import REQUIRED_PATHS, run_alignment_gate


def _make_root(tmp_path: Path, *, document: str | None = None) -> Path:
    root = tmp_path / "project"
    (root / "docs/plans").mkdir(parents=True)
    (root / "server").mkdir()
    (root / "server/retrieval_eval_cases.json").write_text(
        json.dumps({"version": "1.0", "cases": [{"query": "q", "relevant_chunk_ids": ["c1"]}]}),
        encoding="utf-8",
    )
    for relative_path in REQUIRED_PATHS:
        path = root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("# fixture\n", encoding="utf-8")
    (root / "docs/plans/2026-07-18-production-agentic-rag-course-alignment.md").write_text(
        document if document is not None else _valid_document(), encoding="utf-8"
    )
    return root


def _valid_document() -> str:
    return "\n".join(
        [
            "https://github.com/jamwithai/production-agentic-rag-course",
            "## 对齐结果",
            *(f"Week {week}" for week in range(1, 8)),
            "## 评测与发布边界",
            "仍不能在本地替代的证据",
            "版本、commit、push",
        ]
    )


def test_course_alignment_gate_passes_complete_fixture(tmp_path: Path) -> None:
    report = run_alignment_gate(root=_make_root(tmp_path))

    assert report["status"] == "passed"
    assert report["failed"] == 0
    assert report["passed"] == len(report["checks"])


def test_course_alignment_gate_reports_missing_repository_path(tmp_path: Path) -> None:
    root = _make_root(tmp_path)
    (root / REQUIRED_PATHS[0]).unlink()

    report = run_alignment_gate(root=root)

    assert report["status"] == "failed"
    assert any(check["id"] == f"repository_path:{REQUIRED_PATHS[0]}" for check in report["checks"])


def test_course_alignment_gate_reports_missing_week_and_document(tmp_path: Path) -> None:
    root = _make_root(tmp_path, document="Week 1")
    (root / "docs/plans/2026-07-18-production-agentic-rag-course-alignment.md").unlink()

    report = run_alignment_gate(root=root)

    assert report["status"] == "failed"
    assert any(check["id"] == "alignment_document" and check["status"] == "failed" for check in report["checks"])
    assert any(check["id"] == "week:7" and check["status"] == "failed" for check in report["checks"])
