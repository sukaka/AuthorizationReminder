"""Safe adapter for the independently deployed Dashi PPT Skill runtime.

The upstream runtime remains outside this repository.  This module only sends
validated JSON to its fixed npm scripts and returns files from an isolated
export directory; it never evaluates user supplied shell commands.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from .config import Settings


SUPPORTED_FORMATS = ("pptx", "pdf", "html")
_LAYOUT_RE = re.compile(r"^theme\d+_page\d{3}$")
_SAFE_SEGMENT_RE = re.compile(r"[^A-Za-z0-9._-]+")


class DashiPptRuntimeError(RuntimeError):
    """A safe, user-facing failure from the Dashi runtime boundary."""


@dataclass(frozen=True)
class DashiPptArtifact:
    format: str
    path: Path
    file_name: str
    mime_type: str

    def as_dict(self, *, run_id: str) -> dict[str, Any]:
        return {
            "kind": self.format,
            "title": self.file_name,
            "file_name": self.file_name,
            "format": self.format,
            "mime_type": self.mime_type,
            "download_url": f"/api/skills/dashi-ppt/runs/{run_id}/download/{self.format}",
            "content": "已生成真实文件，可下载。",
        }


def requested_formats(user_input: dict[str, Any]) -> tuple[str, ...]:
    options = user_input.get("options")
    options = options if isinstance(options, dict) else {}
    raw: Any = options.get("output_format")
    if raw is None:
        raw = user_input.get("formats")
    if raw is None:
        raw = user_input.get("format")
    if raw is None:
        return ("pptx",)
    if isinstance(raw, str):
        values = [raw]
    elif isinstance(raw, list):
        values = raw
    else:
        raise DashiPptRuntimeError("DASHI_PPT_INVALID_FORMAT: 输出格式必须是 pptx、pdf 或 html。")
    normalized: list[str] = []
    for value in values:
        item = str(value).strip().lower()
        if item == "markdown":
            # Markdown is always returned as the run summary, not as an
            # exporter artifact.
            continue
        if item not in SUPPORTED_FORMATS:
            raise DashiPptRuntimeError("DASHI_PPT_INVALID_FORMAT: 输出格式必须是 pptx、pdf 或 html。")
        if item not in normalized:
            normalized.append(item)
    if not normalized:
        return ("pptx",)
    if len(normalized) > len(SUPPORTED_FORMATS):
        raise DashiPptRuntimeError("DASHI_PPT_INVALID_FORMAT: 最多同时生成三种格式。")
    return tuple(normalized)


def dashi_ppt_artifact_path(
    settings: Settings,
    *,
    user_id: str,
    run_id: str,
    artifact_format: str,
) -> Path:
    root = Path(settings.export_storage_dir).resolve() / "dashi-ppt" / _safe_segment(user_id) / _safe_segment(run_id)
    if artifact_format == "html":
        return root / "ppt" / "index.html"
    return root / f"presentation.{artifact_format}"


def dashi_ppt_goal_path(
    settings: Settings,
    *,
    user_id: str,
    run_id: str,
) -> Path:
    return (
        Path(settings.export_storage_dir).resolve()
        / "dashi-ppt"
        / _safe_segment(user_id)
        / _safe_segment(run_id)
        / "goal.json"
    )


def load_dashi_ppt_goal_spec(
    settings: Settings,
    *,
    user_id: str,
    run_id: str,
) -> dict[str, Any] | None:
    path = dashi_ppt_goal_path(settings, user_id=user_id, run_id=run_id)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def generate_dashi_ppt(
    *,
    settings: Settings,
    user_id: str,
    run_id: str,
    question: str,
    user_input: dict[str, Any],
) -> tuple[str, list[DashiPptArtifact]]:
    runtime_root = _validate_runtime_root(settings)
    formats = requested_formats(user_input)
    goal_spec = _goal_spec(question, user_input)
    output_root = (Path(settings.export_storage_dir).resolve() / "dashi-ppt" / _safe_segment(user_id) / _safe_segment(run_id))
    ppt_dir = output_root / "ppt"
    ppt_dir.mkdir(parents=True, exist_ok=True)
    spec_path = dashi_ppt_goal_path(settings, user_id=user_id, run_id=run_id)
    spec_path.write_text(json.dumps(goal_spec, ensure_ascii=False, indent=2), encoding="utf-8")

    _run_npm(
        runtime_root,
        ["run", "render:goal", "--", str(spec_path), str(ppt_dir / "index.html")],
        settings,
        phase="render",
    )
    html_path = ppt_dir / "index.html"
    _check_output(html_path, settings, "HTML")
    artifacts: list[DashiPptArtifact] = []
    for artifact_format in formats:
        if artifact_format == "html":
            artifacts.append(DashiPptArtifact("html", html_path, "presentation.html", "text/html; charset=utf-8"))
            continue
        output_path = output_root / f"presentation.{artifact_format}"
        script = "export:pptx" if artifact_format == "pptx" else "export:pdf"
        args = ["run", script, "--", str(ppt_dir), str(output_path)]
        _run_npm(runtime_root, args, settings, phase=artifact_format)
        _check_output(output_path, settings, artifact_format.upper())
        mime = (
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            if artifact_format == "pptx"
            else "application/pdf"
        )
        artifacts.append(DashiPptArtifact(artifact_format, output_path, f"presentation.{artifact_format}", mime))
    return str(goal_spec.get("title") or question or "聚信 AI 助手专题汇报"), artifacts


def _validate_runtime_root(settings: Settings) -> Path:
    configured = str(settings.dashi_ppt_runtime_root or "").strip()
    if not configured:
        raise DashiPptRuntimeError(
            "DASHI_PPT_RUNTIME_UNAVAILABLE: 未配置 Dashi PPT 运行时，请由部署人员设置 DASHI_PPT_RUNTIME_ROOT。"
        )
    root = Path(configured).expanduser().resolve()
    required = (root / "package.json", root / "scripts" / "render-goal-deck.jsx", root / "scripts" / "export-pptx.mjs")
    if not root.is_dir() or any(not item.is_file() for item in required):
        raise DashiPptRuntimeError(
            "DASHI_PPT_RUNTIME_UNAVAILABLE: Dashi PPT 运行时目录不完整，请检查部署配置。"
        )
    return root


def _run_npm(root: Path, args: list[str], settings: Settings, *, phase: str) -> None:
    npm = shutil.which("npm") or "npm"
    env = os.environ.copy()
    env["INIT_CWD"] = str(root)
    try:
        completed = subprocess.run(
            [npm, "--prefix", str(root), *args],
            cwd=root,
            env=env,
            capture_output=True,
            text=True,
            timeout=settings.dashi_ppt_timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise DashiPptRuntimeError(f"DASHI_PPT_{phase.upper()}_TIMEOUT: PPT 生成超时，请稍后重试。") from exc
    except OSError as exc:
        raise DashiPptRuntimeError(f"DASHI_PPT_{phase.upper()}_FAILED: PPT 运行时无法启动。") from exc
    if completed.returncode != 0:
        raise DashiPptRuntimeError(f"DASHI_PPT_{phase.upper()}_FAILED: PPT {phase}失败，请检查运行时依赖。")


def _check_output(path: Path, settings: Settings, label: str) -> None:
    try:
        stat = path.stat()
    except OSError as exc:
        raise DashiPptRuntimeError(f"DASHI_PPT_OUTPUT_MISSING: 未生成 {label} 文件。") from exc
    if not path.is_file() or stat.st_size <= 0:
        raise DashiPptRuntimeError(f"DASHI_PPT_OUTPUT_MISSING: 未生成 {label} 文件。")
    if stat.st_size > settings.dashi_ppt_max_output_bytes:
        raise DashiPptRuntimeError(f"DASHI_PPT_OUTPUT_TOO_LARGE: {label} 文件超过大小限制。")


def _goal_spec(question: str, user_input: dict[str, Any]) -> dict[str, Any]:
    supplied = user_input.get("goal_spec")
    if supplied is not None:
        if not isinstance(supplied, dict):
            raise DashiPptRuntimeError("DASHI_PPT_INVALID_GOAL: goal_spec 必须是对象。")
        _validate_goal_spec(supplied)
        return supplied
    title = str(question or "聚信 AI 助手专题汇报").strip()[:80] or "聚信 AI 助手专题汇报"
    return {
        "title": title,
        "slides": [
            {"layout": "theme01_page001", "props": {"kicker": "聚信 AI 助手", "titleTop": title[:20], "titleBottom": "方案汇报", "lead": question[:180]}},
            {"layout": "theme01_page006", "props": {"kicker": "核心数字", "value": "01", "unit": "个主题", "sub": "围绕用户问题组织内容与行动建议。"}},
            {"layout": "theme01_page010", "props": {"kicker": "研究方法", "title": "问题拆解与行动闭环", "cn": "从现状、判断到下一步，形成可执行的汇报结构。"}},
            {"layout": "theme01_page030", "props": {"kicker": "核心内容", "title": "从问题到交付成果", "statCount": 0, "imageSlotCount": 0}},
            {"layout": "theme01_page084", "props": {"kicker": "附录", "title": "资料来源与后续说明", "sourceCount": 0, "showPanel": True}},
        ],
    }


def _validate_goal_spec(spec: dict[str, Any]) -> None:
    slides = spec.get("slides")
    if not isinstance(slides, list) or not 1 <= len(slides) <= 40:
        raise DashiPptRuntimeError("DASHI_PPT_INVALID_GOAL: slides 数量必须在 1 到 40 页之间。")
    encoded = json.dumps(spec, ensure_ascii=False)
    if len(encoded.encode("utf-8")) > 512_000:
        raise DashiPptRuntimeError("DASHI_PPT_INVALID_GOAL: goal_spec 过大。")
    for slide in slides:
        if not isinstance(slide, dict) or not _LAYOUT_RE.fullmatch(str(slide.get("layout") or "")):
            raise DashiPptRuntimeError("DASHI_PPT_INVALID_GOAL: 包含无效页面布局。")
        _reject_unsafe_values(slide)


def _reject_unsafe_values(value: Any) -> None:
    if isinstance(value, dict):
        for item in value.values():
            _reject_unsafe_values(item)
    elif isinstance(value, list):
        for item in value:
            _reject_unsafe_values(item)
    elif isinstance(value, str) and (".." in value or value.startswith(("/", "http://", "https://"))):
        raise DashiPptRuntimeError("DASHI_PPT_INVALID_GOAL: 素材路径必须是安全的相对路径。")


def _safe_segment(value: str) -> str:
    cleaned = _SAFE_SEGMENT_RE.sub("-", str(value)).strip(".-")
    return cleaned[:100] or "unknown"
