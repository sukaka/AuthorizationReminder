import importlib
import io
import zipfile

from fastapi.testclient import TestClient


def build_client(monkeypatch, tmp_path, ignored_max_bytes_env=1024 * 1024):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'sca-upload-test.db'}")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("UPLOAD_ROOT", str(tmp_path / "uploads"))
    monkeypatch.setenv("UPLOAD_MAX_BYTES", str(ignored_max_bytes_env))
    monkeypatch.setenv("CELERY_TASK_ALWAYS_EAGER", "true")

    from app import config

    config.get_settings.cache_clear()
    import app.database as database
    import app.models as models
    import app.celery_app as celery_app
    import app.main as main

    importlib.reload(database)
    importlib.reload(models)
    importlib.reload(celery_app)
    importlib.reload(main)
    return TestClient(main.app)


def make_zip(payload: dict[str, str]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        for name, content in payload.items():
            archive.writestr(name, content)
    return output.getvalue()


def test_upload_zip_records_file_and_project(monkeypatch, tmp_path):
    archive = make_zip({"requirements.txt": "fastapi==0.115.6\n"})

    with build_client(monkeypatch, tmp_path) as client:
        response = client.post(
            "/api/sca/uploads",
            data={"project_name": "demo-api", "scan_note": "第二阶段上传测试"},
            files={"file": ("demo.zip", archive, "application/zip")},
        )
        assert response.status_code == 200
        uploaded = response.json()
        assert uploaded["project_name"] == "demo-api"
        assert uploaded["status"] in {"completed", "scanning", "scanned"}
        assert uploaded["original_filename"] == "demo.zip"

        listing = client.get("/api/sca/uploads").json()
        assert listing["total"] == 1
        assert listing["items"][0]["scan_note"] == "第二阶段上传测试"

        components = client.get(f"/api/sca/projects/{uploaded['project_id']}/components").json()
        assert components[0]["normalized_name"] == "fastapi"
        assert components[0]["purl"] == "pkg:pypi/fastapi@0.115.6"
        assert components[0]["evidence_file"] == "requirements.txt"
        assert components[0]["confidence_score"] > 0

        delete_response = client.delete(f"/api/sca/uploads/{uploaded['id']}")
        assert delete_response.status_code == 200
        assert client.get("/api/sca/uploads").json()["total"] == 0


def test_upload_does_not_reject_archive_by_platform_size_limit(monkeypatch, tmp_path):
    archive = make_zip({"requirements.txt": "fastapi==0.115.6\n"})

    with build_client(monkeypatch, tmp_path, ignored_max_bytes_env=16) as client:
        response = client.post(
            "/api/sca/uploads",
            data={"project_name": "too-large", "scan_note": ""},
            files={"file": ("demo.zip", archive, "application/zip")},
        )

        assert response.status_code == 200
        assert response.json()["file_size"] == len(archive)


def test_resumable_session_does_not_reject_declared_large_file(monkeypatch, tmp_path):
    with build_client(monkeypatch, tmp_path, ignored_max_bytes_env=16) as client:
        response = client.post(
            "/api/sca/uploads/sessions",
            json={
                "project_name": "large-session",
                "scan_note": "不限制大小",
                "filename": "source.zip",
                "total_size": 1024 * 1024 * 1024,
                "total_chunks": 2,
            },
        )

        assert response.status_code == 200
        assert response.json()["file_size"] == 1024 * 1024 * 1024


def test_resumable_upload_merges_chunks(monkeypatch, tmp_path):
    archive = make_zip({"package.json": '{"dependencies":{"vue":"^3.5.13"}}'})
    midpoint = len(archive) // 2

    with build_client(monkeypatch, tmp_path) as client:
        session = client.post(
            "/api/sca/uploads/sessions",
            json={
                "project_name": "chunked-web",
                "scan_note": "断点续传",
                "filename": "source.zip",
                "total_size": len(archive),
                "total_chunks": 2,
            },
        ).json()

        first = client.put(
            f"/api/sca/uploads/{session['upload_id']}/chunks/0",
            content=archive[:midpoint],
        )
        second = client.put(
            f"/api/sca/uploads/{session['upload_id']}/chunks/1",
            content=archive[midpoint:],
        )
        assert first.status_code == 200
        assert second.status_code == 200

        completed = client.post(f"/api/sca/uploads/{session['upload_id']}/complete")
        assert completed.status_code == 200
        assert completed.json()["file_size"] == len(archive)
