from __future__ import annotations

import base64
from datetime import UTC, datetime, timedelta
import hashlib
import hmac
import json
import secrets
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException, Request

from .models import WechatExternalVisitor

COOKIE_NAME = "juxin_wechat_external"


def openid_hash(openid: str, salt: str) -> str:
    return hmac.new(salt.encode(), openid.encode(), hashlib.sha256).hexdigest()


def _sign(payload: dict, secret: str) -> str:
    encoded = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    signature = hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).hexdigest()
    return f"{encoded}.{signature}"


def issue_session(visitor_uuid: str, secret: str) -> str:
    now = datetime.now(UTC)
    return _sign({"v": visitor_uuid, "sid": secrets.token_urlsafe(16), "iat": int(now.timestamp()), "exp": int((now + timedelta(hours=8)).timestamp())}, secret)


def read_session(request: Request, secret: str) -> str:
    raw = request.cookies.get(COOKIE_NAME, "")
    encoded, dot, signature = raw.partition(".")
    expected = hmac.new(secret.encode(), encoded.encode(), hashlib.sha256).hexdigest()
    if not dot or not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=401, detail="EXTERNAL_SESSION_INVALID")
    try:
        payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        if int(payload["exp"]) < int(datetime.now(UTC).timestamp()):
            raise ValueError
        return str(payload["v"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=401, detail="EXTERNAL_SESSION_INVALID") from exc


def safe_return_to(raw: str) -> str:
    return raw if raw.startswith("/") and not raw.startswith("//") and "\\" not in raw else "/"


def consume_state(client, key: str) -> str | None:
    try:
        pipe = client.pipeline()
        pipe.get(key)
        pipe.delete(key)
        value, _ = pipe.execute()
        return str(value) if value else None
    except Exception as exc:
        raise HTTPException(status_code=503, detail="EXTERNAL_QUOTA_UNAVAILABLE") from exc


async def exchange_code(*, code: str, app_id: str, app_secret: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get("https://api.weixin.qq.com/sns/oauth2/access_token", params={"appid": app_id, "secret": app_secret, "code": code, "grant_type": "authorization_code"})
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="WECHAT_OAUTH_FAILED") from exc
    value = payload.get("openid") if isinstance(payload, dict) else None
    if not isinstance(value, str) or not value:
        raise HTTPException(status_code=502, detail="WECHAT_OAUTH_FAILED")
    return value


def upsert_visitor(db, *, hashed_openid: str) -> WechatExternalVisitor:
    visitor = db.query(WechatExternalVisitor).filter_by(openid_hash=hashed_openid).one_or_none()
    now = datetime.now(UTC)
    if visitor is None:
        visitor = WechatExternalVisitor(openid_hash=hashed_openid, first_seen_at=now, last_seen_at=now)
        db.add(visitor)
    else:
        visitor.last_seen_at = now
    db.commit()
    db.refresh(visitor)
    return visitor
