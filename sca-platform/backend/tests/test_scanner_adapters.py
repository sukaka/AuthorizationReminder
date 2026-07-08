from __future__ import annotations

import subprocess
from pathlib import Path

from app.config import Settings
from app.scanners import base as scanner_base
from app.scanners.base import ScannerCommandResult, redact_command, run_scanner_command
from app.scanners.dependency_track_client import DependencyTrackClient
from app.scanners.opensca_client import OpenSCAAdapter
from app.scanners.trivy_client import TrivyAdapter


def _fake_tool(tmp_path: Path, name: str) -> str:
    tool = tmp_path / name
    tool.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    tool.chmod(0o755)
    return str(tool)


def test_trivy_db_download_failure_returns_structured_error_and_retries_repositories(monkeypatch, tmp_path):
    calls: list[list[str]] = []

    def fake_run(command, **_kwargs):
        calls.append(list(command))
        return subprocess.CompletedProcess(
            command,
            1,
            "",
            "failed to download vulnerability DB: OCI artifact error: lookup mirror.gcr.io: i/o timeout",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)
    settings = Settings(
        trivy_path=_fake_tool(tmp_path, "trivy"),
        trivy_db_repositories="ghcr.io/aquasecurity/trivy-db:2,public.ecr.aws/aquasecurity/trivy-db:2,mirror.gcr.io/aquasec/trivy-db:2",
        trivy_command_timeout="30m",
        trivy_cache_dir=str(tmp_path / "empty-cache"),
    )

    result = TrivyAdapter(settings).scan_fs(tmp_path / "project", tmp_path / "reports")

    scan_calls = [command for command in calls if "fs" in command]
    assert result.status == "failed"
    assert result.error_type == "DB_DOWNLOAD_FAILED"
    assert "Trivy 漏洞库下载失败" in result.error_message
    assert [command[command.index("--db-repository") + 1] for command in scan_calls] == [
        "ghcr.io/aquasecurity/trivy-db:2",
        "public.ecr.aws/aquasecurity/trivy-db:2",
        "mirror.gcr.io/aquasec/trivy-db:2",
    ]
    assert all("--timeout" in command and "30m" in command for command in scan_calls)


def test_opensca_invalid_argument_returns_structured_error_without_trivy_flags(monkeypatch, tmp_path):
    calls: list[list[str]] = []

    def fake_run(command, **_kwargs):
        calls.append(list(command))
        return subprocess.CompletedProcess(
            command,
            2,
            "",
            "flag provided but not defined: -format\nUsage of /usr/local/bin/opensca",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)
    settings = Settings(opensca_path=_fake_tool(tmp_path, "opensca"))

    result = OpenSCAAdapter(settings).scan_source(tmp_path / "project", tmp_path / "reports")

    scan_command = next(command for command in calls if "-path" in command)
    assert result.status == "failed"
    assert result.error_type == "INVALID_ARGUMENT"
    assert "OpenSCA 执行失败" in result.error_message
    assert "-path" in scan_command
    assert "-out" in scan_command
    assert "-log" in scan_command
    assert "-format" not in scan_command
    assert "--output" not in scan_command


def test_opensca_uses_short_default_timeout(monkeypatch, tmp_path):
    captured = {}

    def fake_run_scanner_command(engine_name, command, output_path, stdout_path, stderr_path, timeout, command_log_path):
        captured["timeout"] = timeout
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("[]", encoding="utf-8")
        return ScannerCommandResult(engine_name=engine_name, status="completed", command=command, raw_result_path=str(output_path))

    monkeypatch.setattr("app.scanners.opensca_client.run_scanner_command", fake_run_scanner_command)
    settings = Settings(opensca_path=_fake_tool(tmp_path, "opensca"))

    OpenSCAAdapter(settings).scan_source(tmp_path / "project", tmp_path / "reports")

    assert captured["timeout"] <= 900


def test_dependency_track_bom_upload_accepts_empty_success_response(monkeypatch, tmp_path):
    bom_path = tmp_path / "bom.json"
    bom_path.write_text('{"bomFormat":"CycloneDX","components":[]}', encoding="utf-8")

    class FakeResponse:
        status_code = 200
        text = ""
        content = b""

        def raise_for_status(self):
            return None

        def json(self):
            raise ValueError("Expecting value: line 1 column 1 (char 0)")

    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def put(self, url, json):
            assert url.endswith("/api/v1/bom")
            assert json["project"] == "project-uuid"
            return FakeResponse()

    monkeypatch.setattr("app.scanners.dependency_track_client.httpx.Client", FakeClient)

    result = DependencyTrackClient(
        Settings(dependency_track_api_key="odt_test", dependency_track_url="http://dependency-track")
    ).upload_bom("project-uuid", bom_path)

    assert result == {}


def test_scanner_command_streams_to_files_and_returns_bounded_summaries(monkeypatch, tmp_path):
    captured = {}

    def fake_run(command, **kwargs):
        captured.update(kwargs)
        kwargs["stdout"].write("A" * 256)
        kwargs["stderr"].write("B" * 256)
        return subprocess.CompletedProcess(command, 1)

    monkeypatch.setattr(subprocess, "run", fake_run)
    tool = _fake_tool(tmp_path, "scanner")
    stdout_path = tmp_path / "stdout.log"
    stderr_path = tmp_path / "stderr.log"

    result = run_scanner_command(
        "demo",
        [tool],
        tmp_path / "result.json",
        stdout_path,
        stderr_path,
        timeout=30,
        max_log_bytes=128,
        summary_bytes=32,
    )

    assert captured["stdout"].name == str(stdout_path)
    assert captured["stderr"].name == str(stderr_path)
    assert "capture_output" not in captured
    assert stdout_path.stat().st_size <= 128
    assert stderr_path.stat().st_size <= 128
    assert len(result.stdout.encode()) <= 32
    assert len(result.stderr.encode()) <= 32


def test_scanner_command_records_elapsed_seconds(monkeypatch, tmp_path):
    monkeypatch.setattr(subprocess, "run", lambda command, **_kwargs: subprocess.CompletedProcess(command, 0))
    monkeypatch.setattr(scanner_base.time, "monotonic", iter([10.0, 12.6]).__next__)
    tool = _fake_tool(tmp_path, "scanner")

    result = run_scanner_command(
        "demo",
        [tool],
        tmp_path / "result.json",
        tmp_path / "stdout.log",
        tmp_path / "stderr.log",
        timeout=30,
    )

    assert result.duration_seconds == 3


def test_dependency_check_nvd_api_key_is_redacted():
    assert redact_command(["dependency-check", "--nvdApiKey", "secret-value"]) == [
        "dependency-check",
        "--nvdApiKey",
        "***",
    ]
    assert redact_command(["dependency-check", "--nvdApiKey=secret-value"]) == [
        "dependency-check",
        "--nvdApiKey=***",
    ]
