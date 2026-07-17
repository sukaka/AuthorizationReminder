from __future__ import annotations

import uuid as uuid_lib
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..crypto import ContentCipher, EncryptedPayload
from ..models import WorkArtifactVersion
from .models import DeliverableDraft, DeliverableEditLease, DeliverableIdempotencyRecord
from .schemas import DeliverableCommitIn, DeliverableDraftUpdateIn, DeliverableVersionCreateIn
from .service import (
    DeliverableAccess,
    DeliverableVersionCreateResult,
    ProfessionalDeliveryError,
    _canonical_hash,
    _require_deliverable_write_access,
    _validate_content,
    _validate_media_references,
    create_deliverable_version,
    get_visible_deliverable,
)


LEASE_TTL = timedelta(minutes=5)
DRAFT_SAVE_OPERATION = "deliverable.draft.save"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _current_version(db: Session, access: DeliverableAccess) -> WorkArtifactVersion:
    if access.artifact.current_version_id is None:
        raise ProfessionalDeliveryError("DELIVERABLE_VERSION_MISSING", "成果没有可编辑版本", 409)
    version = db.get(WorkArtifactVersion, access.artifact.current_version_id)
    if version is None:
        raise ProfessionalDeliveryError("DELIVERABLE_VERSION_MISSING", "成果没有可编辑版本", 409)
    return version


def _decrypt_version(
    version: WorkArtifactVersion,
    *,
    cipher: ContentCipher,
) -> dict[str, Any]:
    if version.content_ciphertext is None or version.content_nonce is None:
        raise ProfessionalDeliveryError("DELIVERABLE_CONTENT_MISSING", "成果正文不可读取", 409)
    return cipher.decrypt_json(
        EncryptedPayload(ciphertext=version.content_ciphertext, nonce=version.content_nonce),
        version.uuid.encode("utf-8"),
    )


def _assert_revision(
    access: DeliverableAccess,
    *,
    row_version: int,
    base_version_uuid: str,
    current_version: WorkArtifactVersion,
) -> None:
    if access.artifact.row_version != row_version or current_version.uuid != base_version_uuid:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_DRAFT_CONFLICT",
            "成果基线已变化，请刷新后恢复草稿",
            409,
            {
                "current_row_version": access.artifact.row_version,
                "current_version_uuid": current_version.uuid,
            },
        )


def _active_lease(
    db: Session,
    *,
    deliverable_id: int,
    actor_user_id: str,
) -> DeliverableEditLease | None:
    lease = db.scalar(
        select(DeliverableEditLease).where(
            DeliverableEditLease.deliverable_id == deliverable_id,
            DeliverableEditLease.status == "active",
        )
    )
    now = _utc_now()
    if lease is not None and lease.expires_at <= now:
        lease.status = "expired"
        db.flush()
        return None
    if lease is not None and lease.owner_user_id != actor_user_id:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_EDIT_LEASE_CONFLICT",
            "成果正在被其他用户编辑",
            409,
            {"owner_user_id": lease.owner_user_id, "expires_at": lease.expires_at.isoformat()},
        )
    return lease


def _require_fencing_token(lease: DeliverableEditLease | None, fencing_token: int | None) -> None:
    if lease is not None and fencing_token != lease.fencing_token:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_EDIT_LEASE_EXPIRED",
            "编辑租约已过期，请重新获取编辑权",
            409,
        )


def get_or_create_draft(
    db: Session,
    *,
    deliverable_uuid: str,
    actor_user_id: str,
    cipher: ContentCipher,
    key_version: str,
) -> tuple[DeliverableAccess, DeliverableDraft]:
    access = get_visible_deliverable(
        db,
        deliverable_uuid=deliverable_uuid,
        actor_user_id=actor_user_id,
        lock=True,
    )
    _require_deliverable_write_access(access)
    version = _current_version(db, access)
    draft = db.scalar(
        select(DeliverableDraft).where(DeliverableDraft.deliverable_id == access.artifact.id)
    )
    if draft is None or draft.base_version_id != version.id or draft.status != "active":
        content = _decrypt_version(version, cipher=cipher)
        draft_uuid = str(uuid_lib.uuid4())
        encrypted = cipher.encrypt_json(content, f"draft:{draft_uuid}".encode("utf-8"))
        draft = DeliverableDraft(
            uuid=draft_uuid,
            deliverable_id=access.artifact.id,
            base_version_id=version.id,
            revision=0,
            content_format="structured_json",
            content_schema_version=str(content.get("schema_version", version.content_schema_version or "1")),
            content_ciphertext=encrypted.ciphertext,
            content_nonce=encrypted.nonce,
            key_version=key_version,
            content_hash=_canonical_hash(content),
            content_summary=access.artifact.content_summary,
            updated_by=actor_user_id,
            status="active",
        )
        db.add(draft)
        db.flush()
    return access, draft


def draft_content(draft: DeliverableDraft, *, cipher: ContentCipher) -> dict[str, Any]:
    return cipher.decrypt_json(
        EncryptedPayload(ciphertext=draft.content_ciphertext, nonce=draft.content_nonce),
        f"draft:{draft.uuid}".encode("utf-8"),
    )


def save_draft(
    db: Session,
    *,
    deliverable_uuid: str,
    body: DeliverableDraftUpdateIn,
    actor_user_id: str,
    idempotency_key: str,
    cipher: ContentCipher,
    key_version: str,
) -> tuple[DeliverableAccess, DeliverableDraft]:
    access, draft = get_or_create_draft(
        db,
        deliverable_uuid=deliverable_uuid,
        actor_user_id=actor_user_id,
        cipher=cipher,
        key_version=key_version,
    )
    current_version = _current_version(db, access)
    _assert_revision(
        access,
        row_version=body.row_version,
        base_version_uuid=body.base_version_uuid,
        current_version=current_version,
    )
    request_hash = _canonical_hash(
        {
            "deliverable_uuid": deliverable_uuid,
            "body": body.model_dump(mode="json"),
        }
    )
    existing = db.scalar(
        select(DeliverableIdempotencyRecord).where(
            DeliverableIdempotencyRecord.actor_user_id == actor_user_id,
            DeliverableIdempotencyRecord.operation == DRAFT_SAVE_OPERATION,
            DeliverableIdempotencyRecord.idempotency_key == idempotency_key,
        )
    )
    if existing is not None:
        if existing.request_hash != request_hash:
            raise ProfessionalDeliveryError(
                "IDEMPOTENCY_KEY_REUSED",
                "该幂等键已用于不同请求",
                409,
            )
        # Autosave retries are allowed to replay the already accepted draft
        # without incrementing the mutable revision a second time.
        return access, draft
    if draft.revision != body.draft_revision:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_DRAFT_CONFLICT",
            "草稿已在其他标签页更新，请刷新后重试",
            409,
            {"current_draft_revision": draft.revision},
        )
    lease = _active_lease(db, deliverable_id=access.artifact.id, actor_user_id=actor_user_id)
    _require_fencing_token(lease, body.fencing_token)
    schema_version = _validate_content(body.content)
    _validate_media_references(db, deliverable_id=access.artifact.id, content=body.content)
    encrypted = cipher.encrypt_json(body.content, f"draft:{draft.uuid}".encode("utf-8"))
    draft.base_version_id = current_version.id
    draft.revision += 1
    draft.content_schema_version = schema_version
    draft.content_ciphertext = encrypted.ciphertext
    draft.content_nonce = encrypted.nonce
    draft.key_version = key_version
    draft.content_hash = _canonical_hash(body.content)
    draft.content_summary = body.content_summary
    draft.updated_by = actor_user_id
    db.add(
        DeliverableIdempotencyRecord(
            actor_user_id=actor_user_id,
            operation=DRAFT_SAVE_OPERATION,
            idempotency_key=idempotency_key,
            request_hash=request_hash,
            deliverable_id=access.artifact.id,
            version_id=current_version.id,
            status="completed",
        )
    )
    db.flush()
    return access, draft


def acquire_lease(
    db: Session,
    *,
    deliverable_uuid: str,
    actor_user_id: str,
    row_version: int,
    base_version_uuid: str,
) -> tuple[DeliverableAccess, DeliverableEditLease]:
    access = get_visible_deliverable(db, deliverable_uuid=deliverable_uuid, actor_user_id=actor_user_id, lock=True)
    _require_deliverable_write_access(access)
    current_version = _current_version(db, access)
    _assert_revision(access, row_version=row_version, base_version_uuid=base_version_uuid, current_version=current_version)
    now = _utc_now()
    lease = db.scalar(select(DeliverableEditLease).where(DeliverableEditLease.deliverable_id == access.artifact.id))
    if lease is not None and lease.status == "active" and lease.expires_at > now and lease.owner_user_id != actor_user_id:
        raise ProfessionalDeliveryError(
            "DELIVERABLE_EDIT_LEASE_CONFLICT",
            "成果正在被其他用户编辑",
            409,
            {"owner_user_id": lease.owner_user_id, "expires_at": lease.expires_at.isoformat()},
        )
    if lease is None:
        lease = DeliverableEditLease(
            uuid=str(uuid_lib.uuid4()),
            deliverable_id=access.artifact.id,
            owner_user_id=actor_user_id,
            fencing_token=1,
            expires_at=now + LEASE_TTL,
            status="active",
        )
        db.add(lease)
    else:
        lease.owner_user_id = actor_user_id
        lease.fencing_token += 1
        lease.expires_at = now + LEASE_TTL
        lease.status = "active"
    db.flush()
    return access, lease


def heartbeat_lease(
    db: Session,
    *,
    deliverable_uuid: str,
    actor_user_id: str,
    fencing_token: int,
) -> tuple[DeliverableAccess, DeliverableEditLease]:
    access = get_visible_deliverable(db, deliverable_uuid=deliverable_uuid, actor_user_id=actor_user_id, lock=True)
    lease = db.scalar(select(DeliverableEditLease).where(DeliverableEditLease.deliverable_id == access.artifact.id))
    if lease is None or lease.owner_user_id != actor_user_id or lease.fencing_token != fencing_token or lease.expires_at <= _utc_now():
        raise ProfessionalDeliveryError("DELIVERABLE_EDIT_LEASE_EXPIRED", "编辑租约已过期，请重新获取编辑权", 409)
    lease.expires_at = _utc_now() + LEASE_TTL
    db.flush()
    return access, lease


def release_lease(db: Session, *, deliverable_uuid: str, actor_user_id: str, fencing_token: int) -> DeliverableAccess:
    access = get_visible_deliverable(db, deliverable_uuid=deliverable_uuid, actor_user_id=actor_user_id, lock=True)
    lease = db.scalar(select(DeliverableEditLease).where(DeliverableEditLease.deliverable_id == access.artifact.id))
    if lease is None or lease.owner_user_id != actor_user_id or lease.fencing_token != fencing_token:
        raise ProfessionalDeliveryError("DELIVERABLE_EDIT_LEASE_EXPIRED", "编辑租约已过期，请重新获取编辑权", 409)
    lease.status = "released"
    db.flush()
    return access


def commit_draft(
    db: Session,
    *,
    deliverable_uuid: str,
    body: DeliverableCommitIn,
    actor_user_id: str,
    idempotency_key: str,
    cipher: ContentCipher,
    key_version: str,
) -> tuple[DeliverableAccess, DeliverableVersionCreateResult]:
    access, draft = get_or_create_draft(
        db,
        deliverable_uuid=deliverable_uuid,
        actor_user_id=actor_user_id,
        cipher=cipher,
        key_version=key_version,
    )
    current_version = _current_version(db, access)
    _assert_revision(access, row_version=body.row_version, base_version_uuid=body.base_version_uuid, current_version=current_version)
    if draft.revision != body.draft_revision:
        raise ProfessionalDeliveryError("DELIVERABLE_DRAFT_CONFLICT", "草稿版本已变化，请刷新后提交", 409)
    lease = _active_lease(db, deliverable_id=access.artifact.id, actor_user_id=actor_user_id)
    _require_fencing_token(lease, body.fencing_token)
    content = draft_content(draft, cipher=cipher)
    result = create_deliverable_version(
        db,
        deliverable_uuid=deliverable_uuid,
        body=DeliverableVersionCreateIn(
            row_version=body.row_version,
            parent_version_uuid=body.base_version_uuid,
            content=content,
            content_summary=draft.content_summary,
            change_summary=body.change_summary,
            creation_reason=body.creation_reason,
        ),
        actor_user_id=actor_user_id,
        idempotency_key=idempotency_key,
        cipher=cipher,
        key_version=key_version,
    )
    # Keep one active draft row per deliverable, rebased to the newly created
    # immutable version so the next edit starts at revision zero.
    draft.base_version_id = result.version.id
    draft.revision = 0
    draft.status = "active"
    if lease is not None:
        lease.status = "released"
    db.flush()
    return access, result
