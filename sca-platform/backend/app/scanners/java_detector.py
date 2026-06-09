from __future__ import annotations

import os
import stat
from collections import deque
from dataclasses import dataclass
from itertools import islice
from pathlib import Path


@dataclass(frozen=True)
class JavaDetectionResult:
    enabled: bool
    reasons: list[str]
    matched_paths: list[str]


def detect_java_project(
    root: Path,
    *,
    max_files: int = 20000,
    max_depth: int = 20,
    max_matches: int = 50,
) -> JavaDetectionResult:
    root = Path(root)
    empty_result = JavaDetectionResult(enabled=False, reasons=[], matched_paths=[])
    if max_files <= 0 or max_depth <= 0 or max_matches <= 0:
        return empty_result

    try:
        if not stat.S_ISDIR(root.stat(follow_symlinks=False).st_mode):
            return empty_result
    except OSError:
        return empty_result

    reasons: set[str] = set()
    matched_paths: list[str] = []
    entries_seen = 0
    directories = deque([(root, 0)])

    while directories:
        if entries_seen >= max_files:
            return JavaDetectionResult(
                enabled=bool(matched_paths),
                reasons=sorted(reasons),
                matched_paths=sorted(matched_paths),
            )
        current_path, current_depth = directories.popleft()
        try:
            with os.scandir(current_path) as iterator:
                entries = sorted(
                    islice(iterator, max_files - entries_seen),
                    key=lambda entry: entry.name,
                )
        except OSError:
            continue
        entries_seen += len(entries)

        for entry in entries:
            try:
                mode = entry.stat(follow_symlinks=False).st_mode
            except OSError:
                continue

            entry_depth = current_depth + 1
            path = Path(entry.path)
            if stat.S_ISDIR(mode):
                if entry_depth < max_depth:
                    directories.append((path, entry_depth))
                continue
            if not stat.S_ISREG(mode):
                continue

            relative_path = path.relative_to(root)
            reason = _java_reason(path.name)
            if reason is None:
                continue

            reasons.add(reason)
            matched_paths.append(relative_path.as_posix())
            if len(matched_paths) >= max_matches:
                return JavaDetectionResult(
                    enabled=True,
                    reasons=sorted(reasons),
                    matched_paths=sorted(matched_paths),
                )

    return JavaDetectionResult(
        enabled=bool(matched_paths),
        reasons=sorted(reasons),
        matched_paths=sorted(matched_paths),
    )


def _java_reason(file_name: str) -> str | None:
    if file_name == "pom.xml":
        return "maven"
    if file_name in {"build.gradle", "build.gradle.kts"}:
        return "gradle"

    lower_name = file_name.lower()
    if lower_name.endswith(".jar"):
        return "jar"
    if lower_name.endswith(".war"):
        return "war"
    if lower_name.endswith(".ear"):
        return "ear"
    return None
