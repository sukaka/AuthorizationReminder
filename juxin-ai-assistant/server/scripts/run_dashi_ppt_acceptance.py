#!/usr/bin/env python3
"""Generate and inspect real Dashi PPT, HTML, PDF and Word deliverables."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from typing import Any
from zipfile import ZipFile

from docx import Document
from pypdf import PdfReader


SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

from app.chat_ppt_workflow import build_dashi_goal_spec  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.dashi_ppt_runtime import generate_dashi_ppt  # noqa: E402
from app.word_export import render_generation_docx  # noqa: E402


ACCEPTANCE_ANSWER = """# 聚信 AI 助手用户体验优化
从用户提出问题到可验证成果，减少选择、等待和重复操作。
## 用户入口与自动路由
- 用户只需描述问题并上传资料
- 系统自动识别问答、报告或演示任务
- 路由结果可见且允许必要时纠正
## 后台任务与恢复
- 长报告和 PPT 默认进入后台处理
- 刷新页面后任务状态与结果不会丢失
- 完成后发送一次性通知并可直接打开
## 成果交付与验证
- PPTX、HTML 工程包和 PDF 均为真实文件
- HTML 解压后可离线打开并继续调整
- 每项成果保留来源、版本和审核记录
"""


def _configure_standalone_defaults() -> None:
    """Supply safe local defaults without overwriting an operator's environment."""
    os.environ.setdefault("AUTH_DEV_BYPASS", "true")
    os.environ.setdefault("ENVIRONMENT", "development")
    os.environ.setdefault("PUBLIC_URL", "http://127.0.0.1:18093")
    os.environ.setdefault("AUTH_PUBLIC_URL", "http://127.0.0.1:5180")
    if len(os.environ.get("AI_LOCAL_BINDING_SECRET", "")) < 32:
        os.environ["AI_LOCAL_BINDING_SECRET"] = "dashi-acceptance-local-binding-secret"


def _run(command: list[str], *, cwd: Path, timeout: int = 300) -> str:
    completed = subprocess.run(
        command,
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if completed.returncode != 0:
        details = (completed.stderr or completed.stdout or "").strip()[-2000:]
        raise RuntimeError(f"命令执行失败（{completed.returncode}）：{' '.join(command[:4])}\n{details}")
    return completed.stdout.strip()


def _extract_html_package(package_path: Path, destination: Path) -> list[str]:
    destination.mkdir(parents=True, exist_ok=True)
    destination_root = destination.resolve()
    with ZipFile(package_path) as package:
        names = package.namelist()
        for name in names:
            member = Path(name)
            if member.is_absolute() or ".." in member.parts:
                raise RuntimeError(f"HTML 工程包包含不安全路径：{name}")
            target = destination / member
            if not target.resolve().is_relative_to(destination_root):
                raise RuntimeError(f"HTML 工程包包含越界路径：{name}")
            if name.endswith("/"):
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with package.open(name) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)
    return names


def _inspect_pptx(path: Path) -> int:
    with ZipFile(path) as package:
        names = set(package.namelist())
        required = {"[Content_Types].xml", "ppt/presentation.xml"}
        if not required.issubset(names):
            raise RuntimeError("PPTX 缺少 Open XML 核心文件。")
        return sum(
            1
            for name in names
            if name.startswith("ppt/slides/slide") and name.endswith(".xml")
        )


def _inspect_word(path: Path, expected_title: str) -> int:
    document = Document(path)
    paragraphs = [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()]
    if not any(expected_title in paragraph for paragraph in paragraphs):
        raise RuntimeError("Word 文件可以打开，但未找到验收标题。")
    return len(paragraphs)


def _runtime_root(argument: str) -> Path:
    value = argument.strip() or os.environ.get("DASHI_PPT_RUNTIME_ROOT", "").strip()
    if not value:
        raise RuntimeError("请通过 --runtime-root 或 DASHI_PPT_RUNTIME_ROOT 指定真实运行时。")
    root = Path(value).expanduser().resolve()
    if not root.is_dir():
        raise RuntimeError(f"Dashi PPT 运行时不存在：{root}")
    return root


def run_acceptance(*, runtime_root: Path, output_dir: Path) -> dict[str, Any]:
    output_dir = output_dir.resolve()
    exports_dir = output_dir / "exports"
    offline_dir = output_dir / "offline-html"
    settings = get_settings().model_copy(
        update={
            "dashi_ppt_runtime_root": str(runtime_root),
            "export_storage_dir": str(exports_dir),
            "dashi_ppt_timeout_seconds": 900,
        }
    )
    question = "请制作一份聚信 AI 助手用户体验优化汇报"
    goal_spec = build_dashi_goal_spec(
        ACCEPTANCE_ANSWER,
        question=question,
        theme_pack="theme01",
    )
    title, artifacts = generate_dashi_ppt(
        settings=settings,
        user_id="acceptance-user",
        run_id="real-dashi-deliverables",
        question=question,
        user_input={"goal_spec": goal_spec, "formats": ["html", "pptx", "pdf"]},
    )
    artifact_paths = {artifact.format: artifact.path for artifact in artifacts}
    expected_slides = len(goal_spec["slides"])

    package_names = _extract_html_package(artifact_paths["html"], offline_dir)
    required_html = {"index.html", "assets/imported-theme-runtime.js"}
    if not required_html.issubset(package_names):
        raise RuntimeError("HTML ZIP 缺少 index.html 或 imported-theme-runtime.js。")
    font_files = [
        name for name in package_names if name.lower().endswith((".woff", ".woff2"))
    ]
    if not font_files:
        raise RuntimeError("HTML ZIP 缺少离线字体。")

    npm = shutil.which("npm") or "npm"
    goal_path = exports_dir / "dashi-ppt" / "acceptance-user" / "real-dashi-deliverables" / "goal.json"
    rendered_html = goal_path.parent / "ppt" / "index.html"
    _run(
        [npm, "--prefix", str(runtime_root), "run", "validate:goal-copy", "--", str(goal_path), str(rendered_html)],
        cwd=runtime_root,
        timeout=300,
    )
    _run(
        [npm, "--prefix", str(runtime_root), "run", "validate:swiss", "--", str(rendered_html)],
        cwd=runtime_root,
        timeout=300,
    )

    node = shutil.which("node") or "node"
    last_slide_screenshot = output_dir / "offline-last-slide.png"
    browser_output = _run(
        [
            node,
            str(Path(__file__).with_name("verify_dashi_html_offline.mjs")),
            str(runtime_root),
            str(offline_dir / "index.html"),
            str(expected_slides),
            str(last_slide_screenshot),
        ],
        cwd=SERVER_ROOT,
        timeout=120,
    )
    browser_report = json.loads(browser_output.splitlines()[-1])
    if not browser_report.get("passed"):
        raise RuntimeError("HTML 工程包离线浏览器验收失败。")

    pptx_slide_count = _inspect_pptx(artifact_paths["pptx"])
    if pptx_slide_count != expected_slides:
        raise RuntimeError(
            f"PPTX 页数不一致：预期 {expected_slides}，实际 {pptx_slide_count}。"
        )
    pdf_page_count = len(PdfReader(str(artifact_paths["pdf"])).pages)
    if pdf_page_count != expected_slides:
        raise RuntimeError(
            f"PDF 页数不一致：预期 {expected_slides}，实际 {pdf_page_count}。"
        )

    word_path = output_dir / "acceptance-report.docx"
    word_path.write_bytes(
        render_generation_docx(
            title=title,
            task_name="真实成果验收",
            department="产品研发部",
            author="聚信 AI 助手",
            output=ACCEPTANCE_ANSWER,
            version="5.10.0",
        )
    )
    word_paragraph_count = _inspect_word(word_path, title)

    report = {
        "passed": True,
        "title": title,
        "expected_slides": expected_slides,
        "artifacts": {
            "html_zip": {
                "path": str(artifact_paths["html"]),
                "bytes": artifact_paths["html"].stat().st_size,
                "files": len(package_names),
                "fonts": len(font_files),
            },
            "pptx": {
                "path": str(artifact_paths["pptx"]),
                "bytes": artifact_paths["pptx"].stat().st_size,
                "slides": pptx_slide_count,
            },
            "pdf": {
                "path": str(artifact_paths["pdf"]),
                "bytes": artifact_paths["pdf"].stat().st_size,
                "pages": pdf_page_count,
            },
            "docx": {
                "path": str(word_path),
                "bytes": word_path.stat().st_size,
                "paragraphs": word_paragraph_count,
            },
            "offline_last_slide_screenshot": {
                "path": str(last_slide_screenshot),
                "bytes": last_slide_screenshot.stat().st_size,
            },
        },
        "validations": {
            "goal_copy": True,
            "swiss": True,
            "offline_browser": browser_report,
        },
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "acceptance-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return report


def main() -> int:
    # The verifier never starts the API or accepts requests, so standalone local
    # runs may use isolated defaults. Importing this module must stay side-effect free.
    _configure_standalone_defaults()
    parser = argparse.ArgumentParser(description="真实 Dashi PPT 与办公成果验收")
    parser.add_argument("--runtime-root", default="")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    try:
        report = run_acceptance(
            runtime_root=_runtime_root(args.runtime_root),
            output_dir=Path(args.output_dir),
        )
    except Exception as exc:
        print(json.dumps({"passed": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
