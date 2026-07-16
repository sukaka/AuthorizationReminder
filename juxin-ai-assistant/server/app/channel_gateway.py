"""7.0 Channel Gateway skeleton: normalize inbound messages from multiple channels.

Web/desktop remain primary; Feishu/WeCom adapters are stubs until credentials land.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True)
class ChannelMessage:
    channel: str  # web | desktop | feishu | wecom | api
    external_user_id: str
    text: str
    thread_id: str = ""
    raw: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ChannelReply:
    text: str
    cards: list[dict[str, Any]] = field(default_factory=list)
    artifacts: list[dict[str, Any]] = field(default_factory=list)


class ChannelAdapter(Protocol):
    name: str

    def parse_inbound(self, payload: dict[str, Any]) -> ChannelMessage | None: ...

    def format_outbound(self, reply: ChannelReply) -> dict[str, Any]: ...


class WebChannelAdapter:
    name = "web"

    def parse_inbound(self, payload: dict[str, Any]) -> ChannelMessage | None:
        text = str(payload.get("text") or payload.get("input_text") or "").strip()
        if not text:
            return None
        return ChannelMessage(
            channel=self.name,
            external_user_id=str(payload.get("user_id") or payload.get("sso_user_id") or ""),
            text=text,
            thread_id=str(payload.get("conversation_id") or payload.get("thread_id") or ""),
            raw=payload,
        )

    def format_outbound(self, reply: ChannelReply) -> dict[str, Any]:
        return {
            "channel": self.name,
            "text": reply.text,
            "cards": reply.cards,
            "artifacts": reply.artifacts,
        }


class DesktopChannelAdapter(WebChannelAdapter):
    name = "desktop"


class FeishuChannelAdapter:
    """Stub: expects Feishu event v2 shape; no network I/O here."""

    name = "feishu"

    def parse_inbound(self, payload: dict[str, Any]) -> ChannelMessage | None:
        event = payload.get("event") if isinstance(payload.get("event"), dict) else payload
        if not isinstance(event, dict):
            return None
        # Ignore non-message events
        event_type = str(
            payload.get("header", {}).get("event_type")
            if isinstance(payload.get("header"), dict)
            else event.get("type") or ""
        )
        if event_type and event_type not in {
            "im.message.receive_v1",
            "message",
            "im.message.receive_v1.event",
            "",
        }:
            # allow empty for simplified test payloads
            if "message" not in event and "message" not in str(event_type):
                return None
        message = event.get("message") if isinstance(event.get("message"), dict) else None
        if not isinstance(message, dict):
            return None
        msg_type = str(message.get("message_type") or message.get("msg_type") or "text")
        if msg_type not in {"text", "post", ""}:
            return None
        # Skip bot/self messages when sender type is app
        sender = event.get("sender") if isinstance(event.get("sender"), dict) else {}
        sender_type = str(sender.get("sender_type") or "")
        if sender_type.lower() in {"app", "bot"}:
            return None
        content = message.get("content") or ""
        text = ""
        if isinstance(content, str):
            # Feishu often sends JSON string {"text":"..."}
            if content.startswith("{") and "text" in content:
                try:
                    import json

                    text = str(json.loads(content).get("text") or "")
                except Exception:
                    text = content
            else:
                text = content
        text = text.strip()
        if not text:
            return None
        sender_id = ""
        if isinstance(sender, dict):
            sid = sender.get("sender_id") or {}
            if isinstance(sid, dict):
                sender_id = str(sid.get("open_id") or sid.get("user_id") or "")
        return ChannelMessage(
            channel=self.name,
            external_user_id=sender_id,
            text=text,
            thread_id=str(message.get("chat_id") or ""),
            raw=payload,
            metadata={
                "message_id": message.get("message_id"),
                "message_type": msg_type,
                "event_type": event_type,
            },
        )

    def format_outbound(self, reply: ChannelReply) -> dict[str, Any]:
        return {
            "msg_type": "text",
            "content": {"text": reply.text},
            "channel": self.name,
        }


class WecomChannelAdapter:
    """Stub for WeCom (企业微信) inbound XML/JSON normalization."""

    name = "wecom"

    def parse_inbound(self, payload: dict[str, Any]) -> ChannelMessage | None:
        text = str(payload.get("Content") or payload.get("text") or "").strip()
        if not text:
            return None
        return ChannelMessage(
            channel=self.name,
            external_user_id=str(payload.get("FromUserName") or payload.get("user_id") or ""),
            text=text,
            thread_id=str(payload.get("AgentID") or payload.get("thread_id") or ""),
            raw=payload,
        )

    def format_outbound(self, reply: ChannelReply) -> dict[str, Any]:
        return {
            "msgtype": "text",
            "text": {"content": reply.text},
            "channel": self.name,
        }


class ChannelGateway:
    def __init__(self, adapters: list[ChannelAdapter] | None = None) -> None:
        self._adapters: dict[str, ChannelAdapter] = {}
        for adapter in adapters or [
            WebChannelAdapter(),
            DesktopChannelAdapter(),
            FeishuChannelAdapter(),
            WecomChannelAdapter(),
        ]:
            self._adapters[adapter.name] = adapter

    def list_channels(self) -> list[str]:
        return sorted(self._adapters)

    def get(self, channel: str) -> ChannelAdapter | None:
        return self._adapters.get((channel or "").strip().lower())

    def normalize(self, channel: str, payload: dict[str, Any]) -> ChannelMessage | None:
        adapter = self.get(channel)
        if adapter is None:
            return None
        return adapter.parse_inbound(payload or {})

    def render(self, channel: str, reply: ChannelReply) -> dict[str, Any]:
        adapter = self.get(channel) or WebChannelAdapter()
        return adapter.format_outbound(reply)


_default_gateway: ChannelGateway | None = None


def get_channel_gateway() -> ChannelGateway:
    global _default_gateway
    if _default_gateway is None:
        _default_gateway = ChannelGateway()
    return _default_gateway
