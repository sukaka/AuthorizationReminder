import importlib
import asyncio
import io
import stat
import tarfile
import zipfile

import pytest
from fastapi.testclient import TestClient


def build_client(monkeypatch, tmp_path, ignored_max_bytes_env=1024 * 1024, chunk_max_bytes=8 * 1024 * 1024):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'sca-upload-test.db'}")
    monkeypatch.setenv("AUTH_DEV_BYPASS", "true")
    monkeypatch.setenv("UPLOAD_ROOT", str(tmp_path / "uploads"))
    monkeypatch.setenv("UPLOAD_MAX_BYTES", str(ignored_max_bytes_env))
    monkeypatch.setenv("UPLOAD_CHUNK_MAX_BYTES", str(chunk_max_bytes))
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


def make_tar(payload: dict[str, bytes]) -> bytes:
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        for name, content in payload.items():
            info = tarfile.TarInfo(name)
            info.size = len(content)
            archive.addfile(info, io.BytesIO(content))
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


def test_resumable_upload_removes_chunk_that_exceeds_declared_total(monkeypatch, tmp_path):
    with build_client(monkeypatch, tmp_path, chunk_max_bytes=16) as client:
        session = client.post(
            "/api/sca/uploads/sessions",
            json={
                "project_name": "bounded-upload",
                "scan_note": "",
                "filename": "source.zip",
                "total_size": 6,
                "total_chunks": 2,
            },
        ).json()
        upload_id = session["upload_id"]

        assert client.put(f"/api/sca/uploads/{upload_id}/chunks/0", content=b"1234").status_code == 200
        rejected = client.put(f"/api/sca/uploads/{upload_id}/chunks/1", content=b"5678")
        state = client.get(f"/api/sca/uploads/sessions/{upload_id}").json()

        assert rejected.status_code == 400
        assert state["received_bytes"] == 4
        assert state["uploaded_chunks"] == [0]


def test_extract_zip_rejects_symlink_and_compression_bomb(monkeypatch, tmp_path):
    from app.celery_app import ArchiveExtractionLimits, _extract_archive

    symlink_archive = tmp_path / "symlink.zip"
    with zipfile.ZipFile(symlink_archive, "w") as archive:
        info = zipfile.ZipInfo("unsafe-link")
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(info, "../../outside")

    with pytest.raises(ValueError, match="链接|特殊"):
        _extract_archive(symlink_archive, tmp_path / "symlink-out", ArchiveExtractionLimits())

    bomb_archive = tmp_path / "bomb.zip"
    with zipfile.ZipFile(bomb_archive, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("large.txt", b"A" * 4096)

    with pytest.raises(ValueError, match="压缩比"):
        _extract_archive(
            bomb_archive,
            tmp_path / "bomb-out",
            ArchiveExtractionLimits(max_compression_ratio=2),
        )

    many_entries_archive = tmp_path / "many-entries.zip"
    with zipfile.ZipFile(many_entries_archive, "w") as archive:
        archive.writestr("one/", b"")
        archive.writestr("two/", b"")
    with pytest.raises(ValueError, match="文件数"):
        _extract_archive(
            many_entries_archive,
            tmp_path / "many-entries-out",
            ArchiveExtractionLimits(max_files=1),
        )


def test_extract_tar_rejects_links_and_total_size_limit(tmp_path):
    from app.celery_app import ArchiveExtractionLimits, _extract_archive

    link_archive = tmp_path / "link.tar.gz"
    with tarfile.open(link_archive, "w:gz") as archive:
        info = tarfile.TarInfo("unsafe-link")
        info.type = tarfile.SYMTYPE
        info.linkname = "../../outside"
        archive.addfile(info)

    with pytest.raises(ValueError, match="链接|特殊"):
        _extract_archive(link_archive, tmp_path / "link-out", ArchiveExtractionLimits())

    size_archive = tmp_path / "size.tar.gz"
    size_archive.write_bytes(make_tar({"requirements.txt": b"fastapi==0.115.6\n"}))
    with pytest.raises(ValueError, match="总大小"):
        _extract_archive(
            size_archive,
            tmp_path / "size-out",
            ArchiveExtractionLimits(max_total_bytes=8),
        )


def test_resumable_upload_rejects_oversized_chunk_and_reports_resume_state(tmp_path):
    from app.upload_service import save_request_chunk, uploaded_chunk_indexes

    class FakeRequest:
        def __init__(self, chunks):
            self.chunks = chunks

        async def stream(self):
            for chunk in self.chunks:
                yield chunk

    chunk_dir = tmp_path / "chunks"
    chunk_dir.mkdir()
    chunk_path = chunk_dir / "00000000.part"

    with pytest.raises(Exception) as exc_info:
        asyncio.run(save_request_chunk(FakeRequest([b"1234", b"56789"]), chunk_path, 8, 12))
    assert getattr(exc_info.value, "status_code", None) == 413
    assert not chunk_path.exists()

    written = asyncio.run(save_request_chunk(FakeRequest([b"123", b"456"]), chunk_path, 8, 12))
    assert written == 6
    assert uploaded_chunk_indexes(chunk_dir, 2) == [0]
