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
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from .config import Settings


SUPPORTED_FORMATS = ("pptx", "pdf", "html")
HTML_PACKAGE_FILE_NAME = "presentation-html.zip"
HTML_PACKAGE_MIME_TYPE = "application/zip"
THEME_PREVIEW_RELATIVE_PATH = Path("assets") / "skill" / "theme-style-grid.png"
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
        download_url = f"/api/skills/dashi-ppt/runs/{run_id}/download/{self.format}"
        return {
            "artifact_id": f"{run_id}-{self.format}",
            "artifact_type": self.format,
            "kind": self.format,
            "title": self.file_name,
            "status": "ready",
            "version": 1,
            "file_name": self.file_name,
            "format": self.format,
            "mime_type": self.mime_type,
            "download_url": download_url,
            "download_ref": download_url,
            "downloadable": True,
            "editable": self.format in {"pptx", "html"},
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
        package = root / HTML_PACKAGE_FILE_NAME
        if package.is_file():
            return package
        # Historical runs were stored as a single entry point.  Keep their
        # download path working while all newly generated runs use ZIP.
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


def dashi_ppt_theme_preview_path(settings: Settings) -> Path:
    configured = str(settings.dashi_ppt_theme_preview_path or "").strip()
    if configured:
        preview_path = Path(configured).expanduser().resolve()
    else:
        preview_path = _validate_runtime_root(settings).parent / THEME_PREVIEW_RELATIVE_PATH

    if not preview_path.is_file():
        raise DashiPptRuntimeError(
            "DASHI_PPT_THEME_PREVIEW_UNAVAILABLE: 大师 PPT 主题预览素材不可用，请检查运行时安装。"
        )
    return preview_path


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


def build_scaffolded_dashi_goal_spec(
    *,
    settings: Settings,
    title: str,
    lead: str,
    sections: list[tuple[str, list[str]]],
    theme_pack: str,
    needs_media: bool,
) -> dict[str, Any]:
    """Build a themed, editable goal spec from Dashi's own layout catalog.

    The chat flow supplies only structured copy.  Layout selection and prop
    contracts remain in the independently deployed Dashi runtime, which keeps
    newly added themes available without hard-coding their page identifiers.
    """
    runtime_root = _validate_runtime_root(settings)
    required_scripts = (
        runtime_root / "scripts" / "goal-scaffold.mjs",
        runtime_root / "scripts" / "write-safe-props.mjs",
    )
    if any(not item.is_file() for item in required_scripts):
        raise DashiPptRuntimeError(
            "DASHI_PPT_THEME_UNAVAILABLE: 当前大师 PPT 运行时不支持所选风格，请选择 theme01 或联系管理员升级运行时。"
        )
    page_count = min(10, max(3, len(sections) + 2))
    with tempfile.TemporaryDirectory(prefix="dashi-chat-goal-") as temporary_dir:
        goal_path = Path(temporary_dir) / "goal.json"
        scaffold_args = [
            "run",
            "goal:scaffold",
            "--",
            "--title",
            title,
            "--goal",
            lead,
            "--theme",
            theme_pack,
            "--pages",
            str(page_count),
            "--out",
            str(goal_path),
            "--seed",
            _safe_segment(f"{theme_pack}-{title}"),
        ]
        if needs_media:
            scaffold_args.append("--needs-visual")
        _run_npm(runtime_root, scaffold_args, settings, phase="scaffold")
        fill_plan_path = goal_path.with_name(f"{goal_path.stem}.fill-plan.json")
        try:
            goal_spec = json.loads(goal_path.read_text(encoding="utf-8"))
            fill_plan = json.loads(fill_plan_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise DashiPptRuntimeError("DASHI_PPT_THEME_FAILED: 无法读取所选风格的页面骨架。") from exc
        if not isinstance(goal_spec, dict) or not isinstance(fill_plan, dict):
            raise DashiPptRuntimeError("DASHI_PPT_THEME_FAILED: 所选风格返回了无效页面骨架。")
        plan_slides = list(fill_plan.get("slides") or [])
        for index, slide in enumerate(list(goal_spec.get("slides") or []), start=1):
            if not isinstance(slide, dict):
                continue
            plan = plan_slides[index - 1] if index <= len(plan_slides) else {}
            # A media intent is valid while selecting a layout, but it is not
            # a renderable prop without a staged user asset.  Keep the visual
            # layout and remove the unresolved intent before safe validation.
            slide.pop("needsVisual", None)
            slide.pop("imageGen", None)
            slide.pop("plannedImages", None)
            slide["props"] = _scaffolded_slide_props(
                plan.get("fillPlan") if isinstance(plan, dict) else None,
                index=index,
                page_count=page_count,
                title=title,
                lead=lead,
                sections=sections,
            )
        goal_path.write_text(json.dumps(goal_spec, ensure_ascii=False), encoding="utf-8")
        _run_npm(
            runtime_root,
            ["run", "props:safe", "--", "--goal", str(goal_path), "--write"],
            settings,
            phase="props",
        )
        try:
            normalized_spec = json.loads(goal_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise DashiPptRuntimeError("DASHI_PPT_THEME_FAILED: 无法生成所选风格的页面内容。") from exc
    if not isinstance(normalized_spec, dict):
        raise DashiPptRuntimeError("DASHI_PPT_THEME_FAILED: 所选风格的页面内容无效。")
    return normalized_spec


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
            package_path = output_root / HTML_PACKAGE_FILE_NAME
            _package_html_project(ppt_dir, package_path, settings)
            artifacts.append(DashiPptArtifact("html", package_path, HTML_PACKAGE_FILE_NAME, HTML_PACKAGE_MIME_TYPE))
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
    required_files = (root / "package.json", root / "scripts" / "render-goal-deck.jsx", root / "scripts" / "export-pptx.mjs")
    if not root.is_dir() or any(not item.is_file() for item in required_files) or not (root / "node_modules").is_dir():
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


def _package_html_project(ppt_dir: Path, package_path: Path, settings: Settings) -> None:
    """Deliver the complete offline-editable HTML project, not one entry file."""
    index_file = ppt_dir / "index.html"
    runtime_asset = ppt_dir / "assets" / "imported-theme-runtime.js"
    has_font = any((ppt_dir / "assets").rglob("*.woff")) or any((ppt_dir / "assets").rglob("*.woff2"))
    if not index_file.is_file() or not runtime_asset.is_file() or not has_font:
        raise DashiPptRuntimeError("DASHI_PPT_OUTPUT_MISSING: HTML 工程缺少运行时资源。")
    package_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = package_path.with_name(f".{package_path.name}.tmp")
    try:
        with ZipFile(temporary_path, "w", compression=ZIP_DEFLATED) as package:
            for item in sorted(ppt_dir.rglob("*")):
                if item.is_symlink():
                    raise DashiPptRuntimeError("DASHI_PPT_OUTPUT_INVALID: HTML 工程包含不允许的链接文件。")
                if item.is_file():
                    package.write(item, item.relative_to(ppt_dir).as_posix())
        temporary_path.replace(package_path)
    except DashiPptRuntimeError:
        temporary_path.unlink(missing_ok=True)
        raise
    except OSError as exc:
        temporary_path.unlink(missing_ok=True)
        raise DashiPptRuntimeError("DASHI_PPT_PACKAGE_FAILED: HTML 工程包生成失败。") from exc
    _check_output(package_path, settings, "HTML 工程包")


def _goal_spec(question: str, user_input: dict[str, Any]) -> dict[str, Any]:
    supplied = user_input.get("goal_spec")
    if supplied is not None:
        if not isinstance(supplied, dict):
            raise DashiPptRuntimeError("DASHI_PPT_INVALID_GOAL: goal_spec 必须是对象。")
        _synchronize_cover_counts(supplied)
        _validate_goal_spec(supplied)
        return supplied
    title = str(question or "聚信 AI 助手专题汇报").strip()[:36] or "聚信 AI 助手专题汇报"
    return {
        "title": title,
        "slides": [
            {"layout": "theme01_page001", "props": {"kicker": "聚信 AI 助手", "titleTop": title[:18], "titleBottom": "方案汇报", "lead": str(question or "")[:54]}},
            {"layout": "theme01_page006", "props": {"kicker": "核心数字", "value": "01", "unit": "个主题", "sub": "围绕用户问题组织内容与行动建议。"}},
            {"layout": "theme01_page010", "props": {"kicker": "研究方法", "title": "问题拆解与行动闭环", "cn": "从现状、判断到下一步，形成可执行的汇报结构。"}},
            {"layout": "theme01_page030", "props": {"kicker": "核心内容", "title": "从问题到交付成果", "statCount": 0, "imageSlotCount": 0}},
            {"layout": "theme01_page084", "props": {"kicker": "附录", "title": "资料来源与后续说明", "sourceCount": 0, "showPanel": True}},
        ],
    }


class _ScaffoldCopyCursor:
    def __init__(
        self,
        *,
        index: int,
        title: str,
        lead: str,
        heading: str,
        points: list[str],
    ) -> None:
        self.index = index
        self.title = title
        self.lead = lead
        self.heading = heading
        self.points = points or [lead]
        self.position = 0

    def next(self, *, role: str = "", key: str = "") -> str:
        normalized_role = str(role or "").lower()
        normalized_key = str(key or "").lower()
        if "url" in normalized_key or "href" in normalized_key:
            return ""
        if normalized_role in {"metric", "number"} or normalized_key in {"index", "no"}:
            return f"{self.index:02d}"
        if normalized_role in {"title", "heading"}:
            return self.title if self.index == 1 else self.heading
        if normalized_role in {"eyebrow", "kicker", "label"}:
            labels = (
                self.title,
                self.heading,
                f"第 {self.index:02d} 页",
            )
            value = labels[self.position % len(labels)]
            self.position += 1
            return value
        value = self.points[self.position % len(self.points)]
        if self.position >= len(self.points):
            value = f"{self.position + 1:02d} · {value}"
        self.position += 1
        return str(value)[:54]

    def next_number(self, field: Any) -> int | float:
        """Create a small, contract-safe placeholder for numeric layouts."""
        details = field if isinstance(field, dict) else {}
        bounds = details.get("numericBounds")
        observed = details.get("numericRange")
        range_source = bounds if isinstance(bounds, dict) else observed
        minimum = range_source.get("min") if isinstance(range_source, dict) else None
        maximum = range_source.get("max") if isinstance(range_source, dict) else None
        base = float(minimum) if isinstance(minimum, (int, float)) else 1.0
        candidate = base + self.index + self.position
        self.position += 1
        if isinstance(maximum, (int, float)):
            candidate = min(candidate, float(maximum))
        if candidate.is_integer():
            return int(candidate)
        return round(candidate, 2)


def _scaffolded_slide_props(
    fill_plan: Any,
    *,
    index: int,
    page_count: int,
    title: str,
    lead: str,
    sections: list[tuple[str, list[str]]],
) -> dict[str, Any]:
    if index == 1:
        heading, points = title, [lead]
    elif index == page_count:
        final_points = sections[-1][1] if sections else [lead]
        heading, points = "结论与下一步", final_points or [lead]
    else:
        section_index = min(index - 2, max(0, len(sections) - 1))
        heading, points = sections[section_index] if sections else ("核心内容", [lead])
    cursor = _ScaffoldCopyCursor(
        index=index,
        title=title,
        lead=lead,
        heading=heading,
        points=[str(point) for point in points if str(point).strip()],
    )
    plan = fill_plan if isinstance(fill_plan, dict) else {}
    props: dict[str, Any] = {}
    for text_plan in list(plan.get("text") or []):
        if not isinstance(text_plan, dict):
            continue
        key = str(text_plan.get("key") or "")
        if not key or "[]" in key or "url" in key.lower() or "href" in key.lower():
            continue
        _set_prop_path(
            props,
            key,
            _scaffold_field_value(cursor, text_plan, key=key),
        )
    for array_plan in list(plan.get("arrays") or []):
        if not isinstance(array_plan, dict):
            continue
        key = str(array_plan.get("key") or "")
        if not key or "[]" in key or _is_media_array(key) or array_plan.get("nestedArrays"):
            continue
        count = _scaffold_array_count(array_plan)
        values = [
            _scaffold_array_item(
                array_plan.get("itemShape"),
                array_plan.get("itemFields") or array_plan.get("item"),
                cursor,
            )
            for _ in range(count)
        ]
        _set_prop_path(props, key, values)
        count_key = str(array_plan.get("countKey") or "")
        if count_key and "[]" not in count_key:
            _set_prop_path(props, count_key, len(values))
    return props


def _scaffold_array_count(array_plan: dict[str, Any]) -> int:
    fixed_length = array_plan.get("fixedLength")
    if isinstance(fixed_length, int) and fixed_length > 0:
        return fixed_length
    for field in ("visibleCount", "maxCount"):
        value = array_plan.get(field)
        if isinstance(value, int) and value > 0:
            return min(value, 4)
    return 3


def _scaffold_array_item(shape: Any, fields: Any, cursor: _ScaffoldCopyCursor) -> Any:
    field_map = fields if isinstance(fields, dict) else {}
    if isinstance(shape, str) and shape in {"string", "number", "boolean"}:
        return _scaffold_field_value(cursor, field_map, key="", shape=shape)
    if isinstance(shape, list):
        return [
            _scaffold_array_item(item_shape, {}, cursor)
            for item_shape in shape[:4]
        ]
    if not isinstance(shape, dict):
        return _scaffold_field_value(cursor, field_map, key="", shape=shape)
    item: dict[str, Any] = {}
    for key, value_shape in shape.items():
        field = field_map.get(key) if isinstance(field_map.get(key), dict) else {}
        item[key] = _scaffold_array_item(value_shape, field, cursor)
    return item


def _scaffold_field_value(
    cursor: _ScaffoldCopyCursor,
    field: Any,
    *,
    key: str,
    shape: Any = None,
) -> Any:
    details = field if isinstance(field, dict) else {}
    value_type = str(details.get("type") or shape or "string").lower()
    if value_type == "number":
        return cursor.next_number(details)
    if value_type == "boolean":
        return True
    value = cursor.next(role=str(details.get("role") or ""), key=key)
    max_chars = details.get("maxChars")
    if isinstance(max_chars, int) and max_chars > 0:
        return value[:max_chars]
    return value


def _set_prop_path(props: dict[str, Any], path: str, value: Any) -> None:
    target = props
    parts = [part for part in path.split(".") if part]
    if not parts:
        return
    for part in parts[:-1]:
        existing = target.get(part)
        if not isinstance(existing, dict):
            existing = {}
            target[part] = existing
        target = existing
    target[parts[-1]] = value


def _is_media_array(key: str) -> bool:
    normalized = key.lower()
    return any(marker in normalized for marker in ("image", "images", "media", "video", "background"))


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


def _synchronize_cover_counts(spec: dict[str, Any]) -> None:
    """Dashi requires explicit counters whenever the cover arrays are present."""
    for slide in list(spec.get("slides") or []):
        if not isinstance(slide, dict) or slide.get("layout") != "theme01_page001":
            continue
        props = slide.get("props")
        if not isinstance(props, dict):
            continue
        chips = props.get("chips")
        meta = props.get("meta")
        if isinstance(chips, list):
            props["chipCount"] = len(chips)
        if isinstance(meta, list):
            props["metaCount"] = len(meta)


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
