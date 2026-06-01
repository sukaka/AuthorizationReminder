from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .models import Component


@dataclass(frozen=True)
class ReachabilityResult:
    reachability_status: str = "unknown"
    reachability_evidence: str = ""
    entry_points: str = ""
    related_files: str = ""
    call_path_summary: str = ""


TEXT_SUFFIXES = {".java", ".py", ".js", ".jsx", ".ts", ".tsx", ".vue"}
ENTRY_PATTERNS = [
    re.compile(r"@(RestController|Controller|GetMapping|PostMapping|RequestMapping)\b"),
    re.compile(r"@(app|router)\.(get|post|put|delete|patch)\("),
    re.compile(r"\b(app|router)\.(get|post|put|delete|patch)\("),
    re.compile(r"\b(path|re_path)\("),
    re.compile(r"@Controller\b"),
    re.compile(r"\b(createApp|ReactDOM\.createRoot|NestFactory\.create)\("),
]


def _iter_source_files(root: Path) -> list[Path]:
    if not root.exists():
        return []
    return [path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in TEXT_SUFFIXES]


def _component_needles(component: Component) -> set[str]:
    needles = {component.package_name, component.normalized_name, component.artifact_id, component.group_id}
    if component.ecosystem == "maven" and component.group_id:
        needles.add(component.group_id.split(".")[-1])
    if component.ecosystem == "pypi":
        needles.update({component.package_name.replace("-", "_"), component.package_name.replace("_", "-")})
    if component.ecosystem in {"npm", "node"}:
        name = component.package_name
        needles.add(name)
        if name.startswith("@") and "/" in name:
            needles.add(name.split("/", 1)[1])
    return {item.strip().lower() for item in needles if item and item.strip()}


def _line_has_import(line: str) -> bool:
    stripped = line.strip()
    return (
        stripped.startswith("import ")
        or stripped.startswith("from ")
        or " require(" in stripped
        or stripped.startswith("require(")
        or stripped.startswith("const ")
        or stripped.startswith("import{")
    )


def _route_text(line: str) -> str:
    quoted = re.search(r"['\"]([^'\"]+)['\"]", line)
    return quoted.group(1) if quoted else line.strip()[:80]


def analyze_component_reachability(component: Component, source_root: Path | None) -> ReachabilityResult:
    if not source_root or not source_root.exists():
        return ReachabilityResult("unknown", "", "", "", "未找到源码解压目录，无法判断真实调用")

    needles = _component_needles(component)
    evidence: list[str] = []
    related_files: set[str] = set()
    entry_points: list[str] = []
    for path in _iter_source_files(source_root):
        try:
            lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            continue
        relative = str(path.relative_to(source_root))
        for line_no, raw_line in enumerate(lines, start=1):
            lowered = raw_line.lower()
            if any(pattern.search(raw_line) for pattern in ENTRY_PATTERNS):
                route = _route_text(raw_line)
                if route not in entry_points:
                    entry_points.append(route)
            if _line_has_import(raw_line) and any(needle in lowered for needle in needles):
                evidence.append(f"{relative}:{line_no} {raw_line.strip()}")
                related_files.add(relative)

    if evidence:
        status = "reachable"
        summary = f"发现 {component.package_name} 的 import/require 证据，可能经入口 {', '.join(entry_points[:5]) or '未识别入口'} 调用"
    elif entry_points:
        status = "not_found"
        summary = f"识别到入口 {', '.join(entry_points[:5])}，但未发现调用证据：{component.package_name} 未出现在 import/require 中"
    else:
        status = "unknown"
        summary = "未识别到入口或调用证据，建议人工复核"
    return ReachabilityResult(
        reachability_status=status,
        reachability_evidence="\n".join(evidence[:20]),
        entry_points="; ".join(entry_points[:20]),
        related_files="; ".join(sorted(related_files)[:20]),
        call_path_summary=summary,
    )
