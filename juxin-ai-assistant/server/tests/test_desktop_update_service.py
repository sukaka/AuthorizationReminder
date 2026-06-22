import io
import pytest
from pydantic import ValidationError

from app.admin.desktop_update_service import (
    create_release,
    semver_key,
    store_artifact,
    publish_release,
    withdraw_release,
    get_release,
    list_releases,
    validate_target_file_name,
)
from app.admin.errors import GovernanceError
from app.admin.schemas import DesktopUpdateCreateIn
from app.config import Settings


class FakeUploadFile:
    def __init__(self, filename: str, content: bytes, content_type: str = "application/gzip"):
        self.filename = filename
        self.file = io.BytesIO(content)
        self.content_type = content_type

    async def read(self, size: int = -1):
        return self.file.read(size)


@pytest.fixture
def test_settings(tmp_path):
    storage = tmp_path / "desktop-updates"
    storage.mkdir()
    return Settings(
        desktop_update_storage_dir=str(storage),
        desktop_update_max_bytes=10 * 1024 * 1024,
        desktop_update_public_base_url="http://localhost:5193/api/ai/desktop/updates",
    )


def test_semver_key():
    assert semver_key("1.0.0") == (1, 0, 0)
    assert semver_key("0.1.0") == (0, 1, 0)
    assert semver_key("99.999.999") == (99, 999, 999)
    with pytest.raises(GovernanceError):
        semver_key("1.0")
    with pytest.raises(GovernanceError):
        semver_key("v1.0.0")
    with pytest.raises(GovernanceError):
        semver_key("1.0.0-beta")


def test_create_release_rejects_same_or_lower_published_version(db):
    create_release(db, "1.0.0", "lan-test", "first", "admin")
    r = db.query(db._model_by_name("DesktopUpdateRelease")).first()
    # Manually set to published
    r.status = "PUBLISHED"
    db.flush()

    with pytest.raises(GovernanceError, match="必须高于"):
        create_release(db, "1.0.0", "lan-test", "dup", "admin")

    with pytest.raises(GovernanceError, match="必须高于"):
        create_release(db, "0.9.0", "lan-test", "lower", "admin")


def test_create_release_allows_higher_version(db):
    create_release(db, "1.0.0", "lan-test", "first", "admin")
    r = db.query(db._model_by_name("DesktopUpdateRelease")).first()
    r.status = "PUBLISHED"
    db.flush()

    # Higher version should be allowed
    release = create_release(db, "1.0.1", "lan-test", "second", "admin")
    assert release.agent_version == "1.0.1"


def test_create_release_rejects_secret_like_input():
    with pytest.raises(ValidationError):
        DesktopUpdateCreateIn.model_validate({
            "agent_version": "1.0.1",
            "channel": "lan-test",
            "release_notes": "测试",
            "private_key": "forbidden",
        })


def test_validate_target_file_name():
    validate_target_file_name("darwin-aarch64", "聚信 AI 助手.app.tar.gz")
    validate_target_file_name("windows-x86_64", "update.nsis.zip")

    with pytest.raises(GovernanceError, match="app.tar.gz"):
        validate_target_file_name("darwin-aarch64", "wrong.dmg")

    with pytest.raises(GovernanceError, match=".."):
        validate_target_file_name("darwin-aarch64", "../evil.app.tar.gz")

    with pytest.raises(GovernanceError, match="/"):
        validate_target_file_name("darwin-aarch64", "path/traversal.app.tar.gz")


def test_publish_requires_artifacts(db, test_settings):
    release = create_release(db, "1.0.1", "lan-test", "test", "admin")

    with pytest.raises(GovernanceError, match="MISSING_ARTIFACTS"):
        publish_release(db, release.uuid)


def test_publish_and_withdraw_flow(db, test_settings):
    release = create_release(db, "1.0.1", "lan-test", "test", "admin")
    content = b"signed-updater-payload"
    import hashlib
    sha = hashlib.sha256(content).hexdigest()

    # We can't easily test async store_artifact in sync test
    # But we can test the publish/withdraw flow
    from app.desktop_update_models import DesktopUpdateArtifact
    artifact = DesktopUpdateArtifact(
        release_id=release.id,
        target="darwin-aarch64",
        file_name="聚信 AI 助手.app.tar.gz",
        storage_key="test-key-001",
        content_type="application/gzip",
        size_bytes=len(content),
        sha256=sha,
        tauri_signature="valid-signature",
    )
    db.add(artifact)
    db.flush()

    published = publish_release(db, release.uuid)
    assert published.status == "PUBLISHED"
    assert published.published_at is not None

    withdrawn = withdraw_release(db, release.uuid)
    assert withdrawn.status == "WITHDRAWN"
    assert withdrawn.withdrawn_at is not None


def test_withdraw_only_published(db):
    release = create_release(db, "1.0.1", "lan-test", "test", "admin")
    with pytest.raises(GovernanceError, match="NOT_PUBLISHED"):
        withdraw_release(db, release.uuid)


def test_list_releases(db):
    create_release(db, "1.0.0", "lan-test", "first", "admin")
    create_release(db, "1.0.1", "lan-test", "second", "admin")
    create_release(db, "1.0.0", "production", "prod", "admin")

    all_releases = list_releases(db)
    assert len(all_releases) == 3

    lan_only = list_releases(db, channel="lan-test")
    assert len(lan_only) == 2
