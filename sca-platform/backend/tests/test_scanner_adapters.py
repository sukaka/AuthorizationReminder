from __future__ import annotations

import subprocess
from pathlib import Path

from app.config import Settings
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
