from __future__ import annotations

import hashlib
import re
import uuid as uuid_lib
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from fastapi import HTTPException


DOCX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)
PPTX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
)


@dataclass(frozen=True)
class SavedExportFile:
    file_id: str
    file_name: str
    file_path: str


class ExportFileManager:
    def __init__(self, storage_dir: str) -> None:
        self.storage_dir = Path(storage_dir).expanduser().resolve()

    def save_docx(self, *, file_name: str, content: bytes) -> SavedExportFile:
        if not content:
            raise HTTPException(status_code=500, detail="Word 生成失败，请稍后重试")
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        file_id = str(uuid_lib.uuid4())
        safe_name = safe_docx_file_name(file_name)
        path = self.storage_dir.joinpath(f"{file_id}.docx").resolve()
        if not _is_relative_to(path, self.storage_dir):
            raise HTTPException(status_code=400, detail="导出路径非法")
        path.write_bytes(content)
        return SavedExportFile(
            file_id=file_id,
            file_name=safe_name,
            file_path=str(path),
        )

    def save_pptx(
        self,
        *,
        owner_user_id: str,
        file_name: str,
        content: bytes,
    ) -> SavedExportFile:
        if not content:
            raise HTTPException(status_code=500, detail="PPT 生成失败，请稍后重试")
        owner_key = _owner_storage_key(owner_user_id)
        owner_dir = self.storage_dir.joinpath("pptx", owner_key).resolve()
        if not _is_relative_to(owner_dir, self.storage_dir):
            raise HTTPException(status_code=400, detail="导出路径非法")
        owner_dir.mkdir(parents=True, exist_ok=True)
        file_id = str(uuid_lib.uuid4())
        safe_name = safe_pptx_file_name(file_name)
        path = owner_dir.joinpath(f"{file_id}.pptx").resolve()
        if not _is_relative_to(path, owner_dir):
            raise HTTPException(status_code=400, detail="导出路径非法")
        path.write_bytes(content)
        return SavedExportFile(
            file_id=file_id,
            file_name=safe_name,
            file_path=str(path),
        )

    def read_docx(self, file_path: str) -> bytes:
        path = Path(file_path).expanduser().resolve()
        if not _is_relative_to(path, self.storage_dir) or path.suffix.lower() != ".docx":
            raise HTTPException(status_code=404, detail="导出文件不存在")
        if not path.is_file():
            raise HTTPException(status_code=404, detail="导出文件不存在")
        return path.read_bytes()

    def delete_docx(self, file_path: str) -> bool:
        path = Path(file_path).expanduser().resolve()
        if not _is_relative_to(path, self.storage_dir) or path.suffix.lower() != ".docx":
            return False
        existed = path.is_file()
        try:
            path.unlink(missing_ok=True)
        except OSError:
            return False
        return existed


def safe_docx_file_name(file_name: str) -> str:
    return _safe_export_file_name(file_name, suffix=".docx", fallback="聚信得仁文档")


def safe_pptx_file_name(file_name: str) -> str:
    return _safe_export_file_name(file_name, suffix=".pptx", fallback="聚信得仁演示文稿")


def _owner_storage_key(owner_user_id: str) -> str:
    normalized = str(owner_user_id or "").strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="导出文件必须绑定用户")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _safe_export_file_name(file_name: str, *, suffix: str, fallback: str) -> str:
    without_path = re.split(r"[/\\]+", file_name)[-1].strip()
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", without_path)[:120]
    stem = cleaned.strip(" .") or fallback
    return stem if stem.lower().endswith(suffix) else f"{stem}{suffix}"


def content_disposition_for_download(file_name: str) -> str:
    safe_name = safe_docx_file_name(file_name)
    ascii_name = safe_name.encode("ascii", "ignore").decode("ascii").strip()
    ascii_name = ascii_name if ascii_name.lower().endswith(".docx") else "juxin-export.docx"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(safe_name)}"


def _is_relative_to(path: Path, directory: Path) -> bool:
    try:
        path.relative_to(directory)
    except ValueError:
        return False
    return True
