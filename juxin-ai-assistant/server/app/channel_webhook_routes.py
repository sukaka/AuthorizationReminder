"""Inbound channel webhooks for Feishu / WeCom (7.0).

Supports encrypt decrypt, bot/message filtering, sync or async Run.
"""

from __future__ import annotations

import hashlib
import time
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .channel_gateway import ChannelReply, get_channel_gateway
from .channel_queue import channel_dispatcher
from .channel_run_bridge import process_channel_message
from .config import Settings, get_settings
from .crypto import ContentCipher
from .database import get_db
from .feature_flags import load_feature_flags
from .external_question_events import record_external_question
from .external_answer_safety import MAX_EXTERNAL_QUESTION_CHARS, prepare_external_answer
from .feishu_crypto import decrypt_feishu_payload

router = APIRouter(prefix="/api/ai/channels/webhooks", tags=["channel-webhooks"])


class WebhookAck(BaseModel):
    ok: bool
    channel: str
    action: str = "received"
    text: str = ""
    external_user_id: str = ""
    challenge: str | None = None
    detail: str = ""
    run_id: str = ""
    answer_preview: str = ""
    outbound_mode: str = ""
    job_key: str = ""


def _channel_enabled(settings: Settings, channel: str) -> bool:
    flags = load_feature_flags(settings)
    channels = flags.get("channels") or {}
    if isinstance(channels, dict) and channel in channels:
        return bool(channels[channel])
    return bool(getattr(settings, f"{channel}_channel_enabled", False))


def _async_enabled(settings: Settings) -> bool:
    flags = load_feature_flags(settings)
    if "channel_async_run" in flags:
        return bool(flags.get("channel_async_run"))
    return bool(getattr(settings, "channel_async_run", False))


def _cipher(settings: Settings):
    try:
        return ContentCipher(settings.content_encryption_key)
    except Exception:
        return None


async def _answer_wecom_kf_message(*, message, client, settings: Settings, db: Session) -> None:
    from .context.context_builder import ContextBuilder
    from .knowledge_embedding import build_embedding_service
    from .knowledge_search import search_knowledge_chunks
    from .models import ExternalQuestionEvent
    from .external_support_tickets import create_handoff_ticket, notify_assignees
    from .server_model_client import generate_with_server_model
    from .wechat_external_auth import openid_hash
    from .wechat_external_quota import WechatExternalQuota

    cipher = ContentCipher(settings.content_encryption_key)
    identity_hash = openid_hash(message.external_user_id, settings.wecom_kf_identity_hash_salt)
    existing = db.scalar(select(ExternalQuestionEvent.id).where(
        ExternalQuestionEvent.source_channel == "wecom_kf",
        ExternalQuestionEvent.external_message_id == message.message_id,
    ))
    if existing is not None:
        return
    question = " ".join(message.text.split())
    if len(question) > MAX_EXTERNAL_QUESTION_CHARS:
        client.send_text(
            open_kfid=message.open_kfid,
            external_user_id=message.external_user_id,
            text=f"单次问题请控制在 {MAX_EXTERNAL_QUESTION_CHARS} 个字符以内。",
        )
        return
    quota = WechatExternalQuota.from_settings(settings)
    reservation = quota.reserve(identity_hash)
    event = record_external_question(
        db,
        cipher=cipher,
        source_channel="wecom_kf",
        external_identity_hash=identity_hash,
        conversation_key=message.open_kfid,
        external_message_id=message.message_id,
        question=question,
    )
    db.commit()
    try:
        chunks = search_knowledge_chunks(
            db, sso_user_id="wecom-kf", query=question, cipher=cipher, top_k=8,
            embedding_service=build_embedding_service(db, settings), track_usage=False,
            external_public_only=True,
        )
        if not chunks:
            quota.refund(identity_hash, reservation)
            ticket = create_handoff_ticket(
                db, cipher=cipher, event=event, reason_code="NO_EVIDENCE",
                external_recipient_id=message.external_user_id,
            )
            db.commit()
            notify_assignees(settings=settings, ticket=ticket)
            client.send_text(open_kfid=message.open_kfid, external_user_id=message.external_user_id, text="当前公开资料中未找到明确依据，已转交人工处理。")
            return
        messages = ContextBuilder().build_messages(
            mode="knowledge", current_user_message=question, knowledge_chunks=chunks,
            personal_reference_chunks=[], recent_messages=[], require_knowledge_evidence=True,
            external_customer=True,
        )
        result = await generate_with_server_model(
            settings, messages, 0.2,
            max_output_tokens=settings.wechat_external_model_max_output_tokens,
        )
        answer = prepare_external_answer(
            result.output,
            source_file_names=[chunk.file_name for chunk in chunks],
        )
        if answer is None:
            quota.refund(identity_hash, reservation)
            ticket = create_handoff_ticket(
                db, cipher=cipher, event=event, reason_code="UNSAFE_MODEL_OUTPUT",
                external_recipient_id=message.external_user_id,
            )
            db.commit()
            notify_assignees(settings=settings, ticket=ticket)
            client.send_text(open_kfid=message.open_kfid, external_user_id=message.external_user_id, text="当前无法安全地根据公开资料生成回复，已转交人工处理。")
            return
        source_file_ids = [chunk.file_uuid for chunk in chunks]
        event.status = "ANSWERED"
        event.source_file_ids_json = source_file_ids
        event.completed_at = time_to_datetime()
        db.commit()
        download_hint = ""
        if settings.wechat_external_h5_origin:
            download_hint = f"\n\n公开资料下载：{settings.wechat_external_h5_origin.rstrip('/')}/documents"
        client.send_text(open_kfid=message.open_kfid, external_user_id=message.external_user_id, text=answer + download_hint)
    except Exception:
        quota.refund(identity_hash, reservation)
        event.status = "FAILED"
        event.completed_at = time_to_datetime()
        db.commit()
        raise


def time_to_datetime():
    from datetime import UTC, datetime

    return datetime.now(UTC)


def _handle_channel_message(
    *,
    channel: str,
    msg,
    settings: Settings,
    db: Session,
) -> WebhookAck:
    if _async_enabled(settings):
        # Fire-and-forget: do not block webhook response
        job_key = channel_dispatcher.enqueue_message(msg)
        return WebhookAck(
            ok=True,
            channel=channel,
            action="queued",
            text=msg.text,
            external_user_id=msg.external_user_id,
            detail="async",
            job_key=job_key,
        )

    outcome = process_channel_message(
        db,
        settings,
        msg,
        cipher=_cipher(settings),
        execute=True,
        send_outbound=True,
    )
    db.commit()
    return WebhookAck(
        ok=True,
        channel=channel,
        action="run_completed" if not outcome.deduped else "deduped",
        text=msg.text,
        external_user_id=msg.external_user_id,
        detail=outcome.status,
        run_id=outcome.run_id,
        answer_preview=(outcome.answer or "")[:240],
        outbound_mode=(outcome.outbound.mode if outcome.outbound else ""),
    )


@router.post("/feishu", response_model=WebhookAck)
async def feishu_webhook(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> WebhookAck:
    if not _channel_enabled(settings, "feishu"):
        raise HTTPException(status_code=503, detail="feishu_channel_disabled")
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid_json") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="invalid_payload")

    # Decrypt encrypted envelope when present
    encrypt_key = str(getattr(settings, "feishu_encrypt_key", "") or "")
    if payload.get("encrypt"):
        try:
            payload = decrypt_feishu_payload(encrypt_key, payload)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"decrypt_failed:{exc}") from exc

    # Feishu URL verification (plain or after decrypt)
    if payload.get("type") == "url_verification" or (
        "challenge" in payload and not payload.get("event") and payload.get("type") != "event_callback"
    ):
        challenge = str(payload.get("challenge") or "")
        return WebhookAck(
            ok=True,
            channel="feishu",
            action="url_verification",
            challenge=challenge,
        )

    verify_token = str(getattr(settings, "feishu_verification_token", "") or "")
    if verify_token:
        header = payload.get("header") if isinstance(payload.get("header"), dict) else {}
        token = str(payload.get("token") or header.get("token") or "")
        if token and token != verify_token:
            raise HTTPException(status_code=401, detail="invalid_token")

    gw = get_channel_gateway()
    msg = gw.normalize("feishu", payload)
    if msg is None:
        return WebhookAck(ok=False, channel="feishu", action="ignored", detail="parse_failed_or_filtered")

    return _handle_channel_message(channel="feishu", msg=msg, settings=settings, db=db)


def _wecom_query_sig(request: Request) -> tuple[str, str, str, str]:
    qp = request.query_params
    return (
        qp.get("msg_signature") or qp.get("signature") or "",
        qp.get("timestamp") or "",
        qp.get("nonce") or "",
        qp.get("echostr") or "",
    )


@router.get("/wecom")
async def wecom_url_verify(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Any:
    """WeCom URL verification (GET echostr)."""
    if not _channel_enabled(settings, "wecom"):
        raise HTTPException(status_code=503, detail="wecom_channel_disabled")
    msg_signature, timestamp, nonce, echostr = _wecom_query_sig(request)
    if not echostr:
        raise HTTPException(status_code=400, detail="missing_echostr")
    token = str(getattr(settings, "wecom_token", "") or "")
    encoding_key = str(getattr(settings, "wecom_encoding_aes_key", "") or "")
    corp_id = str(getattr(settings, "wecom_corp_id", "") or "")
    # Encrypted mode: echostr is ciphertext
    if encoding_key and token:
        from .wecom_crypto import decrypt_wecom_message, verify_wecom_signature

        if not msg_signature or not timestamp or not nonce:
            raise HTTPException(status_code=401, detail="missing_signature")
        if not verify_wecom_signature(
            token=token,
            timestamp=timestamp,
            nonce=nonce,
            encrypt=echostr,
            msg_signature=msg_signature,
        ):
            raise HTTPException(status_code=401, detail="bad_signature")
        try:
            plain = decrypt_wecom_message(
                encoding_aes_key=encoding_key,
                corp_id=corp_id,
                encrypt_b64=echostr,
            )
            from fastapi.responses import PlainTextResponse

            return PlainTextResponse(plain)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"decrypt_failed:{exc}") from exc
    # Plain mode
    if token and msg_signature:
        items = sorted([token, timestamp, nonce, echostr])
        digest = hashlib.sha1("".join(items).encode("utf-8")).hexdigest()
        if digest != msg_signature:
            raise HTTPException(status_code=401, detail="bad_signature")
    from fastapi.responses import PlainTextResponse

    return PlainTextResponse(echostr)


@router.post("/wecom", response_model=WebhookAck)
async def wecom_webhook(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    msg_signature: Annotated[str | None, Header(alias="msg_signature")] = None,
    timestamp: Annotated[str | None, Header()] = None,
    nonce: Annotated[str | None, Header()] = None,
) -> WebhookAck | dict[str, Any]:
    if not _channel_enabled(settings, "wecom"):
        raise HTTPException(status_code=503, detail="wecom_channel_disabled")

    # Prefer query string signatures (WeCom standard)
    q_sig, q_ts, q_nonce, echostr = _wecom_query_sig(request)
    msg_signature = q_sig or msg_signature or ""
    timestamp = q_ts or timestamp or ""
    nonce = q_nonce or nonce or ""
    if echostr and request.method == "POST":
        # some gateways still POST verify
        return await wecom_url_verify(request, settings)  # type: ignore[return-value]

    content_type = (request.headers.get("content-type") or "").lower()
    raw_body = (await request.body()).decode("utf-8", errors="replace")
    token = str(getattr(settings, "wecom_token", "") or "")
    encoding_key = str(getattr(settings, "wecom_encoding_aes_key", "") or "")
    corp_id = str(getattr(settings, "wecom_corp_id", "") or "")

    try:
        if encoding_key or "Encrypt" in raw_body or "encrypt" in raw_body:
            from .wecom_crypto import extract_wecom_inbound

            payload = extract_wecom_inbound(
                body=raw_body if raw_body else "{}",
                content_type=content_type or "application/xml",
                token=token,
                encoding_aes_key=encoding_key,
                corp_id=corp_id,
                msg_signature=msg_signature,
                timestamp=timestamp,
                nonce=nonce,
            )
        elif "json" in content_type:
            import json

            payload = json.loads(raw_body or "{}")
            if not isinstance(payload, dict):
                raise HTTPException(status_code=400, detail="invalid_payload")
        else:
            import re

            def _tag(name: str) -> str:
                m = re.search(rf"<{name}><!\[CDATA\[(.*?)\]\]></{name}>", raw_body) or re.search(
                    rf"<{name}>(.*?)</{name}>", raw_body
                )
                return m.group(1) if m else ""

            payload = {
                "Content": _tag("Content"),
                "FromUserName": _tag("FromUserName"),
                "AgentID": _tag("AgentID"),
                "MsgType": _tag("MsgType"),
            }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"wecom_parse_failed:{exc}") from exc

    gw = get_channel_gateway()
    msg = gw.normalize("wecom", payload)
    if msg is None:
        return WebhookAck(ok=False, channel="wecom", action="ignored", detail="parse_failed")

    return _handle_channel_message(channel="wecom", msg=msg, settings=settings, db=db)


@router.post("/wecom-kf")
async def wecom_kf_webhook(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> dict[str, Any]:
    """Receive a WeCom customer-service callback and consume its synced messages."""
    if not settings.wecom_kf_enabled or not _channel_enabled(settings, "wecom_kf"):
        raise HTTPException(status_code=503, detail="wecom_kf_channel_disabled")
    from .wecom_crypto import extract_wecom_inbound

    try:
        raw_body = (await request.body()).decode("utf-8", errors="replace")
        payload = extract_wecom_inbound(
            body=raw_body or "{}",
            content_type=request.headers.get("content-type") or "application/json",
            token=settings.wecom_kf_token,
            encoding_aes_key=settings.wecom_kf_encoding_aes_key,
            corp_id=settings.wecom_kf_corp_id,
            msg_signature=request.query_params.get("msg_signature") or "",
            timestamp=request.query_params.get("timestamp") or "",
            nonce=request.query_params.get("nonce") or "",
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail="wecom_kf_callback_invalid") from exc
    callback_token = str(payload.get("token") or payload.get("Token") or "").strip()
    open_kfid = str(payload.get("open_kfid") or payload.get("OpenKfId") or "").strip()
    if not callback_token or not open_kfid:
        raise HTTPException(status_code=400, detail="missing_wecom_kf_callback_fields")
    from .wecom_kf import WecomKfClient

    client = WecomKfClient(settings)
    messages, _next_cursor = client.sync_messages(
        callback_token=callback_token,
        open_kfid=open_kfid,
        cursor=str(payload.get("cursor") or ""),
    )
    processed = 0
    for message in messages:
        await _answer_wecom_kf_message(message=message, client=client, settings=settings, db=db)
        processed += 1
    return {"ok": True, "channel": "wecom_kf", "processed": processed}


@router.post("/echo")
async def channel_echo(
    body: dict[str, Any],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    """Dev helper: normalize + render without external network."""
    channel = str(body.get("channel") or "web")
    payload = body.get("payload") if isinstance(body.get("payload"), dict) else body
    gw = get_channel_gateway()
    msg = gw.normalize(channel, payload)
    if msg is None:
        return {"ok": False, "error": "parse_failed"}
    reply = ChannelReply(text=f"收到：{msg.text}")
    return {
        "ok": True,
        "inbound": {
            "channel": msg.channel,
            "external_user_id": msg.external_user_id,
            "text": msg.text,
            "thread_id": msg.thread_id,
        },
        "outbound": gw.render(channel, reply),
        "async_enabled": _async_enabled(settings),
        "pending_jobs": channel_dispatcher.pending_count(),
        "ts": int(time.time()),
    }


@router.get("/queue-status")
async def queue_status(
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    from .channel_job_worker import scheduler_status

    return {
        "async_enabled": _async_enabled(settings),
        "pending": channel_dispatcher.pending_count(),
        "durable": bool(load_feature_flags(settings).get("channel_durable_jobs", True)),
        "worker": scheduler_status(settings),
    }
