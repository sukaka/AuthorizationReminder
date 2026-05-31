from __future__ import annotations

import os
import shutil
import uuid
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AnalysisProject, Project, UploadFileRecord, UploadLog
from .schemas import UploadFileOut

ALLOWED_SUFFIXES = (".zip", ".tar.gz", ".tgz")


def ensure_upload_dirs(root: Path) -> None:
    for name in ("archives", "chunks", "extracted"):
        (root / name).mkdir(parents=True, exist_ok=True)


def validate_archive_filename(filename: str) -> str:
    safe = Path(filename or "").name
    if not safe or not safe.lower().endswith(ALLOWED_SUFFIXES):
        raise HTTPException(status_code=400, detail="仅支持 zip、tar.gz、tgz 源码包")
    return safe


def ensure_project(db: Session, name: str, scan_note: str, owner: str) -> Project:
    project_name = str(name or "").strip()
    if not project_name:
        raise HTTPException(status_code=400, detail="项目名称不能为空")
    project = db.scalar(select(Project).where(Project.name == project_name))
    if project:
        project.scan_note = scan_note
        project.owner = owner or project.owner
        return project
    project = Project(name=project_name, scan_note=scan_note, owner=owner or "security")
    db.add(project)
    db.flush()
    mirror = db.get(AnalysisProject, project.id)
    if not mirror:
        db.add(
            AnalysisProject(
                id=project.id,
                name=f"sca-{project.id}-{project.name}"[:128],
                repository_url="",
                risk_level="medium",
                status="initialized",
                owner=project.owner,
            )
        )
    return project


def add_upload_log(db: Session, upload_file_id: int, action: str, message: str) -> None:
    db.add(UploadLog(upload_file_id=upload_file_id, action=action, message=message))


def to_upload_out(record: UploadFileRecord) -> UploadFileOut:
    return UploadFileOut(
        id=record.id,
        upload_id=record.upload_id,
        project_id=record.project_id,
        project_name=record.project.name if record.project else "",
        original_filename=record.original_filename,
        file_size=record.file_size,
        received_bytes=record.received_bytes,
        total_chunks=record.total_chunks,
        status=record.status,
        scan_note=record.scan_note,
        created_by=record.created_by,
        created_at=record.created_at,
    )


def remove_upload_artifacts(root: Path, record: UploadFileRecord) -> None:
    candidates = [
        Path(record.storage_path) if record.storage_path else None,
        root / "chunks" / record.upload_id,
        root / "extracted" / record.upload_id,
    ]
    for candidate in candidates:
        if not candidate:
            continue
        try:
            if candidate.is_dir():
                shutil.rmtree(candidate)
            elif candidate.exists():
                candidate.unlink()
        except FileNotFoundError:
            continue


async def save_upload_file(upload: UploadFile, destination: Path, max_bytes: int) -> int:
    destination.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    try:
        with destination.open("wb") as output:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="上传文件超过大小限制")
                output.write(chunk)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return total


def chunk_size(path: Path) -> int:
    try:
        return os.path.getsize(path)
    except FileNotFoundError:
        return 0
