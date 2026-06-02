from __future__ import annotations

from pathlib import Path

from ..config import Settings
from .base import ScannerCommandResult, run_scanner_command


def scan_source(source_dir: Path, output_dir: Path, settings: Settings) -> ScannerCommandResult:
    output = output_dir / "opensca-report.json"
    stdout = output_dir / "opensca.stdout.log"
    stderr = output_dir / "opensca.stderr.log"
    if not settings.opensca_enabled:
        return ScannerCommandResult("opensca", "skipped", [], error_message="OpenSCA 未启用")
    command = [settings.opensca_path, "-path", str(source_dir), "-out", str(output), "-format", "json"]
    return run_scanner_command("opensca", command, output, stdout, stderr, settings.opensca_timeout)

