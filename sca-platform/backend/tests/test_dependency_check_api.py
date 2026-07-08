from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


def build_dependency_check_client(monkeypatch, tmp_path):
    output_root = tmp_path / "scanner-results" / "dependency-check"
    from app import config, main, models
    from app.config import Settings
    from app.database import Base

    engine = create_engine(f"sqlite:///{tmp_path / 'dependency-check-api.db'}")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    test_settings = Settings(
        auth_dev_bypass=True,
        upload_root=str(tmp_path / "uploads"),
        report_root=str(tmp_path / "reports"),
        sbom_root=str(tmp_path / "sbom"),
        backup_root=str(tmp_path / "backups"),
        dependency_check_version="12.1.9",
        dependency_check_data_dir=str(tmp_path / "dependency-check-data"),
        dependency_check_output_dir=str(output_root),
    )

    def override_get_db():
        with Session() as db:
            yield db

    monkeypatch.setattr(main, "settings", test_settings)
    monkeypatch.setattr(main, "init_db", lambda: None)
    monkeypatch.setattr(
        main.app,
        "dependency_overrides",
        {
            main.get_db: override_get_db,
            config.get_settings: lambda: test_settings,
        },
    )
    database = SimpleNamespace(SessionLocal=Session)
    return TestClient(main.app), main, models, database, output_root


def seed_artifact_and_metrics(database, models, artifact_path: Path):
    with database.SessionLocal() as db:
        project = models.Project(name="artifact-project")
        upload = models.UploadFileRecord(
            project=project,
            upload_id="artifact-u1",
            original_filename="source.zip",
        )
        scan = models.ScanTask(project=project, upload_file=upload, status="success")
        db.add_all([project, upload, scan])
        db.flush()
        artifact = models.RawScanArtifact(
            project_id=project.id,
            scan_id=scan.id,
            engine_name="dependency-check",
            artifact_type="raw_json",
            file_path=str(artifact_path),
            file_name=artifact_path.name,
            file_size=artifact_path.stat().st_size,
            sha256=sha256(artifact_path.read_bytes()).hexdigest(),
        )
        child_ids = []
        for index, (status, duration) in enumerate(
            [("completed", 10), ("failed", 30), ("skipped", 20)],
            start=1,
        ):
            child = models.ScanTask(
                project=project,
                upload_file=upload,
                parent_task_id=scan.id,
                task_type=f"dependency_check_scan_task_{index}",
                engine_name="dependency-check",
                status=status,
            )
            db.add(child)
            db.flush()
            child_ids.append(child.id)
            db.add(
                models.ScannerTaskResult(
                    project_id=project.id,
                    scan_id=scan.id,
                    scan_task_id=child.id,
                    engine_name="dependency-check",
                    status=status,
                    duration_seconds=duration,
                )
            )
        db.add(artifact)
        db.add_all(
            [
                models.SystemSetting(
                    key="dependency_check_cache_status",
                    value="completed",
                    updated_by="system",
                ),
                models.SystemSetting(
                    key="dependency_check_cache_last_success_at",
                    value=(datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(),
                    updated_by="system",
                ),
            ]
        )
        db.commit()
        return project.id, artifact.id


def test_dependency_check_status_and_artifact_download(monkeypatch, tmp_path):
    client, _main, models, database, output_root = build_dependency_check_client(
        monkeypatch,
        tmp_path,
    )
    artifact_path = output_root / "1" / "dependency-check-report.json"
    artifact_path.parent.mkdir(parents=True)
    artifact_path.write_text('{"dependencies":[]}', encoding="utf-8")
    project_id, artifact_id = seed_artifact_and_metrics(
        database,
        models,
        artifact_path,
    )

    with client as test_client:
        status = test_client.get("/api/sca/dependency-check/status")
        artifacts = test_client.get(f"/api/sca/projects/{project_id}/scan-artifacts")
        download = test_client.get(f"/api/sca/raw-artifacts/{artifact_id}/download")

    assert status.status_code == 200
    assert status.json()["version"] == "12.1.9"
    assert status.json()["status"] == "completed"
    assert status.json()["stale"] is False
    assert status.json()["total_scans"] == 3
    assert status.json()["failed_scans"] == 1
    assert status.json()["skipped_scans"] == 1
    assert status.json()["p50_duration_seconds"] == 20
    assert status.json()["p95_duration_seconds"] == 30
    assert artifacts.json()[0]["engine_name"] == "dependency-check"
    assert download.content == b'{"dependencies":[]}'
    assert "attachment" in download.headers["content-disposition"]


def test_dependency_check_cache_update_enqueues_task(monkeypatch, tmp_path):
    client, main, _models, _database, _output_root = build_dependency_check_client(
        monkeypatch,
        tmp_path,
    )
    captured: dict[str, object] = {}
    monkeypatch.setattr(
        main.update_dependency_check_data,
        "apply_async",
        lambda **kwargs: captured.update(kwargs),
    )

    with client as test_client:
        response = test_client.post("/api/sca/dependency-check/cache/update")

    assert response.status_code == 200
    assert response.json()["status"] == "queued"
    assert "task_id" in captured


def test_raw_artifact_download_rejects_path_outside_scanner_root(monkeypatch, tmp_path):
    client, _main, models, database, _output_root = build_dependency_check_client(
        monkeypatch,
        tmp_path,
    )
    unsafe_path = tmp_path / "outside.json"
    unsafe_path.write_text("secret", encoding="utf-8")
    project_id, artifact_id = seed_artifact_and_metrics(database, models, unsafe_path)

    with client as test_client:
        artifacts = test_client.get(f"/api/sca/projects/{project_id}/scan-artifacts")
        response = test_client.get(f"/api/sca/raw-artifacts/{artifact_id}/download")

    assert artifacts.status_code == 200
    assert response.status_code == 403


def test_vulnerability_api_exposes_confirmation_fields(monkeypatch, tmp_path):
    client, _main, models, database, _output_root = build_dependency_check_client(
        monkeypatch,
        tmp_path,
    )
    with database.SessionLocal() as db:
        project = models.Project(name="confirmation-project")
        component = models.Component(
            project=project,
            package_name="commons-text",
            package_version="1.9",
            ecosystem="maven",
        )
        db.add_all([project, component])
        db.flush()
        db.add(
            models.VulnerabilityRecord(
                project_id=project.id,
                component_id=component.id,
                source="dependency-check",
                advisory_id="CVE-2022-42889",
                cve_id="CVE-2022-42889",
                package_name="commons-text",
                package_version="1.9",
                ecosystem="maven",
                severity="critical",
                confirmation_status="single_source",
                confirmation_engines=json.dumps(["dependency-check"]),
                gate_eligible=False,
                review_reason="等待其他引擎确认",
            )
        )
        db.commit()
        project_id = project.id

    with client as test_client:
        response = test_client.get(f"/api/sca/projects/{project_id}/vulnerabilities")

    item = response.json()["items"][0]
    assert item["confirmation_status"] == "single_source"
    assert json.loads(item["confirmation_engines"]) == ["dependency-check"]
    assert item["gate_eligible"] is False
    assert item["review_reason"] == "等待其他引擎确认"
