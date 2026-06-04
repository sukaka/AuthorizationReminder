from __future__ import annotations

from pathlib import Path

from ..config import Settings
from .base import ScannerCommandResult, run_scanner_command


OPENSCA_INVALID_ARGUMENT_KEYWORDS = [
    "flag provided but not defined: -format",
    "usage of /usr/local/bin/opensca",
]

OPENSCA_INVALID_ARGUMENT_MESSAGE = (
    "OpenSCA 执行失败：当前命令使用了 OpenSCA 不支持的参数。"
    "OpenSCA 应使用 -path 指定项目路径，使用 -out 指定报告路径，不支持 -format / --output。"
)


def _is_opensca_invalid_argument(text: str) -> bool:
    lowered = text.lower()
    return any(keyword in lowered for keyword in OPENSCA_INVALID_ARGUMENT_KEYWORDS)


class OpenSCAAdapter:
    def __init__(self, settings: Settings):
        self.settings = settings

    def scan_source(self, source_dir: Path, output_dir: Path) -> ScannerCommandResult:
        json_output = output_dir / "opensca-result.json"
        html_output = output_dir / "opensca-result.html"
        sarif_output = output_dir / "opensca-result.sarif"
        stdout = output_dir / "opensca.stdout.log"
        stderr = output_dir / "opensca.stderr.log"
        opensca_log = output_dir / "opensca.log"
        command_log = output_dir / "opensca.command.log"
        if not self.settings.opensca_enabled:
            return ScannerCommandResult("opensca", "skipped", [], error_message="OpenSCA 未启用")

        report_outputs = [json_output, html_output, sarif_output]
        command = [
            self.settings.opensca_path,
            "-path",
            str(source_dir),
            "-out",
            ",".join(str(path) for path in report_outputs),
            "-log",
            str(opensca_log),
        ]
        result = run_scanner_command("opensca", command, json_output, stdout, stderr, self.settings.opensca_timeout, command_log)
        result.report_files = [str(path) for path in report_outputs if path.exists()]
        if result.status != "completed" and _is_opensca_invalid_argument(result.stderr or result.error_message):
            result.error_type = "INVALID_ARGUMENT"
            result.error_message = OPENSCA_INVALID_ARGUMENT_MESSAGE
            result.message = OPENSCA_INVALID_ARGUMENT_MESSAGE
            result.raw_error = result.stderr or result.raw_error
        return result


def scan_source(source_dir: Path, output_dir: Path, settings: Settings) -> ScannerCommandResult:
    return OpenSCAAdapter(settings).scan_source(source_dir, output_dir)
