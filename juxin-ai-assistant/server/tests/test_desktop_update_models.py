import pytest
from sqlalchemy.exc import IntegrityError

from app.config import get_settings
from app.database import Base, create_engine_for_url, get_session_for_url


@pytest.fixture
def generation_db(tmp_path):
    import app.desktop_update_models  # noqa: F401

    db_path = tmp_path / "test.db"
    engine = create_engine_for_url(f"sqlite+pysqlite:///{db_path}")
    Base.metadata.create_all(engine)
    with get_session_for_url(engine, f"sqlite+pysqlite:///{db_path}") as session:
        yield session
    engine.dispose()


def test_desktop_update_tables_enforce_unique_channel_version_target(generation_db):
    from app.desktop_update_models import DesktopUpdateArtifact, DesktopUpdateRelease

    release = DesktopUpdateRelease(
        agent_version="1.0.1",
        channel="lan-test",
        status="DRAFT",
        release_notes="测试更新",
        created_by="admin",
    )
    generation_db.add(release)
    generation_db.flush()

    # Duplicate channel+version should fail
    dup = DesktopUpdateRelease(
        agent_version="1.0.1",
        channel="lan-test",
        status="DRAFT",
        release_notes="重复版本",
        created_by="admin",
    )
    generation_db.add(dup)
    with pytest.raises(IntegrityError):
        generation_db.flush()
    generation_db.rollback()

    # Add artifact
    artifact = DesktopUpdateArtifact(
        release_id=release.id,
        target="darwin-aarch64",
        file_name="聚信 AI 助手.app.tar.gz",
        storage_key="unique-key-001",
        content_type="application/gzip",
        size_bytes=12345,
        sha256="a" * 64,
        tauri_signature="test-signature",
    )
    generation_db.add(artifact)
    generation_db.flush()

    # Duplicate release_id+target should fail
    dup_artifact = DesktopUpdateArtifact(
        release_id=release.id,
        target="darwin-aarch64",
        file_name="duplicate.app.tar.gz",
        storage_key="unique-key-002",
        content_type="application/gzip",
        size_bytes=999,
        sha256="b" * 64,
        tauri_signature="another-signature",
    )
    generation_db.add(dup_artifact)
    with pytest.raises(IntegrityError):
        generation_db.flush()


def test_config_desktop_update_storage_requires_absolute_path():
    settings = get_settings()
    assert settings.desktop_update_storage_dir.startswith("/"), (
        "desktop_update_storage_dir 必须是绝对路径"
    )


def test_config_max_bytes_within_bounds():
    settings = get_settings()
    assert 1_048_576 <= settings.desktop_update_max_bytes <= 2_147_483_648, (
        "desktop_update_max_bytes 必须在 1 MiB 和 2 GiB 之间"
    )
