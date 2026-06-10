from __future__ import annotations

from pathlib import Path

import pytest

from app.config import Settings
from app.scanners.base import ScannerCommandResult
from app.scanners.dependency_check_cache import (
    DependencyCheckLockTimeout,
    dependency_check_lock,
    nvd_property_file,
)
from app.scanners.dependency_check_client import DependencyCheckAdapter


def _initialized_data_dir(tmp_path: Path) -> Path:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "odc.mv.db").write_bytes(b"cache")
    return data_dir


def _suppression_file(tmp_path: Path, content: str | None = None) -> Path:
    suppression = tmp_path / "suppression.xml"
    suppression.write_text(
        content
        or '<suppressions xmlns="https://jeremylong.github.io/DependencyCheck/dependency-suppression.1.3.xsd"/>',
        encoding="utf-8",
    )
    return suppression


def test_dependency_check_scan_uses_shared_cache_and_no_update(monkeypatch, tmp_path: Path):
    captured: dict[str, object] = {}

    def fake_run(engine_name, command, output_path, stdout_path, stderr_path, timeout, command_log_path):
        captured["command"] = command
        captured["timeout"] = timeout
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text('{"dependencies":[]}', encoding="utf-8")
        html_path = output_path.with_suffix(".html")
        html_path.write_text("<html></html>", encoding="utf-8")
        return ScannerCommandResult(
            engine_name=engine_name,
            status="completed",
            command=command,
            raw_result_path=str(output_path),
        )

    monkeypatch.setattr("app.scanners.dependency_check_client.run_scanner_command", fake_run)
    data_dir = _initialized_data_dir(tmp_path)
    suppression = _suppression_file(tmp_path)
    settings = Settings(
        dependency_check_path="/opt/dependency-check/bin/dependency-check.sh",
        dependency_check_data_dir=str(data_dir),
        dependency_check_suppression_file=str(suppression),
    )

    result = DependencyCheckAdapter(settings).scan_source(tmp_path / "project", tmp_path / "out", "project-1")

    command = captured["command"]
    assert isinstance(command, list)
    assert result.status == "completed"
    assert "--noupdate" in command
    assert command[command.index("--data") + 1] == str(data_dir)
    assert command.count("--format") == 2
    assert "JSON" in command
    assert "HTML" in command
    assert result.report_files == [
        str(tmp_path / "out" / "dependency-check-report.json"),
        str(tmp_path / "out" / "dependency-check-report.html"),
    ]


def test_scan_skips_when_cache_is_not_initialized(tmp_path: Path):
    settings = Settings(
        dependency_check_data_dir=str(tmp_path / "empty-data"),
        dependency_check_suppression_file=str(tmp_path / "suppression.xml"),
    )

    result = DependencyCheckAdapter(settings).scan_source(tmp_path / "project", tmp_path / "out", "demo")

    assert result.status == "skipped"
    assert result.error_type == "CACHE_NOT_INITIALIZED"


def test_invalid_suppression_fails_only_dependency_check(tmp_path: Path):
    data_dir = _initialized_data_dir(tmp_path)
    suppression = _suppression_file(tmp_path, "<invalid/>")
    settings = Settings(
        dependency_check_data_dir=str(data_dir),
        dependency_check_suppression_file=str(suppression),
    )

    result = DependencyCheckAdapter(settings).scan_source(tmp_path / "project", tmp_path / "out", "demo")

    assert result.status == "failed"
    assert result.error_type == "INVALID_SUPPRESSION"


def test_nvd_property_file_is_private_and_removed():
    with nvd_property_file("test-only-key") as filename:
        path = Path(filename)
        assert path.read_text(encoding="utf-8") == "nvd.api.key=test-only-key\n"
        assert path.stat().st_mode & 0o777 == 0o600

    assert not path.exists()


def test_dependency_check_update_command_contains_only_property_path(monkeypatch, tmp_path: Path):
    captured: dict[str, object] = {}

    def fake_run(engine_name, command, *_args):
        property_path = Path(command[command.index("--propertyfile") + 1])
        captured["command"] = command
        captured["property_path"] = property_path
        captured["property_content"] = property_path.read_text(encoding="utf-8")
        captured["property_mode"] = property_path.stat().st_mode & 0o777
        return ScannerCommandResult(engine_name, "completed", command)

    monkeypatch.setattr("app.scanners.dependency_check_client.run_scanner_command", fake_run)
    settings = Settings(dependency_check_data_dir=str(tmp_path / "data"))

    result = DependencyCheckAdapter(settings).update_data(tmp_path / "out", "test-only-key")

    command = captured["command"]
    assert isinstance(command, list)
    assert result.status == "completed"
    assert "test-only-key" not in " ".join(command)
    assert "--propertyfile" in command
    assert captured["property_content"] == "nvd.api.key=test-only-key\n"
    assert captured["property_mode"] == 0o600
    assert not captured["property_path"].exists()


def test_dependency_check_rejects_and_removes_oversized_reports(monkeypatch, tmp_path: Path):
    def fake_run(engine_name, command, output_path, *_args):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text("123456", encoding="utf-8")
        output_path.with_suffix(".html").write_text("123456", encoding="utf-8")
        return ScannerCommandResult(
            engine_name,
            "completed",
            command,
            raw_result_path=str(output_path),
            duration_seconds=7,
        )

    monkeypatch.setattr("app.scanners.dependency_check_client.run_scanner_command", fake_run)
    settings = Settings(
        dependency_check_data_dir=str(_initialized_data_dir(tmp_path)),
        dependency_check_suppression_file=str(_suppression_file(tmp_path)),
        dependency_check_max_report_bytes=5,
    )

    result = DependencyCheckAdapter(settings).scan_source(tmp_path / "project", tmp_path / "out", "demo")

    assert result.status == "failed"
    assert result.error_type == "REPORT_TOO_LARGE"
    assert result.duration_seconds == 7
    assert not (tmp_path / "out" / "dependency-check-report.json").exists()
    assert not (tmp_path / "out" / "dependency-check-report.html").exists()


def test_dependency_check_lock_times_out_when_cache_is_exclusively_locked(tmp_path: Path):
    data_dir = tmp_path / "data"

    with dependency_check_lock(data_dir, exclusive=True, timeout=1):
        with pytest.raises(DependencyCheckLockTimeout):
            with dependency_check_lock(data_dir, exclusive=False, timeout=0):
                pass
