import hashlib
import os
import re
import uuid as uuid_lib
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.desktop_update_models import DesktopUpdateArtifact, DesktopUpdateRelease
from .errors import GovernanceError

SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
VALID_TARGETS = {"darwin-aarch64", "windows-x86_64"}
MACOS_EXT = ".app.tar.gz"
WINDOWS_EXT = ".nsis.zip"
TARGET_EXT_MAP = {
    "darwin-aarch64": MACOS_EXT,
    "windows-x86_64": WINDOWS_EXT,
}


def semver_key(value: str) -> tuple[int, int, int]:
    match = SEMVER_RE.fullmatch(value)
    if not match:
        raise GovernanceError(422, "INVALID_AGENT_VERSION", "Agent 版本必须是三段 SemVer")
    return tuple(int(part) for part in match.groups())


def validate_target_file_name(target: str, file_name: str) -> None:
    expected_ext = TARGET_EXT_MAP[target]
    if not file_name.endswith(expected_ext):
        raise GovernanceError(
            422,
            "INVALID_ARTIFACT_EXTENSION",
            f"{target} 产物必须以 {expected_ext} 结尾",
        )
    if "/" in file_name or "\\" in file_name or "\x00" in file_name or ".." in file_name:
        raise GovernanceError(422, "INVALID_FILE_NAME", "文件名不得包含路径分隔符、NUL 或 ..")


def create_release(
    db: Session,
    version: str,
    channel: str,
    release_notes: str,
    actor_id: str,
) -> DesktopUpdateRelease:
    if channel not in ("lan-test", "production"):
        raise GovernanceError(422, "INVALID_CHANNEL", "渠道必须是 lan-test 或 production")

    semver_key(version)

    # Check that version is higher than any existing PUBLISHED release on same channel
    existing = (
        db.query(DesktopUpdateRelease)
        .filter(
            DesktopUpdateRelease.channel == channel,
            DesktopUpdateRelease.status == "PUBLISHED",
        )
        .order_by(DesktopUpdateRelease.agent_version.desc())
        .first()
    )
    if existing:
        try:
            existing_key = semver_key(existing.agent_version)
            new_key = semver_key(version)
            if new_key <= existing_key:
                raise GovernanceError(
                    422,
                    "VERSION_NOT_HIGHER",
                    f"版本 {version} 必须高于已发布版本 {existing.agent_version}",
                )
        except GovernanceError:
            raise
        except Exception:
            pass

    # Check no existing release with same channel+version
    dup = (
        db.query(DesktopUpdateRelease)
        .filter(
            DesktopUpdateRelease.channel == channel,
            DesktopUpdateRelease.agent_version == version,
        )
        .first()
    )
    if dup:
        raise GovernanceError(
            409,
            "RELEASE_EXISTS",
            f"渠道 {channel} 的版本 {version} 已存在",
        )

    release = DesktopUpdateRelease(
        agent_version=version,
        channel=channel,
        status="DRAFT",
        release_notes=release_notes,
        created_by=actor_id,
    )
    db.add(release)
    db.flush()
    return release


async def store_artifact(
    db: Session,
    release_uuid: str,
    target: str,
    expected_sha256: str,
    tauri_signature: str,
    upload: UploadFile,
    settings: Settings | None = None,
) -> DesktopUpdateArtifact:
    if settings is None:
        settings = get_settings()

    if target not in VALID_TARGETS:
        raise GovernanceError(422, "INVALID_TARGET", f"不支持的平台目标 {target}")

    release = (
        db.query(DesktopUpdateRelease)
        .filter(DesktopUpdateRelease.uuid == release_uuid)
        .first()
    )
    if not release:
        raise GovernanceError(404, "RELEASE_NOT_FOUND", "更新发布记录不存在")

    if release.status != "DRAFT":
        raise GovernanceError(409, "RELEASE_NOT_DRAFT", "只能为草稿状态上传产物")

    file_name = upload.filename or "unknown"
    validate_target_file_name(target, file_name)

    if not re.match(r"^[a-f0-9]{64}$", expected_sha256):
        raise GovernanceError(422, "INVALID_SHA256", "SHA-256 必须是 64 位十六进制字符串")

    if not tauri_signature.strip():
        raise GovernanceError(422, "MISSING_SIGNATURE", "Tauri 签名不能为空")

    # Check artifact doesn't already exist for this release+target
    existing = (
        db.query(DesktopUpdateArtifact)
        .filter(
            DesktopUpdateArtifact.release_id == release.id,
            DesktopUpdateArtifact.target == target,
        )
        .first()
    )
    if existing:
        raise GovernanceError(409, "ARTIFACT_EXISTS", f"该版本已存在 {target} 产物")

    storage_root = Path(settings.desktop_update_storage_dir).resolve()
    storage_root.mkdir(parents=True, exist_ok=True)

    storage_key = str(uuid_lib.uuid4())
    temp_path = storage_root / f".tmp-{storage_key}"
    final_path = storage_root / storage_key

    digest = hashlib.sha256()
    size = 0
    try:
        with open(temp_path, "wb") as tmp:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > settings.desktop_update_max_bytes:
                    raise GovernanceError(
                        413,
                        "ARTIFACT_TOO_LARGE",
                        f"升级包超过 {settings.desktop_update_max_bytes} 字节限制",
                    )
                digest.update(chunk)
                tmp.write(chunk)

        computed_sha = digest.hexdigest()
        if computed_sha != expected_sha256:
            raise GovernanceError(
                422,
                "SHA256_MISMATCH",
                f"SHA-256 不匹配：期望 {expected_sha256}，实际 {computed_sha}",
            )

        os.replace(temp_path, final_path)

        artifact = DesktopUpdateArtifact(
            release_id=release.id,
            target=target,
            file_name=file_name,
            storage_key=storage_key,
            content_type=upload.content_type or "application/octet-stream",
            size_bytes=size,
            sha256=computed_sha,
            tauri_signature=tauri_signature,
        )
        db.add(artifact)
        db.flush()
        return artifact
    except Exception:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)
        if final_path.exists():
            final_path.unlink(missing_ok=True)
        raise


def publish_release(db: Session, release_uuid: str) -> DesktopUpdateRelease:
    release = (
        db.query(DesktopUpdateRelease)
        .filter(DesktopUpdateRelease.uuid == release_uuid)
        .with_for_update()
        .first()
    )
    if not release:
        raise GovernanceError(404, "RELEASE_NOT_FOUND", "更新发布记录不存在")

    if release.status == "PUBLISHED":
        raise GovernanceError(409, "ALREADY_PUBLISHED", "该版本已发布")
    if release.status == "WITHDRAWN":
        raise GovernanceError(409, "ALREADY_WITHDRAWN", "已撤回的版本不能重新发布")

    # Validate artifacts
    artifacts = (
        db.query(DesktopUpdateArtifact)
        .filter(DesktopUpdateArtifact.release_id == release.id)
        .all()
    )
    target_set = {a.target for a in artifacts}

    if release.channel == "production":
        required = {"darwin-aarch64", "windows-x86_64"}
        missing = required - target_set
        if missing:
            raise GovernanceError(
                422,
                "MISSING_ARTIFACTS",
                f"正式发布需要所有平台产物，缺少: {', '.join(sorted(missing))}",
            )
    else:  # lan-test
        if not target_set:
            raise GovernanceError(422, "MISSING_ARTIFACTS", "至少需要上传一个平台的产物")

    # Verify no higher version is already published on same channel
    existing = (
        db.query(DesktopUpdateRelease)
        .filter(
            DesktopUpdateRelease.channel == release.channel,
            DesktopUpdateRelease.status == "PUBLISHED",
            DesktopUpdateRelease.uuid != release_uuid,
        )
        .all()
    )
    try:
        new_key = semver_key(release.agent_version)
        for e in existing:
            existing_key = semver_key(e.agent_version)
            if new_key <= existing_key:
                raise GovernanceError(
                    422,
                    "VERSION_NOT_HIGHER",
                    f"版本 {release.agent_version} 不高于已发布版本 {e.agent_version}",
                )
    except GovernanceError:
        raise
    except Exception:
        pass

    from datetime import datetime, timezone

    release.status = "PUBLISHED"
    release.published_at = datetime.now(timezone.utc)
    db.flush()
    return release


def withdraw_release(db: Session, release_uuid: str) -> DesktopUpdateRelease:
    release = (
        db.query(DesktopUpdateRelease)
        .filter(DesktopUpdateRelease.uuid == release_uuid)
        .with_for_update()
        .first()
    )
    if not release:
        raise GovernanceError(404, "RELEASE_NOT_FOUND", "更新发布记录不存在")

    if release.status != "PUBLISHED":
        raise GovernanceError(409, "NOT_PUBLISHED", "只能撤回已发布的版本")

    from datetime import datetime, timezone

    release.status = "WITHDRAWN"
    release.withdrawn_at = datetime.now(timezone.utc)
    db.flush()
    return release


def get_release(db: Session, release_uuid: str) -> DesktopUpdateRelease:
    release = (
        db.query(DesktopUpdateRelease)
        .filter(DesktopUpdateRelease.uuid == release_uuid)
        .first()
    )
    if not release:
        raise GovernanceError(404, "RELEASE_NOT_FOUND", "更新发布记录不存在")
    return release


def list_releases(db: Session, channel: str | None = None) -> list[DesktopUpdateRelease]:
    q = db.query(DesktopUpdateRelease).order_by(DesktopUpdateRelease.created_at.desc())
    if channel:
        q = q.filter(DesktopUpdateRelease.channel == channel)
    return q.all()


def get_artifacts(db: Session, release_id: int) -> list[DesktopUpdateArtifact]:
    return (
        db.query(DesktopUpdateArtifact)
        .filter(DesktopUpdateArtifact.release_id == release_id)
        .all()
    )
