from __future__ import annotations

from pathlib import Path

from ..config import Settings
from .base import ScannerCommandResult, run_scanner_command


def generate_sbom(source: str, output_dir: Path, settings: Settings, source_type: str = "dir") -> list[ScannerCommandResult]:
    if not settings.syft_enabled:
        return [ScannerCommandResult("syft", "skipped", [], error_message="Syft 未启用")]
    results: list[ScannerCommandResult] = []
    for fmt in [item.strip() for item in settings.syft_default_formats.split(",") if item.strip()]:
        suffix = "cyclonedx.json" if fmt == "cyclonedx-json" else "spdx.json"
        output = output_dir / f"syft-{suffix}"
        stdout = output_dir / f"syft-{fmt}.stdout.log"
        stderr = output_dir / f"syft-{fmt}.stderr.log"
        target = source if source_type == "image" else f"dir:{source}"
        command = [settings.syft_path, target, "-o", fmt, "--file", str(output)]
        results.append(run_scanner_command("syft", command, output, stdout, stderr, settings.syft_timeout))
    return results

