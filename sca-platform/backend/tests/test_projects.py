import importlib

from fastapi.testclient import TestClient


def build_client(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'sca-project-test.db'}")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("UPLOAD_ROOT", str(tmp_path / "uploads"))
    monkeypatch.setenv("REPORT_ROOT", str(tmp_path / "reports"))
    monkeypatch.setenv("SBOM_ROOT", str(tmp_path / "sbom"))
    monkeypatch.setenv("APP_VERSION", "0.1.0")

    from app import config

    config.get_settings.cache_clear()
    import app.database as database
    import app.models as models
    import app.main as main

    importlib.reload(database)
    importlib.reload(models)
    importlib.reload(main)
    return TestClient(main.app), models, database


def test_delete_project_removes_database_records_and_artifacts(monkeypatch, tmp_path):
    client, models, database = build_client(monkeypatch, tmp_path)
    upload_path = tmp_path / "uploads" / "archives" / "source.zip"
    chunk_dir = tmp_path / "uploads" / "chunks" / "upload-1"
    extract_dir = tmp_path / "uploads" / "extracted" / "upload-1"
    report_path = tmp_path / "reports" / "report.docx"
    sbom_path = tmp_path / "sbom" / "sbom.json"
    raw_path = tmp_path / "scanner" / "raw.json"
    normalized_path = tmp_path / "scanner" / "normalized.json"
    stdout_path = tmp_path / "scanner" / "stdout.log"
    stderr_path = tmp_path / "scanner" / "stderr.log"
    for path in [upload_path, report_path, sbom_path, raw_path, normalized_path, stdout_path, stderr_path]:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("data", encoding="utf-8")
    chunk_dir.mkdir(parents=True)
    (chunk_dir / "0.part").write_text("chunk", encoding="utf-8")
    extract_dir.mkdir(parents=True)
    (extract_dir / "requirements.txt").write_text("fastapi==0.115.6", encoding="utf-8")

    with client as test_client:
        with database.SessionLocal() as db:
            project = models.Project(name="to-delete", scan_note="remove everywhere")
            db.add(project)
            db.flush()
            db.add(models.AnalysisProject(id=project.id, name="sca-delete", owner="security"))
            upload = models.UploadFileRecord(
                project_id=project.id,
                upload_id="upload-1",
                original_filename="source.zip",
                storage_path=str(upload_path),
                status="scanned",
            )
            db.add(upload)
            db.flush()
            db.add(models.UploadLog(upload_file_id=upload.id, action="created", message="uploaded"))
            task = models.ScanTask(
                project_id=project.id,
                upload_file_id=upload.id,
                status="success",
                raw_result_path=str(raw_path),
                normalized_result_path=str(normalized_path),
            )
            db.add(task)
            db.flush()
            child_task = models.ScanTask(
                project_id=project.id,
                upload_file_id=upload.id,
                parent_task_id=task.id,
                status="success",
            )
            db.add(child_task)
            db.add(models.ScanLog(scan_task_id=task.id, level="info", message="done"))
            component = models.Component(project_id=project.id, package_name="fastapi", package_version="0.115.6", ecosystem="pypi")
            db.add(component)
            db.flush()
            db.add(models.ComponentDependency(project_id=project.id, child_component_id=component.id, relationship_type="direct"))
            vulnerability = models.VulnerabilityRecord(
                project_id=project.id,
                component_id=component.id,
                package_name="fastapi",
                package_version="0.115.6",
                advisory_id="CVE-2024-9999",
            )
            db.add(vulnerability)
            db.flush()
            ticket = models.RemediationTicket(project_id=project.id, vulnerability_id=vulnerability.id, ticket_no="SCA-1")
            db.add(ticket)
            db.flush()
            db.add(models.RemediationEvent(ticket_id=ticket.id, to_status="未处理", actor="tester"))
            db.add(models.VulnerabilityWhitelist(project_id=project.id, vulnerability_id=vulnerability.id, reason="accepted"))
            db.add(models.AiTriageResult(project_id=project.id, vulnerability_id=vulnerability.id, ai_risk_level="P2"))
            db.add(models.VulnerabilityQueryLog(project_id=project.id, source="osv", status="success"))
            db.add(models.ReportExport(project_id=project.id, format="docx", filename="report.docx", storage_path=str(report_path)))
            db.add(models.SbomDocument(project_id=project.id, format="cyclonedx", filename="sbom.json", storage_path=str(sbom_path)))
            db.add(models.RiskMonitorSnapshot(project_id=project.id, component_id=component.id, component_name="fastapi"))
            db.add(models.RiskChangeRecord(project_id=project.id, component_id=component.id, change_type="version_update"))
            db.add(models.RiskAlert(project_id=project.id, component_id=component.id, title="alert"))
            db.add(models.DependencyTrackProject(local_project_id=project.id, dependency_track_project_uuid="dt-uuid"))
            db.add(models.ScannerTaskResult(project_id=project.id, scan_id=task.id, scan_task_id=task.id, raw_result_path=str(raw_path), normalized_result_path=str(normalized_path), stdout_log_path=str(stdout_path), stderr_log_path=str(stderr_path)))
            db.add(models.RawScanArtifact(project_id=project.id, scan_id=task.id, engine_name="trivy", file_path=str(raw_path)))
            db.add(models.NormalizedComponent(project_id=project.id, scan_id=task.id, package_name="fastapi"))
            db.add(models.NormalizedVulnerability(project_id=project.id, scan_id=task.id, vulnerability_id="CVE-2024-9999"))
            merged_component = models.MergedComponent(project_id=project.id, scan_id=task.id, package_name="fastapi")
            db.add(merged_component)
            db.flush()
            db.add(models.MergedVulnerability(project_id=project.id, scan_id=task.id, component_id=merged_component.id, vulnerability_id="CVE-2024-9999"))
            db.add(models.DevopsScanEvent(project_id=project.id, report_id=None, source="gitlab"))
            db.commit()
            project_id = project.id

        response = test_client.delete(f"/api/sca/projects/{project_id}")

        assert response.status_code == 200
        assert response.json()["status"] == "deleted"
        assert test_client.get("/api/sca/projects").json() == []

        with database.SessionLocal() as db:
            for model in [
                models.Project,
                models.AnalysisProject,
                models.UploadFileRecord,
                models.UploadLog,
                models.ScanTask,
                models.ScanLog,
                models.Component,
                models.ComponentDependency,
                models.VulnerabilityRecord,
                models.VulnerabilityQueryLog,
                models.ReportExport,
                models.SbomDocument,
                models.RiskMonitorSnapshot,
                models.RiskChangeRecord,
                models.RiskAlert,
                models.AiTriageResult,
                models.RemediationTicket,
                models.RemediationEvent,
                models.VulnerabilityWhitelist,
                models.DependencyTrackProject,
                models.ScannerTaskResult,
                models.RawScanArtifact,
                models.NormalizedComponent,
                models.NormalizedVulnerability,
                models.MergedComponent,
                models.MergedVulnerability,
                models.DevopsScanEvent,
            ]:
                assert db.query(model).count() == 0, model.__name__

        for path in [upload_path, report_path, sbom_path, raw_path, normalized_path, stdout_path, stderr_path]:
            assert not path.exists()
        assert not chunk_dir.exists()
        assert not extract_dir.exists()


def test_delete_missing_project_returns_404(monkeypatch, tmp_path):
    client, _models, _database = build_client(monkeypatch, tmp_path)
    with client as test_client:
        response = test_client.delete("/api/sca/projects/999")

    assert response.status_code == 404
