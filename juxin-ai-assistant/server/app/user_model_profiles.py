from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings
from .crypto import ContentCipher, EncryptedPayload
from .models import UserModelProfile
from .model_endpoint_security import validate_user_model_endpoint
from .schemas import UserModelProfileOut, UserModelProfileUpsertIn


def user_model_profile_out(profile: UserModelProfile) -> UserModelProfileOut:
    return UserModelProfileOut(
        uuid=profile.uuid,
        display_name=profile.display_name,
        base_url=profile.base_url,
        model_id=profile.model_id,
        temperature=float(profile.temperature),
        max_output_tokens=profile.max_output_tokens,
        timeout_seconds=profile.timeout_seconds,
        is_default=profile.is_default,
        has_api_key=bool(profile.api_key_ciphertext and profile.api_key_nonce),
        status=profile.status,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


def list_user_model_profiles(db: Session, user_id: str) -> list[UserModelProfile]:
    return list(db.scalars(
        select(UserModelProfile)
        .where(
            UserModelProfile.sso_user_id == user_id,
            UserModelProfile.status == "ACTIVE",
        )
        .order_by(UserModelProfile.is_default.desc(), UserModelProfile.updated_at.desc())
    ))


def get_user_model_profile(db: Session, user_id: str, profile_uuid: str) -> UserModelProfile:
    profile = db.scalar(
        select(UserModelProfile).where(
            UserModelProfile.uuid == profile_uuid,
            UserModelProfile.sso_user_id == user_id,
            UserModelProfile.status == "ACTIVE",
        )
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="MODEL_PROFILE_NOT_FOUND")
    return profile


def get_default_user_model_profile(db: Session, user_id: str) -> UserModelProfile | None:
    return db.scalar(
        select(UserModelProfile)
        .where(
            UserModelProfile.sso_user_id == user_id,
            UserModelProfile.status == "ACTIVE",
            UserModelProfile.is_default.is_(True),
        )
        .order_by(UserModelProfile.updated_at.desc())
    )


def decrypt_user_model_api_key(cipher: ContentCipher, profile: UserModelProfile) -> str:
    payload = cipher.decrypt_json(
        EncryptedPayload(profile.api_key_ciphertext, profile.api_key_nonce),
        profile.uuid.encode(),
    )
    api_key = str(payload.get("api_key") or "").strip()
    if not api_key:
        raise HTTPException(status_code=409, detail="MODEL_API_KEY_MISSING")
    return api_key


def _encrypted_api_key(
    cipher: ContentCipher,
    profile_uuid: str,
    api_key: str,
) -> tuple[bytes, bytes]:
    encrypted = cipher.encrypt_json({"api_key": api_key}, profile_uuid.encode())
    return encrypted.ciphertext, encrypted.nonce


def _clear_default(db: Session, user_id: str) -> None:
    for profile in db.scalars(
        select(UserModelProfile).where(
            UserModelProfile.sso_user_id == user_id,
            UserModelProfile.status == "ACTIVE",
            UserModelProfile.is_default.is_(True),
        )
    ):
        profile.is_default = False


def create_user_model_profile(
    db: Session,
    *,
    user_id: str,
    body: UserModelProfileUpsertIn,
    cipher: ContentCipher,
    settings: Settings,
) -> UserModelProfile:
    if not body.api_key:
        raise HTTPException(status_code=422, detail="MODEL_API_KEY_REQUIRED")
    base_url = validate_user_model_endpoint(body.base_url, settings)
    if body.is_default or not list_user_model_profiles(db, user_id):
        _clear_default(db, user_id)
        is_default = True
    else:
        is_default = False
    profile = UserModelProfile(
        sso_user_id=user_id,
        display_name=body.display_name,
        base_url=base_url,
        model_id=body.model_id,
        temperature=body.temperature,
        max_output_tokens=body.max_output_tokens,
        timeout_seconds=body.timeout_seconds,
        is_default=is_default,
        api_key_ciphertext=b"",
        api_key_nonce=b"",
        key_version=settings.content_encryption_key_version,
        status="ACTIVE",
    )
    db.add(profile)
    db.flush()
    ciphertext, nonce = _encrypted_api_key(cipher, profile.uuid, body.api_key)
    profile.api_key_ciphertext = ciphertext
    profile.api_key_nonce = nonce
    return profile


def update_user_model_profile(
    db: Session,
    *,
    user_id: str,
    profile_uuid: str,
    body: UserModelProfileUpsertIn,
    cipher: ContentCipher,
    settings: Settings,
) -> UserModelProfile:
    profile = get_user_model_profile(db, user_id, profile_uuid)
    base_url = validate_user_model_endpoint(body.base_url, settings)
    if body.is_default:
        _clear_default(db, user_id)
        profile.is_default = True
    profile.display_name = body.display_name
    profile.base_url = base_url
    profile.model_id = body.model_id
    profile.temperature = body.temperature
    profile.max_output_tokens = body.max_output_tokens
    profile.timeout_seconds = body.timeout_seconds
    profile.key_version = settings.content_encryption_key_version
    if body.api_key:
        ciphertext, nonce = _encrypted_api_key(cipher, profile.uuid, body.api_key)
        profile.api_key_ciphertext = ciphertext
        profile.api_key_nonce = nonce
    return profile


def set_default_user_model_profile(
    db: Session,
    *,
    user_id: str,
    profile_uuid: str,
) -> UserModelProfile:
    profile = get_user_model_profile(db, user_id, profile_uuid)
    _clear_default(db, user_id)
    profile.is_default = True
    return profile


def delete_user_model_profile(db: Session, *, user_id: str, profile_uuid: str) -> None:
    profile = get_user_model_profile(db, user_id, profile_uuid)
    was_default = profile.is_default
    profile.status = "DELETED"
    profile.is_default = False
    if was_default:
        replacement = db.scalar(
            select(UserModelProfile)
            .where(
                UserModelProfile.sso_user_id == user_id,
                UserModelProfile.status == "ACTIVE",
                UserModelProfile.uuid != profile_uuid,
            )
            .order_by(UserModelProfile.updated_at.desc())
        )
        if replacement is not None:
            replacement.is_default = True
