from __future__ import annotations

import hashlib
import re
import uuid as uuid_lib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..crypto import ContentCipher, EncryptedPayload
from ..models import WorkArtifactVersion
from .models import DeliverableDraft, DeliverableMediaAsset
from .service import (
    ALLOWED_MEDIA_MIME_TYPES,
    DeliverableAccess,
    ProfessionalDeliveryError,
)


MAX_MEDIA_ASSET_BYTES = 10 * 1024 * 1024
MAX_MEDIA_ASSETS_PER_DELIVERABLE = 100
_ASSET_UUID_PATTERN = re.compile(r"^[A-Za-z0-9-]{36}$")


@dataclass(frozen=True, slots=True)
class MediaAssetResult:
    asset: DeliverableMediaAsset
    replayed: bool = False


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _asset_ids(content: Any, *, target: str) -> int:
    """Count references in structured content without trusting arbitrary keys."""
    if isinstance(content, dict):
        block_type = content.get("type")
        if block_type in {"image", "media"} and content.get("asset_id") == target:
            return 1 + sum(_asset_ids(value, target=target) for value in content.values())
        return sum(_asset_ids(value, target=target) for value in content.values())
    if isinstance(content, list):
        return sum(_asset_ids(value, target=target) for value in content)
    return 0


def count_media_asset_references(
    db: Session,
    *,
    deliverable_id: int,
    asset_uuid: str,
    cipher: ContentCipher,
) -> int:
    """Return the durable reference count across drafts and immutable versions."""
    references = 0
    draft = db.scalar(
        select(DeliverableDraft).where(DeliverableDraft.deliverable_id == deliverable_id)
    )
    if draft is not None:
        try:
            content = cipher.decrypt_json(
                EncryptedPayload(draft.content_ciphertext, draft.content_nonce),
                f"draft:{draft.uuid}".encode("utf-8"),
            )
            references += _asset_ids(content, target=asset_uuid)
        except Exception:
            # A corrupt draft must not make cleanup unsafe; retain the asset.
            references += 1

    versions = db.scalars(
        select(WorkArtifactVersion).where(WorkArtifactVersion.artifact_id == deliverable_id)
    ).all()
    for version in versions:
        if version.content_ciphertext is None or version.content_nonce is None:
            continue
        try:
            content = cipher.decrypt_json(
                EncryptedPayload(version.content_ciphertext, version.content_nonce),
                version.uuid.encode("utf-8"),
            )
            references += _asset_ids(content, target=asset_uuid)
        except Exception:
            references += 1
    return references


def scan_media_asset(
    db: Session,
    *,
    asset: DeliverableMediaAsset,
    cipher: ContentCipher,
) -> bool:
    """Verify encrypted bytes and their content signature before serving them."""
    try:
        content = cipher.decrypt_bytes(
            EncryptedPayload(asset.content_ciphertext, asset.content_nonce),
            asset.uuid.encode("utf-8"),
        )
        valid = (
            len(content) == asset.size_bytes
            and hashlib.sha256(content).hexdigest() == asset.content_hash
            and _signature_matches(asset.media_type, content)
        )
    except Exception:
        valid = False
    asset.status = "active" if valid else "quarantined"
    db.flush()
    return valid


def cleanup_orphaned_media_assets(
    db: Session,
    *,
    deliverable_id: int,
    cipher: ContentCipher,
    older_than: datetime | None = None,
    limit: int = 100,
) -> list[str]:
    """Soft-delete old active assets that have no durable document references."""
    if limit <= 0:
        return []
    cutoff = older_than or (_utc_now() - timedelta(hours=24))
    if cutoff.tzinfo is not None:
        cutoff = cutoff.astimezone(timezone.utc).replace(tzinfo=None)
    assets = db.scalars(
        select(DeliverableMediaAsset)
        .where(
            DeliverableMediaAsset.deliverable_id == deliverable_id,
            DeliverableMediaAsset.status == "active",
            DeliverableMediaAsset.created_at <= cutoff,
        )
        .order_by(DeliverableMediaAsset.created_at, DeliverableMediaAsset.id)
        .limit(limit)
    ).all()
    deleted: list[str] = []
    for asset in assets:
        if count_media_asset_references(
            db,
            deliverable_id=deliverable_id,
            asset_uuid=asset.uuid,
            cipher=cipher,
        ):
            continue
        asset.status = "deleted"
        deleted.append(asset.uuid)
    db.flush()
    return deleted


def _signature_matches(media_type: str, data: bytes) -> bool:
    if media_type == "image/png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if media_type == "image/jpeg":
        return data.startswith(b"\xff\xd8\xff")
    if media_type == "image/gif":
        return data.startswith((b"GIF87a", b"GIF89a"))
    if media_type == "image/webp":
        return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return False


def _normalized_media_type(value: str | None) -> str:
    normalized = str(value or "").split(";", 1)[0].strip().lower()
    if normalized not in ALLOWED_MEDIA_MIME_TYPES:
        raise ProfessionalDeliveryError(
            "INVALID_MEDIA_ASSET",
            "只支持 PNG、JPEG、GIF 和 WebP 图片",
            422,
        )
    return normalized


def create_media_asset(
    db: Session,
    *,
    access: DeliverableAccess,
    owner_user_id: str,
    idempotency_key: str,
    original_file_name: str,
    media_type: str | None,
    data: bytes,
    cipher: ContentCipher,
    key_version: str,
) -> MediaAssetResult:
    if not idempotency_key or len(idempotency_key) > 128:
        raise ProfessionalDeliveryError(
            "IDEMPOTENCY_KEY_INVALID",
            "素材上传必须提供有效的 Idempotency-Key",
            400,
        )
    normalized_type = _normalized_media_type(media_type)
    if not data:
        raise ProfessionalDeliveryError("INVALID_MEDIA_ASSET", "图片不能为空", 422)
    if len(data) > MAX_MEDIA_ASSET_BYTES:
        raise ProfessionalDeliveryError(
            "MEDIA_ASSET_TOO_LARGE",
            "图片素材不能超过 10 MB",
            413,
        )
    if not _signature_matches(normalized_type, data):
        raise ProfessionalDeliveryError(
            "INVALID_MEDIA_ASSET",
            "图片内容与声明的素材类型不匹配",
            422,
        )

    existing = db.scalar(
        select(DeliverableMediaAsset).where(
            DeliverableMediaAsset.deliverable_id == access.artifact.id,
            DeliverableMediaAsset.owner_user_id == owner_user_id,
            DeliverableMediaAsset.idempotency_key == idempotency_key,
        )
    )
    content_hash = hashlib.sha256(data).hexdigest()
    if existing is not None:
        if existing.content_hash != content_hash or existing.media_type != normalized_type:
            raise ProfessionalDeliveryError(
                "IDEMPOTENCY_KEY_REUSED",
                "该素材幂等键已用于不同内容",
                409,
            )
        return MediaAssetResult(asset=existing, replayed=True)

    active_count = int(
        db.scalar(
            select(func.count(DeliverableMediaAsset.id)).where(
                DeliverableMediaAsset.deliverable_id == access.artifact.id,
                DeliverableMediaAsset.status == "active",
            )
        )
        or 0
    )
    if active_count >= MAX_MEDIA_ASSETS_PER_DELIVERABLE:
        raise ProfessionalDeliveryError(
            "MEDIA_ASSET_LIMIT_REACHED",
            "单个成果最多保存 100 个素材",
            429,
        )

    asset_uuid = str(uuid_lib.uuid4())
    encrypted = cipher.encrypt_bytes(data, asset_uuid.encode("utf-8"))
    asset = DeliverableMediaAsset(
        uuid=asset_uuid,
        deliverable_id=access.artifact.id,
        owner_user_id=owner_user_id,
        idempotency_key=idempotency_key,
        original_file_name=(original_file_name or "image").strip()[:255],
        media_type=normalized_type,
        size_bytes=len(data),
        content_hash=content_hash,
        content_ciphertext=encrypted.ciphertext,
        content_nonce=encrypted.nonce,
        key_version=key_version,
        status="active",
    )
    db.add(asset)
    db.flush()
    if not scan_media_asset(db, asset=asset, cipher=cipher):
        raise ProfessionalDeliveryError(
            "MEDIA_ASSET_UNREADABLE",
            "图片素材扫描失败",
            422,
        )
    return MediaAssetResult(asset=asset, replayed=False)


def get_media_asset(
    db: Session,
    *,
    access: DeliverableAccess,
    asset_uuid: str,
    cipher: ContentCipher,
) -> tuple[DeliverableMediaAsset, bytes]:
    if not _ASSET_UUID_PATTERN.fullmatch(asset_uuid):
        raise ProfessionalDeliveryError("MEDIA_ASSET_NOT_FOUND", "素材不存在", 404)
    asset = db.scalar(
        select(DeliverableMediaAsset).where(
            DeliverableMediaAsset.uuid == asset_uuid,
            DeliverableMediaAsset.deliverable_id == access.artifact.id,
            DeliverableMediaAsset.status == "active",
        )
    )
    if asset is None:
        raise ProfessionalDeliveryError("MEDIA_ASSET_NOT_FOUND", "素材不存在", 404)
    try:
        content = cipher.decrypt_bytes(
            EncryptedPayload(asset.content_ciphertext, asset.content_nonce),
            asset.uuid.encode("utf-8"),
        )
    except Exception as exc:
        raise ProfessionalDeliveryError(
            "MEDIA_ASSET_UNREADABLE",
            "素材无法读取",
            500,
        ) from exc
    return asset, content


def delete_media_asset(
    db: Session,
    *,
    access: DeliverableAccess,
    asset_uuid: str,
    actor_user_id: str,
) -> DeliverableMediaAsset:
    """Soft-delete an uploaded asset while retaining its audit identity."""
    if not _ASSET_UUID_PATTERN.fullmatch(asset_uuid):
        raise ProfessionalDeliveryError("MEDIA_ASSET_NOT_FOUND", "素材不存在", 404)
    asset = db.scalar(select(DeliverableMediaAsset).where(
        DeliverableMediaAsset.uuid == asset_uuid,
        DeliverableMediaAsset.deliverable_id == access.artifact.id,
        DeliverableMediaAsset.owner_user_id == actor_user_id,
        DeliverableMediaAsset.status == "active",
    ))
    if asset is None:
        raise ProfessionalDeliveryError("MEDIA_ASSET_NOT_FOUND", "素材不存在", 404)
    asset.status = "deleted"
    db.flush()
    return asset
