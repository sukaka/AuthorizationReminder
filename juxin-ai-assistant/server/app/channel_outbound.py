"""Outbound channel senders (7.0).

Real Feishu/WeCom HTTP is optional; when credentials missing, records to outbox.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import httpx

from .channel_gateway import ChannelReply, get_channel_gateway
from .config import Settings

logger = logging.getLogger(__name__)


@dataclass
class OutboundResult:
    ok: bool
    channel: str
    mode: str  # recorded | http | skipped
    detail: str = ""
    payload: dict[str, Any] = field(default_factory=dict)
    http_status: int | None = None


class OutboundSender(Protocol):
    def send(
        self,
        *,
        reply: ChannelReply,
        external_user_id: str,
        thread_id: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> OutboundResult: ...


def _outbox_path(settings: Settings | None = None) -> Path:
    base = Path(getattr(settings, "knowledge_storage_dir", None) or "./storage")
    base.mkdir(parents=True, exist_ok=True)
    return base / "channel_outbox.jsonl"


def append_outbox(record: dict[str, Any], settings: Settings | None = None) -> None:
    path = _outbox_path(settings)
    line = json.dumps({**record, "ts": int(time.time())}, ensure_ascii=False)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def _egress_gate_text(
    text: str,
    *,
    destination: str,
    metadata: dict[str, Any] | None,
) -> tuple[bool, str, dict[str, Any]]:
    """Apply 7.0 data egress policy before channel send.

    Returns (allowed, text_to_send, decision_dict).
    """
    try:
        from .data_egress import DEST_CHANNEL, decision_to_dict, evaluate_egress

        confirmed = bool((metadata or {}).get("egress_confirmed"))
        decision = evaluate_egress(
            text,
            destination=destination or DEST_CHANNEL,
            confirmed=confirmed,
        )
        payload = decision_to_dict(decision)
        if not decision.allowed:
            return False, text, payload
        send_text = decision.redacted_text if decision.redaction_applied else text
        return True, send_text, payload
    except Exception as exc:
        return True, text, {"egress_error": str(exc)[:200]}


class RecordingOutboundSender:
    """Always-on outbox writer; used as fallback and for tests."""

    def __init__(self, channel: str, settings: Settings | None = None) -> None:
        self.channel = channel
        self.settings = settings

    def send(
        self,
        *,
        reply: ChannelReply,
        external_user_id: str,
        thread_id: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> OutboundResult:
        from .channel_gateway import ChannelReply as CR
        from .data_egress import DEST_CHANNEL

        allowed, send_text, egress = _egress_gate_text(
            reply.text,
            destination=DEST_CHANNEL,
            metadata=metadata,
        )
        if not allowed:
            record = {
                "channel": self.channel,
                "external_user_id": external_user_id,
                "thread_id": thread_id,
                "blocked": True,
                "egress": egress,
                "metadata": metadata or {},
            }
            append_outbox(record, self.settings)
            return OutboundResult(
                ok=False,
                channel=self.channel,
                mode="blocked",
                detail="egress_denied",
                payload={"egress": egress},
            )
        gated_reply = CR(text=send_text, cards=reply.cards, artifacts=reply.artifacts)
        gw = get_channel_gateway()
        payload = gw.render(self.channel, gated_reply)
        record = {
            "channel": self.channel,
            "external_user_id": external_user_id,
            "thread_id": thread_id,
            "payload": payload,
            "egress": egress,
            "metadata": metadata or {},
        }
        append_outbox(record, self.settings)
        return OutboundResult(
            ok=True,
            channel=self.channel,
            mode="recorded",
            detail="written_to_outbox",
            payload=payload,
        )


class FeishuHttpOutboundSender:
    """Send text via Feishu open API when app credentials exist."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._token: str = ""
        self._token_expires: float = 0.0
        self._fallback = RecordingOutboundSender("feishu", settings)

    def _app_id(self) -> str:
        return str(getattr(self.settings, "feishu_app_id", "") or "").strip()

    def _app_secret(self) -> str:
        return str(getattr(self.settings, "feishu_app_secret", "") or "").strip()

    def send(
        self,
        *,
        reply: ChannelReply,
        external_user_id: str,
        thread_id: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> OutboundResult:
        if not self._app_id() or not self._app_secret():
            return self._fallback.send(
                reply=reply,
                external_user_id=external_user_id,
                thread_id=thread_id,
                metadata=metadata,
            )
        from .data_egress import DEST_CHANNEL

        allowed, send_text, egress = _egress_gate_text(
            reply.text, destination=DEST_CHANNEL, metadata=metadata
        )
        if not allowed:
            return OutboundResult(
                ok=False,
                channel="feishu",
                mode="blocked",
                detail="egress_denied",
                payload={"egress": egress},
            )
        try:
            token = self._tenant_access_token()
            receive_id = external_user_id or thread_id
            receive_id_type = "open_id" if external_user_id else "chat_id"
            if thread_id and not external_user_id:
                receive_id = thread_id
                receive_id_type = "chat_id"
            body = {
                "receive_id": receive_id,
                "msg_type": "text",
                "content": json.dumps({"text": send_text}, ensure_ascii=False),
            }
            url = (
                "https://open.feishu.cn/open-apis/im/v1/messages"
                f"?receive_id_type={receive_id_type}"
            )
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json; charset=utf-8",
                    },
                    json=body,
                )
            ok = 200 <= resp.status_code < 300
            result_payload = {
                "request": body,
                "response": _safe_json(resp),
            }
            append_outbox(
                {
                    "channel": "feishu",
                    "mode": "http",
                    "ok": ok,
                    "status": resp.status_code,
                    "external_user_id": external_user_id,
                    "thread_id": thread_id,
                    "payload": result_payload,
                },
                self.settings,
            )
            return OutboundResult(
                ok=ok,
                channel="feishu",
                mode="http",
                detail="feishu_api",
                payload=result_payload,
                http_status=resp.status_code,
            )
        except Exception as exc:
            logger.warning("feishu outbound failed: %s", exc)
            fb = self._fallback.send(
                reply=reply,
                external_user_id=external_user_id,
                thread_id=thread_id,
                metadata={**(metadata or {}), "http_error": str(exc)},
            )
            return OutboundResult(
                ok=False,
                channel="feishu",
                mode="recorded",
                detail=f"http_error:{exc}",
                payload=fb.payload,
            )

    def _tenant_access_token(self) -> str:
        if self._token and time.time() < self._token_expires:
            return self._token
        with httpx.Client(timeout=10.0) as client:
            resp = client.post(
                "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                json={"app_id": self._app_id(), "app_secret": self._app_secret()},
            )
            resp.raise_for_status()
            data = resp.json()
        token = str(data.get("tenant_access_token") or "")
        if not token:
            raise RuntimeError("feishu_token_missing")
        expire = int(data.get("expire") or 7200)
        self._token = token
        self._token_expires = time.time() + max(60, expire - 120)
        return token


class WecomHttpOutboundSender:
    """Send text via WeCom message/send when corp credentials exist."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._fallback = RecordingOutboundSender("wecom", settings)
        self._token: str = ""
        self._token_expires: float = 0.0

    def _corp_id(self) -> str:
        return str(getattr(self.settings, "wecom_corp_id", "") or "").strip()

    def _secret(self) -> str:
        return str(getattr(self.settings, "wecom_secret", "") or "").strip()

    def _agent_id(self) -> str:
        return str(getattr(self.settings, "wecom_agent_id", "") or "").strip()

    def send(
        self,
        *,
        reply: ChannelReply,
        external_user_id: str,
        thread_id: str = "",
        metadata: dict[str, Any] | None = None,
    ) -> OutboundResult:
        if not self._corp_id() or not self._secret():
            return self._fallback.send(
                reply=reply,
                external_user_id=external_user_id,
                thread_id=thread_id,
                metadata=metadata,
            )
        from .data_egress import DEST_CHANNEL

        allowed, send_text, egress = _egress_gate_text(
            reply.text, destination=DEST_CHANNEL, metadata=metadata
        )
        if not allowed:
            return OutboundResult(
                ok=False,
                channel="wecom",
                mode="blocked",
                detail="egress_denied",
                payload={"egress": egress},
            )
        try:
            token = self._access_token()
            agent_id = self._agent_id() or thread_id or "0"
            try:
                agent_id_num: int | str = int(agent_id)
            except ValueError:
                agent_id_num = agent_id
            body = {
                "touser": external_user_id or "@all",
                "msgtype": "text",
                "agentid": agent_id_num,
                "text": {"content": send_text[:2048]},
                "safe": 0,
            }
            url = f"https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token={token}"
            with httpx.Client(timeout=10.0) as client:
                resp = client.post(url, json=body)
            data = _safe_json(resp)
            ok = 200 <= resp.status_code < 300 and int(
                data.get("errcode", 0) if isinstance(data, dict) else -1
            ) == 0
            result_payload = {"request": body, "response": data}
            append_outbox(
                {
                    "channel": "wecom",
                    "mode": "http",
                    "ok": ok,
                    "status": resp.status_code,
                    "external_user_id": external_user_id,
                    "thread_id": thread_id,
                    "payload": result_payload,
                },
                self.settings,
            )
            return OutboundResult(
                ok=ok,
                channel="wecom",
                mode="http",
                detail="wecom_api",
                payload=result_payload,
                http_status=resp.status_code,
            )
        except Exception as exc:
            logger.warning("wecom outbound failed: %s", exc)
            fb = self._fallback.send(
                reply=reply,
                external_user_id=external_user_id,
                thread_id=thread_id,
                metadata={**(metadata or {}), "http_error": str(exc)},
            )
            return OutboundResult(
                ok=False,
                channel="wecom",
                mode="recorded",
                detail=f"http_error:{exc}",
                payload=fb.payload,
            )

    def _access_token(self) -> str:
        if self._token and time.time() < self._token_expires:
            return self._token
        url = (
            "https://qyapi.weixin.qq.com/cgi-bin/gettoken"
            f"?corpid={self._corp_id()}&corpsecret={self._secret()}"
        )
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(url)
            resp.raise_for_status()
            data = resp.json()
        if int(data.get("errcode") or 0) != 0:
            raise RuntimeError(f"wecom_token_error:{data.get('errmsg')}")
        token = str(data.get("access_token") or "")
        if not token:
            raise RuntimeError("wecom_token_missing")
        expire = int(data.get("expires_in") or 7200)
        self._token = token
        self._token_expires = time.time() + max(60, expire - 120)
        return token


def get_outbound_sender(channel: str, settings: Settings) -> OutboundSender:
    ch = (channel or "").strip().lower()
    if ch == "feishu":
        return FeishuHttpOutboundSender(settings)
    if ch == "wecom":
        return WecomHttpOutboundSender(settings)
    return RecordingOutboundSender(ch or "web", settings)


def _safe_json(resp: httpx.Response) -> Any:
    try:
        return resp.json()
    except Exception:
        return {"text": resp.text[:500]}
