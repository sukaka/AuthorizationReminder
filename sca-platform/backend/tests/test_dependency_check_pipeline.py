from __future__ import annotations

import json
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.config import Settings
from app.database import Base
from app.scanners.base import ScannerCommandResult
from app.scanners.dependency_check_cache import (
    DependencyCheckLockTimeout,
    dependency_check_lock,
    nvd_property_file,
)
from app.scanners.dependency_check_client import DependencyCheckAdapter


def _session_factory(tmp_path: Path):
    engine = create_engine(f"sqlite:///{tmp_path / 'dependency-check.db'}")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


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


def test_persist_scanner_results_creates_normalized_and_merged_rows(tmp_path: Path):
    from app.scanner_result_service import persist_scan_results

    report = Path(__file__).parent / "fixtures" / "dependency-check-report.json"
    Session = _session_factory(tmp_path)
    with Session() as db:
        project = models.Project(name="java-demo")
        upload = models.UploadFileRecord(
            project=project,
            upload_id="u1",
            original_filename="demo.zip",
        )
        task = models.ScanTask(project=project, upload_file=upload, status="running")
        db.add_all([project, upload, task])
        db.commit()

        counts = persist_scan_results(db, task, {"dependency-check": report})
        persist_scan_results(db, task, {"dependency-check": report})
        db.commit()

        assert counts == {"components": 1, "vulnerabilities": 1}
        assert (
            db.query(models.NormalizedComponent)
            .filter_by(scan_id=task.id, source_engine="dependency-check")
            .count()
            == 1
        )
        assert (
            db.query(models.NormalizedVulnerability)
            .filter_by(scan_id=task.id, source_engine="dependency-check")
            .count()
            == 1
        )
        merged = db.query(models.MergedVulnerability).filter_by(scan_id=task.id).one()
        assert merged.confirmation_status == "single_source"
        assert merged.gate_eligible is False


def _seed_pipeline_scan(Session) -> int:
    from app.celery_app import _ensure_child_scan_tasks

    with Session() as db:
        project = models.Project(name="pipeline-project")
        upload = models.UploadFileRecord(
            project=project,
            upload_id="pipeline-u1",
            original_filename="source.zip",
        )
        task = models.ScanTask(project=project, upload_file=upload, status="running")
        db.add_all([project, upload, task])
        db.flush()
        _ensure_child_scan_tasks(db, task)
        db.commit()
        return task.id


def _scanner_result(engine: str, path: Path) -> ScannerCommandResult:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{}", encoding="utf-8")
    return ScannerCommandResult(
        engine,
        "completed",
        [],
        raw_result_path=str(path),
        report_files=[str(path)],
    )


def test_run_scanner_children_returns_local_report_paths_when_dependency_track_is_disabled(
    monkeypatch,
    tmp_path: Path,
):
    from app.celery_app import _run_scanner_children

    Session = _session_factory(tmp_path)
    task_id = _seed_pipeline_scan(Session)
    opensca_path = tmp_path / "opensca.json"
    syft_path = tmp_path / "syft.json"
    trivy_path = tmp_path / "trivy.json"
    monkeypatch.setattr(
        "app.celery_app.opensca_client.scan_source",
        lambda *_args: _scanner_result("opensca", opensca_path),
    )
    monkeypatch.setattr(
        "app.celery_app.syft_client.generate_sbom",
        lambda *_args: [_scanner_result("syft", syft_path)],
    )
    monkeypatch.setattr(
        "app.celery_app.trivy_client.scan_fs",
        lambda *_args: _scanner_result("trivy", trivy_path),
    )
    monkeypatch.setattr(
        "app.celery_app._effective_dependency_track_settings",
        lambda _db: Settings(dependency_track_api_key=""),
    )

    with Session() as db:
        task = db.get(models.ScanTask, task_id)
        report_paths = _run_scanner_children(db, task, tmp_path / "source")

    assert report_paths == {
        "opensca": opensca_path,
        "syft": syft_path,
        "trivy": trivy_path,
    }


def test_run_scanner_children_saves_dependency_track_payloads(monkeypatch, tmp_path: Path):
    import app.celery_app as celery_module

    Session = _session_factory(tmp_path)
    task_id = _seed_pipeline_scan(Session)
    opensca_path = tmp_path / "opensca.json"
    syft_path = tmp_path / "syft.json"
    trivy_path = tmp_path / "trivy.json"
    effective_settings = celery_module.settings.model_copy(
        update={
            "dependency_track_api_key": "test-only-key",
            "dependency_check_output_dir": str(tmp_path / "dependency-check"),
        }
    )
    monkeypatch.setattr(celery_module, "settings", effective_settings)
    monkeypatch.setattr(
        celery_module.opensca_client,
        "scan_source",
        lambda *_args: _scanner_result("opensca", opensca_path),
    )
    monkeypatch.setattr(
        celery_module.syft_client,
        "generate_sbom",
        lambda *_args: [_scanner_result("syft", syft_path)],
    )
    monkeypatch.setattr(
        celery_module.trivy_client,
        "scan_fs",
        lambda *_args: _scanner_result("trivy", trivy_path),
    )
    monkeypatch.setattr(
        celery_module,
        "_effective_dependency_track_settings",
        lambda _db: effective_settings,
    )

    class FakeDependencyTrackClient:
        def __init__(self, _settings):
            pass

        def enabled(self):
            return True

        def create_project(self, _name, _version):
            return {"uuid": "project-uuid"}

        def upload_bom(self, _project_uuid, _bom_path):
            return {}

        def fetch_metrics(self, _project_uuid):
            return {"critical": 1}

        def fetch_components(self, _project_uuid):
            return [{"name": "commons-text", "version": "1.9"}]

        def fetch_findings(self, _project_uuid):
            return [{"vulnerability": {"vulnId": "CVE-2022-42889"}}]

    monkeypatch.setattr(celery_module, "DependencyTrackClient", FakeDependencyTrackClient)

    with Session() as db:
        task = db.get(models.ScanTask, task_id)
        report_paths = celery_module._run_scanner_children(db, task, tmp_path / "source")
        db.commit()

    components_path = report_paths["dependency-track-components"]
    findings_path = report_paths["dependency-track-findings"]
    assert json.loads(components_path.read_text(encoding="utf-8")) == [
        {"name": "commons-text", "version": "1.9"}
    ]
    assert json.loads(findings_path.read_text(encoding="utf-8")) == [
        {"vulnerability": {"vulnId": "CVE-2022-42889"}}
    ]
