from __future__ import annotations

from pathlib import Path

from ..config import Settings
from .base import ScannerCommandResult, run_scanner_command
from .dependency_check_cache import (
    dependency_check_cache_initialized,
    dependency_check_lock,
    nvd_property_file,
    validate_suppression_file,
)


class DependencyCheckAdapter:
    def __init__(self, settings: Settings):
        self.settings = settings

    def scan_source(self, source_dir: Path, output_dir: Path, project_name: str) -> ScannerCommandResult:
        if not self.settings.dependency_check_enabled:
            return ScannerCommandResult(
                "dependency-check",
                "skipped",
                [],
                error_message="Dependency-Check 未启用",
            )

        data_dir = Path(self.settings.dependency_check_data_dir)
        if not dependency_check_cache_initialized(data_dir):
            return ScannerCommandResult(
                "dependency-check",
                "skipped",
                [],
                error_type="CACHE_NOT_INITIALIZED",
                error_message="Dependency-Check 漏洞库尚未初始化",
            )

        try:
            validate_suppression_file(Path(self.settings.dependency_check_suppression_file))
        except (OSError, ValueError) as exc:
            return ScannerCommandResult(
                "dependency-check",
                "failed",
                [],
                error_type="INVALID_SUPPRESSION",
                error_message=str(exc),
            )

        output_dir.mkdir(parents=True, exist_ok=True)
        json_path = output_dir / "dependency-check-report.json"
        html_path = output_dir / "dependency-check-report.html"
        command = [
            self.settings.dependency_check_path,
            "--project",
            project_name,
            "--scan",
            str(source_dir),
            "--format",
            "JSON",
            "--format",
            "HTML",
            "--out",
            str(output_dir),
            "--data",
            self.settings.dependency_check_data_dir,
            "--noupdate",
            "--suppression",
            self.settings.dependency_check_suppression_file,
        ]

        with dependency_check_lock(
            data_dir,
            exclusive=False,
            timeout=self.settings.dependency_check_lock_timeout,
        ):
            result = run_scanner_command(
                "dependency-check",
                command,
                json_path,
                output_dir / "dependency-check.stdout.log",
                output_dir / "dependency-check.stderr.log",
                self.settings.dependency_check_timeout,
                output_dir / "dependency-check.command.log",
            )

        report_paths = [json_path, html_path]
        result.report_files = [str(path) for path in report_paths if path.exists()]
        oversized = [
            path
            for path in report_paths
            if path.exists() and path.stat().st_size > self.settings.dependency_check_max_report_bytes
        ]
        if oversized:
            for path in oversized:
                path.unlink(missing_ok=True)
            result.status = "failed"
            result.error_type = "REPORT_TOO_LARGE"
            result.error_message = "Dependency-Check 报告超过大小限制"
            result.message = result.error_message
            result.raw_result_path = ""
            result.report_files = [str(path) for path in report_paths if path.exists()]
            return result

        result.raw_result_path = str(json_path) if json_path.exists() else ""
        return result

    def update_data(self, output_dir: Path, nvd_api_key: str) -> ScannerCommandResult:
        output_dir.mkdir(parents=True, exist_ok=True)
        with dependency_check_lock(
            Path(self.settings.dependency_check_data_dir),
            exclusive=True,
            timeout=self.settings.dependency_check_lock_timeout,
        ), nvd_property_file(nvd_api_key) as property_file:
            command = [
                self.settings.dependency_check_path,
                "--updateonly",
                "--data",
                self.settings.dependency_check_data_dir,
            ]
            if property_file:
                command.extend(["--propertyfile", property_file])
            return run_scanner_command(
                "dependency-check-update",
                command,
                output_dir / "dependency-check-update.json",
                output_dir / "dependency-check-update.stdout.log",
                output_dir / "dependency-check-update.stderr.log",
                self.settings.dependency_check_timeout,
                output_dir / "dependency-check-update.command.log",
            )


def scan_source(
    source_dir: Path,
    output_dir: Path,
    settings: Settings,
    project_name: str,
) -> ScannerCommandResult:
    return DependencyCheckAdapter(settings).scan_source(source_dir, output_dir, project_name)


def update_data(output_dir: Path, settings: Settings, nvd_api_key: str) -> ScannerCommandResult:
    return DependencyCheckAdapter(settings).update_data(output_dir, nvd_api_key)
