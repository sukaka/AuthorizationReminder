from __future__ import annotations

from pathlib import Path

from ..config import Settings
from .base import ScannerCommandResult, run_scanner_command


TRIVY_DB_ERROR_KEYWORDS = [
    "failed to download vulnerability db",
    "lookup mirror.gcr.io: i/o timeout",
    "dial tcp",
    "oci artifact error",
    "provide a higher timeout value",
    "toomanyrequests",
]

TRIVY_DB_DOWNLOAD_MESSAGE = (
    "Trivy 漏洞库下载失败，当前环境无法访问 Trivy DB 仓库，可能是 DNS、代理、出口网络或超时时间问题。"
    "系统已尝试多个备用漏洞库仓库但仍未成功。"
    "建议检查服务器是否可以访问 ghcr.io、public.ecr.aws、mirror.gcr.io，或配置 HTTP_PROXY / HTTPS_PROXY，"
    "或提前离线下载 Trivy DB。"
)
TRIVY_CACHE_WARNING = "本次扫描使用本地缓存漏洞库，漏洞库可能不是最新版本。"


def _is_trivy_db_download_error(text: str) -> bool:
    lowered = text.lower()
    return any(keyword in lowered for keyword in TRIVY_DB_ERROR_KEYWORDS)


def _trivy_repositories(settings: Settings) -> list[str]:
    return [item.strip() for item in settings.trivy_db_repositories.split(",") if item.strip()]


def _has_trivy_db_cache(cache_dir: str) -> bool:
    path = Path(cache_dir)
    if not path.exists():
        return False
    expected_db = path / "db" / "trivy.db"
    if expected_db.exists():
        return True
    return any(path.rglob("*"))


class TrivyAdapter:
    def __init__(self, settings: Settings):
        self.settings = settings

    def scan_fs(self, source_dir: Path, output_dir: Path) -> ScannerCommandResult:
        output = output_dir / "trivy-result.json"
        return self._scan("fs", str(source_dir), output_dir, output)

    def scan_image(self, image_ref: str, output_dir: Path) -> ScannerCommandResult:
        output = output_dir / "trivy-image-result.json"
        return self._scan("image", image_ref, output_dir, output)

    def _scan(self, scan_type: str, target: str, output_dir: Path, output: Path) -> ScannerCommandResult:
        stdout = output_dir / f"trivy-{scan_type}.stdout.log"
        stderr = output_dir / f"trivy-{scan_type}.stderr.log"
        command_log = output_dir / "trivy.command.log"
        if not self.settings.trivy_enabled:
            return ScannerCommandResult("trivy", "skipped", [], error_message="Trivy 未启用")

        failures: list[ScannerCommandResult] = []
        for repository in _trivy_repositories(self.settings):
            command = self._build_command(scan_type, target, output, repository)
            result = run_scanner_command("trivy", command, output, stdout, stderr, self.settings.trivy_timeout, command_log)
            if result.status == "completed":
                return result
            raw_error = result.stderr or result.error_message
            if _is_trivy_db_download_error(raw_error):
                failures.append(result)
                continue
            return result

        if failures and self.settings.trivy_skip_db_update_on_cache and _has_trivy_db_cache(self.settings.trivy_cache_dir):
            cache_command = self._build_command(scan_type, target, output, None, skip_db_update=True)
            cache_result = run_scanner_command("trivy", cache_command, output, stdout, stderr, self.settings.trivy_timeout, command_log)
            if cache_result.status == "completed":
                cache_result.error_type = "DB_CACHE_USED"
                cache_result.error_message = TRIVY_CACHE_WARNING
                cache_result.message = TRIVY_CACHE_WARNING
                cache_result.warnings.append(TRIVY_CACHE_WARNING)
                return cache_result
            failures.append(cache_result)

        if failures:
            raw_error = "\n\n".join(item.stderr or item.error_message for item in failures if item.stderr or item.error_message)
            last = failures[-1]
            output_dir.mkdir(parents=True, exist_ok=True)
            stderr.write_text(raw_error, encoding="utf-8")
            return ScannerCommandResult(
                "trivy",
                "failed",
                last.command,
                stdout_log_path=last.stdout_log_path,
                stderr_log_path=str(stderr),
                stderr=raw_error,
                error_message=TRIVY_DB_DOWNLOAD_MESSAGE,
                exit_code=last.exit_code,
                error_type="DB_DOWNLOAD_FAILED",
                message=TRIVY_DB_DOWNLOAD_MESSAGE,
                raw_error=raw_error,
                command_log_path=str(command_log),
            )

        command = self._build_command(scan_type, target, output, None)
        return run_scanner_command("trivy", command, output, stdout, stderr, self.settings.trivy_timeout, command_log)

    def _build_command(
        self,
        scan_type: str,
        target: str,
        output: Path,
        repository: str | None,
        *,
        skip_db_update: bool = False,
    ) -> list[str]:
        command = [
            self.settings.trivy_path,
            scan_type,
            target,
            "--format",
            "json",
            "--output",
            str(output),
            "--cache-dir",
            self.settings.trivy_cache_dir,
            "--timeout",
            self.settings.trivy_command_timeout,
        ]
        if repository:
            command.extend(["--db-repository", repository])
        if skip_db_update:
            command.append("--skip-db-update")
        return command


def scan_fs(source_dir: Path, output_dir: Path, settings: Settings) -> ScannerCommandResult:
    return TrivyAdapter(settings).scan_fs(source_dir, output_dir)


def scan_image(image_ref: str, output_dir: Path, settings: Settings) -> ScannerCommandResult:
    return TrivyAdapter(settings).scan_image(image_ref, output_dir)
