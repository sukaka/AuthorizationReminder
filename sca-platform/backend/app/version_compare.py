from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class VersionRangeResult:
    status: str
    reason: str


TOKEN_RE = re.compile(r"\d+|[A-Za-z]+")
PSEUDO_GO_RE = re.compile(r"^v?\d+\.\d+\.\d+-\d{14}-[0-9a-f]+$", re.IGNORECASE)


def normalize_version(value: str) -> str:
    version = value.strip()
    version = version.removeprefix("v")
    version = re.sub(r"^[<>=~^! ]+", "", version)
    return version.split(",", 1)[0].strip()


def _tokens(value: str) -> list[int | str] | None:
    normalized = normalize_version(value)
    if not normalized or normalized.lower() in {"latest", "snapshot", "release"}:
        return None
    if not re.match(r"^\d|^v\d", value.strip(), re.IGNORECASE):
        return None
    parts = TOKEN_RE.findall(normalized)
    if not parts or not any(part.isdigit() for part in parts):
        return None
    result: list[int | str] = []
    for part in parts:
        result.append(int(part) if part.isdigit() else part.lower())
    return result


def compare_versions(left: str, right: str, ecosystem: str = "") -> int | None:
    left_tokens = _tokens(left)
    right_tokens = _tokens(right)
    if left_tokens is None or right_tokens is None:
        return None
    size = max(len(left_tokens), len(right_tokens))
    for index in range(size):
        left_item: int | str = left_tokens[index] if index < len(left_tokens) else 0
        right_item: int | str = right_tokens[index] if index < len(right_tokens) else 0
        if left_item == right_item:
            continue
        if isinstance(left_item, int) and isinstance(right_item, int):
            return 1 if left_item > right_item else -1
        if isinstance(left_item, int):
            return 1
        if isinstance(right_item, int):
            return -1
        return 1 if left_item > right_item else -1
    if ecosystem == "go" and PSEUDO_GO_RE.match(left) and not PSEUDO_GO_RE.match(right):
        return 1
    return 0


def is_version_in_range(
    version: str,
    *,
    introduced: str = "",
    fixed: str = "",
    ecosystem: str = "",
) -> VersionRangeResult:
    if not version:
        return VersionRangeResult("unknown", "组件版本为空，无法判断影响范围")
    if introduced:
        lower = compare_versions(version, introduced, ecosystem)
        if lower is None:
            return VersionRangeResult("unknown", f"无法比较当前版本 {version} 与引入版本 {introduced}")
        if lower < 0:
            return VersionRangeResult("not_affected", f"当前版本 {version} 早于引入版本 {introduced}")
    if fixed:
        upper = compare_versions(version, fixed, ecosystem)
        if upper is None:
            return VersionRangeResult("unknown", f"无法比较当前版本 {version} 与修复版本 {fixed}")
        if upper >= 0:
            return VersionRangeResult("not_affected", f"当前版本 {version} 已达到修复版本 {fixed}")
        return VersionRangeResult("affected", f"当前版本 {version} 位于影响范围 {introduced or '*'} - {fixed}")
    if introduced:
        return VersionRangeResult("affected", f"当前版本 {version} 不早于引入版本 {introduced}，未发现修复版本")
    return VersionRangeResult("unknown", "漏洞源未提供可判断的版本范围")
