from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .admin.desktop_update_service import semver_key
from .config import Settings, get_settings
from .database import get_db
from .desktop_update_models import DesktopUpdateArtifact, DesktopUpdateRelease


TARGETS = {
    ("darwin", "aarch64"): "darwin-aarch64",
    ("darwin", "x86_64"): "darwin-x86_64",
    ("windows", "x86_64"): "windows-x86_64",
}


def create_desktop_update_public_router() -> APIRouter:
    router = APIRouter(prefix="/desktop/updates", tags=["desktop-updates-public"])

    @router.get("/{channel}/{target}/{arch}/latest.json")
    async def get_latest_update(
        channel: str,
        target: str,
        arch: str,
        db: Annotated[Session, Depends(get_db)],
        settings: Annotated[Settings, Depends(get_settings)],
    ):
        if db is None:
            raise HTTPException(500, "Database not available")
        if settings is None:
            settings = get_settings()

        internal_target = TARGETS.get((target, arch))
        if not internal_target:
            return Response(status_code=204)

        # Find the latest PUBLISHED release for this channel
        releases = (
            db.query(DesktopUpdateRelease)
            .filter(
                DesktopUpdateRelease.channel == channel,
                DesktopUpdateRelease.status == "PUBLISHED",
            )
            .all()
        )

        if not releases:
            return Response(status_code=204)

        # Pick highest SemVer
        latest = max(releases, key=lambda r: semver_key(r.agent_version))

        # Find matching artifact
        artifact = (
            db.query(DesktopUpdateArtifact)
            .filter(
                DesktopUpdateArtifact.release_id == latest.id,
                DesktopUpdateArtifact.target == internal_target,
            )
            .first()
        )

        if not artifact:
            return Response(status_code=204)

        download_url = (
            f"{settings.desktop_update_public_base_url.rstrip('/')}"
            f"/files/{artifact.storage_key}"
        )

        return {
            "version": latest.agent_version,
            "notes": latest.release_notes,
            "pub_date": (
                latest.published_at.isoformat()
                if latest.published_at
                else None
            ),
            "platforms": {
                f"{target}-{arch}": {
                    "signature": artifact.tauri_signature,
                    "url": download_url,
                }
            },
        }

    @router.get("/files/{storage_key}")
    async def download_artifact(
        storage_key: str,
        request: Request,
        settings: Annotated[Settings, Depends(get_settings)],
    ):
        if settings is None:
            settings = get_settings()

        storage_root = Path(settings.desktop_update_storage_dir).resolve()
        file_path = (storage_root / storage_key).resolve()

        # Path traversal protection
        if file_path.parent != storage_root:
            raise HTTPException(404)

        if not file_path.is_file():
            raise HTTPException(404)

        # Handle Range requests for Tauri updater
        range_header = request.headers.get("range")
        if range_header:
            file_size = file_path.stat().st_size
            ranges = range_header.replace("bytes=", "").split(",")
            if len(ranges) > 1:
                return Response(status_code=416)  # Multi-range not supported

            try:
                start, end = ranges[0].split("-")
                start = int(start) if start else 0
                end = int(end) if end else file_size - 1
            except ValueError:
                return Response(status_code=416)

            if start >= file_size or end >= file_size or start > end:
                return Response(status_code=416)

            content = file_path.read_bytes()[start : end + 1]
            headers = {
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
            }
            return Response(
                content=content,
                status_code=206,
                headers=headers,
                media_type="application/octet-stream",
            )

        return FileResponse(
            file_path,
            media_type="application/octet-stream",
            filename=storage_key,
        )

    return router
