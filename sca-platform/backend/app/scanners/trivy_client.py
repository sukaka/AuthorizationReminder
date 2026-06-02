from __future__ import annotations

from pathlib import Path

from ..config import Settings
from .base import ScannerCommandResult, run_scanner_command


def scan_fs(source_dir: Path, output_dir: Path, settings: Settings) -> ScannerCommandResult:
    output = output_dir / "trivy-fs.json"
    stdout = output_dir / "trivy.stdout.log"
    stderr = output_dir / "trivy.stderr.log"
    if not settings.trivy_enabled:
        return ScannerCommandResult("trivy", "skipped", [], error_message="Trivy 未启用")
    command = [
        settings.trivy_path,
        "fs",
        "--format",
        "json",
        "--cache-dir",
        settings.trivy_cache_dir,
        "--output",
        str(output),
        str(source_dir),
    ]
    return run_scanner_command("trivy", command, output, stdout, stderr, settings.trivy_timeout)


def scan_image(image_ref: str, output_dir: Path, settings: Settings) -> ScannerCommandResult:
    output = output_dir / "trivy-image.json"
    stdout = output_dir / "trivy-image.stdout.log"
    stderr = output_dir / "trivy-image.stderr.log"
    command = [
        settings.trivy_path,
        "image",
        "--format",
        "json",
        "--cache-dir",
        settings.trivy_cache_dir,
        "--output",
        str(output),
        image_ref,
    ]
    return run_scanner_command("trivy", command, output, stdout, stderr, settings.trivy_timeout)

