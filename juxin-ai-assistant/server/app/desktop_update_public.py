from pathlib import Path
from collections.abc import Iterator
from typing import Annotated
import re

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
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
STORAGE_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def _iter_file_range(path: Path, start: int, length: int, chunk_size: int = 1024 * 1024) -> Iterator[bytes]:
    with path.open("rb") as handle:
        handle.seek(start)
        remaining = length
        while remaining > 0:
            chunk = handle.read(min(chunk_size, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


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
        internal_target = TARGETS.get((target, arch))
        if not internal_target:
            return Response(status_code=204)

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

        latest = max(releases, key=lambda r: semver_key(r.agent_version))

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
        if not STORAGE_KEY_RE.fullmatch(storage_key):
            raise HTTPException(404)
        storage_root = Path(settings.desktop_update_storage_dir).resolve()
        file_path = (storage_root / storage_key).resolve()

        if file_path.parent != storage_root:
            raise HTTPException(404)

        if not file_path.is_file():
            raise HTTPException(404)

        range_header = request.headers.get("range")
        if range_header:
            file_size = file_path.stat().st_size
            ranges = range_header.replace("bytes=", "").split(",")
            if len(ranges) > 1:
                return Response(status_code=416)

            try:
                raw_start, raw_end = ranges[0].strip().removeprefix("bytes=").split("-", 1)
                if raw_start:
                    start = int(raw_start)
                    end = int(raw_end) if raw_end else file_size - 1
                else:
                    suffix_length = int(raw_end)
                    if suffix_length <= 0:
                        return Response(status_code=416)
                    start = max(file_size - suffix_length, 0)
                    end = file_size - 1
            except ValueError:
                return Response(status_code=416)

            if start < 0 or start >= file_size or end < start:
                return Response(status_code=416)

            end = min(end, file_size - 1)
            content_length = end - start + 1
            headers = {
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(content_length),
            }
            return StreamingResponse(
                _iter_file_range(file_path, start, content_length),
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
