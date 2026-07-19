from __future__ import annotations

import io
import shutil
import stat
import tempfile
import uuid
import zipfile
from pathlib import Path, PurePosixPath

from .config import Settings
from .models import UploadedSkill
from .skill_definition import SkillManifest
from .skill_registry import load_skill_directory


MAX_SKILL_ARCHIVE_BYTES = 20 * 1024 * 1024
MAX_SKILL_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
MAX_SKILL_FILE_BYTES = 10 * 1024 * 1024
MAX_SKILL_FILE_COUNT = 100


class SkillUploadError(ValueError):
    def __init__(self, code: str, message: str | None = None) -> None:
        self.code = code
        super().__init__(message or code)


def skill_storage_root(settings: Settings) -> Path:
    return Path(settings.skill_storage_dir).expanduser().resolve()


def skill_storage_path(settings: Settings, storage_key: str) -> Path:
    # Storage keys are generated UUIDs.  Keep this check even when reading a
    # row so a corrupted database cannot escape the configured directory.
    if not storage_key or Path(storage_key).name != storage_key or any(
        char not in "0123456789abcdef-" for char in storage_key.lower()
    ):
        raise SkillUploadError("SKILL_STORAGE_KEY_INVALID")
    root = skill_storage_root(settings)
    path = (root / storage_key).resolve()
    if root not in path.parents:
        raise SkillUploadError("SKILL_STORAGE_PATH_INVALID")
    return path


def _safe_member_name(name: str) -> str:
    if not name or "\\" in name or "\x00" in name:
        raise SkillUploadError("SKILL_ARCHIVE_PATH_INVALID")
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise SkillUploadError("SKILL_ARCHIVE_PATH_INVALID")
    return "/".join(path.parts)


def _normalise_members(archive: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    members: dict[str, zipfile.ZipInfo] = {}
    total_size = 0
    file_count = 0
    for info in archive.infolist():
        name = _safe_member_name(info.filename.rstrip("/")) if not info.is_dir() else ""
        if info.is_dir():
            continue
        file_count += 1
        if file_count > MAX_SKILL_FILE_COUNT:
            raise SkillUploadError("SKILL_ARCHIVE_TOO_MANY_FILES")
        mode = (info.external_attr >> 16) & 0o170000
        if mode == stat.S_IFLNK:
            raise SkillUploadError("SKILL_ARCHIVE_SYMLINK_NOT_ALLOWED")
        if info.file_size > MAX_SKILL_FILE_BYTES:
            raise SkillUploadError("SKILL_ARCHIVE_FILE_TOO_LARGE")
        total_size += info.file_size
        if total_size > MAX_SKILL_UNCOMPRESSED_BYTES:
            raise SkillUploadError("SKILL_ARCHIVE_TOO_LARGE")
        if name in members:
            raise SkillUploadError("SKILL_ARCHIVE_DUPLICATE_FILE")
        members[name] = info
    return members


def _package_members(archive: zipfile.ZipFile) -> tuple[SkillManifest, dict[str, zipfile.ZipInfo]]:
    members = _normalise_members(archive)
    required = {
        "skill.json",
        "SKILL.md",
        "prompts/system.md",
        "prompts/task.md",
        "prompts/output.md",
        "schemas/input.schema.json",
        "schemas/output.schema.json",
        "examples/good.md",
        "examples/bad.md",
        "eval/checklist.md",
    }
    if not required.issubset(members):
        prefixes = {
            name.split("/", 1)[0]
            for name in members
            if "/" in name
        }
        if len(prefixes) == 1:
            prefix = next(iter(prefixes)) + "/"
            stripped = {
                name[len(prefix):]: info
                for name, info in members.items()
                if name.startswith(prefix)
            }
            if required.issubset(stripped):
                members = stripped
    missing = sorted(required - members.keys())
    if missing:
        raise SkillUploadError("SKILL_PACKAGE_MISSING_FILES", ",".join(missing))
    try:
        import json

        manifest_data = json.loads(archive.read(members["skill.json"]).decode("utf-8"))
        manifest = SkillManifest.model_validate(manifest_data)
    except Exception as exc:
        raise SkillUploadError("SKILL_MANIFEST_INVALID") from exc
    return manifest, members


def validate_skill_archive(data: bytes) -> tuple[SkillManifest, dict[str, bytes]]:
    if len(data) > MAX_SKILL_ARCHIVE_BYTES:
        raise SkillUploadError("SKILL_ARCHIVE_UPLOAD_TOO_LARGE")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise SkillUploadError("SKILL_ARCHIVE_INVALID") from exc
    with archive:
        manifest, members = _package_members(archive)
        files = {name: archive.read(info) for name, info in members.items()}
    return manifest, files


def persist_skill_archive(
    data: bytes,
    *,
    settings: Settings,
    uploaded_by: str,
    scope: str,
    owner: str,
    source_name: str,
) -> UploadedSkill:
    manifest, files = validate_skill_archive(data)
    storage_key = str(uuid.uuid4())
    root = skill_storage_root(settings)
    root.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".skill-", dir=root))
    target = skill_storage_path(settings, storage_key)
    try:
        for name, content in files.items():
            destination = temporary / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
        # Re-read the extracted package so the stored representation follows
        # exactly the same validation path as runtime Skill loading.
        load_skill_directory(temporary)
        temporary.rename(target)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise

    status = "published" if scope == "personal" else "pending_review"
    effective_manifest = manifest.model_copy(update={
        "scope": scope,
        "owner": owner,
        "status": status,
    })
    return UploadedSkill(
        uuid=storage_key,
        skill_id=manifest.id,
        source_name=source_name[:255],
        storage_key=storage_key,
        name=manifest.name,
        description=manifest.description,
        category=manifest.category,
        version=manifest.version,
        scope=scope,
        owner=owner,
        uploaded_by=uploaded_by,
        status=status,
        manifest_json=effective_manifest.model_dump(),
    )


def remove_skill_archive(settings: Settings, storage_key: str) -> None:
    shutil.rmtree(skill_storage_path(settings, storage_key), ignore_errors=True)


def load_uploaded_skill(row: UploadedSkill, settings: Settings):
    definition = load_skill_directory(skill_storage_path(settings, row.storage_key))
    manifest = definition.manifest.model_copy(update={
        "status": row.status,
        "scope": row.scope,
        "owner": row.owner,
    })
    return definition.model_copy(update={"manifest": manifest})
