from __future__ import annotations

import json
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


def run_scanner_command(
    engine_name: str,
    command: list[str],
    output_path: Path,
    stdout_path: Path,
    stderr_path: Path,
    timeout: int,
) -> ScannerCommandResult:
    executable = command[0]
    if shutil.which(executable) is None and not Path(executable).exists():
        message = f"{engine_name} 命令不存在: {executable}"
        stdout_path.parent.mkdir(parents=True, exist_ok=True)
        stdout_path.write_text("", encoding="utf-8")
        stderr_path.write_text(message, encoding="utf-8")
        return ScannerCommandResult(
            engine_name=engine_name,
            status="failed",
            command=command,
            stderr=message,
            error_message=message,
            stderr_log_path=str(stderr_path),
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
                command=command,
                stdout=completed.stdout or "",
                stderr=completed.stderr or "",
                error_message=completed.stderr or f"{engine_name} 返回码 {completed.returncode}",
                stdout_log_path=str(stdout_path),
                stderr_log_path=str(stderr_path),
                raw_result_path=str(output_path) if output_path.exists() else "",
            )
        if completed.stdout and not output_path.exists():
            output_path.write_text(completed.stdout, encoding="utf-8")
        return ScannerCommandResult(
            engine_name=engine_name,
            status="completed",
            command=command,
            stdout=completed.stdout or "",
            stderr=completed.stderr or "",
            stdout_log_path=str(stdout_path),
            stderr_log_path=str(stderr_path),
            raw_result_path=str(output_path),
        )
    except subprocess.TimeoutExpired as exc:
        message = f"{engine_name} 执行超时: {timeout}s"
        stderr_path.parent.mkdir(parents=True, exist_ok=True)
        stderr_path.write_text(message, encoding="utf-8")
        return ScannerCommandResult(
            engine_name=engine_name,
            status="timeout",
            command=command,
            stderr=str(exc),
            error_message=message,
            stderr_log_path=str(stderr_path),
        )

