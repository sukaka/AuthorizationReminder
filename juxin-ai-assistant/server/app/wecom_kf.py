"""WeCom customer-service (微信客服) API client and message normalization."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx

from .config import Settings


@dataclass(frozen=True)
class WecomKfMessage:
    message_id: str
    open_kfid: str
    external_user_id: str
    text: str
    send_time: int = 0


class WecomKfClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._token = ""
        self._token_expires = 0.0

    def _access_token(self) -> str:
        if self._token and time.time() < self._token_expires:
            return self._token
        with httpx.Client(timeout=10.0) as client:
            response = client.get(
                "https://qyapi.weixin.qq.com/cgi-bin/gettoken",
                params={
                    "corpid": self.settings.wecom_kf_corp_id,
                    "corpsecret": self.settings.wecom_kf_secret,
                },
            )
        response.raise_for_status()
        payload = response.json()
        if int(payload.get("errcode") or 0) != 0 or not payload.get("access_token"):
            raise RuntimeError("wecom_kf_access_token_failed")
        self._token = str(payload["access_token"])
        self._token_expires = time.time() + max(60, int(payload.get("expires_in") or 7200) - 120)
        return self._token

    def sync_messages(self, *, callback_token: str, open_kfid: str, cursor: str = "") -> tuple[list[WecomKfMessage], str]:
        body: dict[str, Any] = {"token": callback_token, "open_kfid": open_kfid, "limit": 1000}
        if cursor:
            body["cursor"] = cursor
        with httpx.Client(timeout=10.0) as client:
            response = client.post(
                "https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg",
                params={"access_token": self._access_token()},
                json=body,
            )
        response.raise_for_status()
        payload = response.json()
        if int(payload.get("errcode") or 0) != 0:
            raise RuntimeError("wecom_kf_sync_failed")
        return normalize_sync_messages(payload, open_kfid=open_kfid), str(payload.get("next_cursor") or "")

    def send_text(self, *, open_kfid: str, external_user_id: str, text: str) -> None:
        body = {
            "touser": external_user_id,
            "open_kfid": open_kfid,
            "msgtype": "text",
            "text": {"content": text[:2048]},
        }
        with httpx.Client(timeout=10.0) as client:
            response = client.post(
                "https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg",
                params={"access_token": self._access_token()},
                json=body,
            )
        response.raise_for_status()
        payload = response.json()
        if int(payload.get("errcode") or 0) != 0:
            raise RuntimeError("wecom_kf_send_failed")


def normalize_sync_messages(payload: dict[str, Any], *, open_kfid: str) -> list[WecomKfMessage]:
    """Keep only customer-originated text messages from a sync response."""
    result: list[WecomKfMessage] = []
    for raw in payload.get("msg_list") or []:
        if not isinstance(raw, dict) or str(raw.get("msgtype") or "") != "text":
            continue
        if str(raw.get("origin") or "").lower() not in {"customer", ""}:
            continue
        text = str((raw.get("text") or {}).get("content") or "").strip()
        user_id = str(raw.get("external_userid") or "").strip()
        message_id = str(raw.get("msgid") or "").strip()
        if text and user_id and message_id:
            result.append(WecomKfMessage(
                message_id=message_id,
                open_kfid=str(raw.get("open_kfid") or open_kfid),
                external_user_id=user_id,
                text=text,
                send_time=int(raw.get("send_time") or 0),
            ))
    return result
