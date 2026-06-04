from __future__ import annotations

import json
import shlex
import shutil
import subprocess
from dataclasses import asdict, dataclass, field
from hashlib import sha256
from pathlib import Path


@dataclass
class ScannerCommandResult:
    engine_name: str
    status: str
    command: list[str]
    raw_result_path: str = ""
    stdout_log_path: str = ""
    stderr_log_path: str = ""
    stdout: str = ""
    stderr: str = ""
    error_message: str = ""
    duration_seconds: int = 0
    exit_code: int | None = None
    report_files: list[str] = field(default_factory=list)
    error_type: str = ""
    message: str = ""
    raw_error: str = ""
    command_log_path: str = ""
    warnings: list[str] = field(default_factory=list)


@dataclass
class NormalizedComponentData:
    source_engine: str
    package_name: str
    normalized_name: str = ""
    ecosystem: str = "unknown"
    package_manager: str = ""
    version: str = ""
    version_normalized: str = ""
    purl: str = ""
    cpe: str = ""
    license: str = ""
    dependency_type: str = "direct"
    scope: str = "runtime"
    source_file: str = ""
    evidence_file: str = ""
    evidence_text: str = ""
    confidence_score: float = 0.7


@dataclass
class NormalizedVulnerabilityData:
    source_engine: str
    vulnerability_id: str
    cve_id: str = ""
    ghsa_id: str = ""
    osv_id: str = ""
    title: str = ""
    description: str = ""
    severity: str = "unknown"
    cvss_score: float = 0
    cvss_vector: str = ""
    affected_package: str = ""
    affected_version_range: str = ""
    current_version: str = ""
    fixed_versions: list[str] = field(default_factory=list)
    references: list[str] = field(default_factory=list)
    has_poc: bool = False
    has_exploit: bool = False
    kev: bool = False
    match_confidence: float = 0.5
    raw_source: str = ""


def write_json(path: Path, payload: object) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def file_sha256(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def dataclass_json(path: Path, rows: list[object]) -> Path:
    return write_json(path, [asdict(row) for row in rows])


SENSITIVE_ARGUMENT_FLAGS = {
    "-token",
    "--token",
    "--api-key",
    "--apikey",
    "--password",
    "--secret",
}


def redact_command(command: list[str]) -> list[str]:
    redacted: list[str] = []
    hide_next = False
    for item in command:
        if hide_next:
            redacted.append("***")
            hide_next = False
            continue
        lower = item.lower()
        if lower in SENSITIVE_ARGUMENT_FLAGS:
            redacted.append(item)
            hide_next = True
            continue
        if any(lower.startswith(f"{flag}=") for flag in SENSITIVE_ARGUMENT_FLAGS):
            flag, _value = item.split("=", 1)
            redacted.append(f"{flag}=***")
            continue
        redacted.append(item)
    return redacted


def command_to_log_line(command: list[str]) -> str:
    return " ".join(shlex.quote(item) for item in redact_command(command))


def append_command_log(path: Path, command: list[str]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(command_to_log_line(command) + "\n")
    return str(path)


def run_scanner_command(
    engine_name: str,
    command: list[str],
    output_path: Path,
    stdout_path: Path,
    stderr_path: Path,
    timeout: int,
    command_log_path: Path | None = None,
) -> ScannerCommandResult:
    executable = command[0]
    sanitized_command = redact_command(command)
    command_log_text = append_command_log(command_log_path, command) if command_log_path else ""
    if shutil.which(executable) is None and not Path(executable).exists():
        message = f"{engine_name} 命令不存在: {executable}"
        stdout_path.parent.mkdir(parents=True, exist_ok=True)
        stdout_path.write_text("", encoding="utf-8")
        stderr_path.write_text(message, encoding="utf-8")
        return ScannerCommandResult(
            engine_name=engine_name,
            status="failed",
            command=sanitized_command,
            stderr=message,
            error_message=message,
            exit_code=None,
            error_type="TOOL_MISSING",
            message=message,
            raw_error=message,
            stderr_log_path=str(stderr_path),
            command_log_path=command_log_text,
        )
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        completed = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
        stdout_path.write_text(completed.stdout or "", encoding="utf-8")
        stderr_path.write_text(completed.stderr or "", encoding="utf-8")
        if completed.returncode != 0:
            return ScannerCommandResult(
                engine_name=engine_name,
                status="failed",
                command=sanitized_command,
                stdout=completed.stdout or "",
                stderr=completed.stderr or "",
                error_message=completed.stderr or f"{engine_name} 返回码 {completed.returncode}",
                stdout_log_path=str(stdout_path),
                stderr_log_path=str(stderr_path),
                raw_result_path=str(output_path) if output_path.exists() else "",
                exit_code=completed.returncode,
                message=completed.stderr or f"{engine_name} 返回码 {completed.returncode}",
                raw_error=completed.stderr or "",
                command_log_path=command_log_text,
                report_files=[str(output_path)] if output_path.exists() else [],
            )
        if completed.stdout and not output_path.exists():
            output_path.write_text(completed.stdout, encoding="utf-8")
        report_files = [str(output_path)] if output_path.exists() else []
        return ScannerCommandResult(
            engine_name=engine_name,
            status="completed",
            command=sanitized_command,
            stdout=completed.stdout or "",
            stderr=completed.stderr or "",
            stdout_log_path=str(stdout_path),
            stderr_log_path=str(stderr_path),
            raw_result_path=str(output_path),
            exit_code=completed.returncode,
            report_files=report_files,
            command_log_path=command_log_text,
        )
    except subprocess.TimeoutExpired as exc:
        message = f"{engine_name} 执行超时: {timeout}s"
        stderr_path.parent.mkdir(parents=True, exist_ok=True)
        stderr_path.write_text(message, encoding="utf-8")
        return ScannerCommandResult(
            engine_name=engine_name,
            status="timeout",
            command=sanitized_command,
            stderr=str(exc),
            error_message=message,
            stderr_log_path=str(stderr_path),
            exit_code=None,
            error_type="TIMEOUT",
            message=message,
            raw_error=str(exc),
            command_log_path=command_log_text,
        )
    except OSError as exc:
        message = f"{engine_name} 执行失败: {exc}"
        stderr_path.parent.mkdir(parents=True, exist_ok=True)
        stderr_path.write_text(message, encoding="utf-8")
        return ScannerCommandResult(
            engine_name=engine_name,
            status="failed",
            command=sanitized_command,
            stderr=str(exc),
            error_message=message,
            stderr_log_path=str(stderr_path),
            exit_code=None,
            error_type="EXECUTION_FAILED",
            message=message,
            raw_error=str(exc),
            command_log_path=command_log_text,
        )
