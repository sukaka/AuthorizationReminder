"""Bridge channel messages → Agent Run → outbound reply (7.0)."""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .agent_run_service import AgentRunService
from .agent_runtime.langgraph_runtime import select_runtime
from .agent_runtime.protocol import RunRequest
from .channel_gateway import ChannelMessage, ChannelReply
from .channel_outbound import OutboundResult, get_outbound_sender
from .config import Settings
from .crypto import ContentCipher
from .models import AgentRun, ChannelIdentityBinding, ChannelMessageBinding

logger = logging.getLogger(__name__)

CHANNEL_OUTBOUND_RESERVATION_TIMEOUT_SECONDS = 300


@dataclass
class ChannelRunOutcome:
    run_id: str
    owner_user_id: str
    answer: str
    status: str
    outbound: OutboundResult | None = None
    deduped: bool = False
    result: dict[str, Any] | None = None


def channel_owner_id(msg: ChannelMessage) -> str:
    """Map external identity to internal owner namespace."""
    ext = (msg.external_user_id or "anonymous").strip() or "anonymous"
    return f"{msg.channel}:{ext}"[:64]


def channel_message_key(msg: ChannelMessage) -> str:
    mid = str((msg.metadata or {}).get("message_id") or "")
    if mid:
        return f"{msg.channel}:{mid}"[:128]
    digest = hashlib.sha256(
        f"{msg.channel}|{msg.external_user_id}|{msg.thread_id}|{msg.text}".encode("utf-8")
    ).hexdigest()[:24]
    return f"{msg.channel}:h:{digest}"


def find_existing_channel_run(db: Session, *, dedupe_key: str) -> AgentRun | None:
    # metadata_json.channel_dedupe_key match (portable enough for sqlite/json)
    rows = list(
        db.scalars(
            select(AgentRun)
            .where(AgentRun.run_type.in_(("channel", "feishu", "wecom")))
            .order_by(AgentRun.id.desc())
            .limit(50)
        )
    )
    for row in rows:
        meta = row.metadata_json or {}
        if meta.get("channel_dedupe_key") == dedupe_key:
            return row
    return None


def _bind_channel_identity(
    db: Session, msg: ChannelMessage, *, owner_user_id: str
) -> ChannelIdentityBinding:
    row = db.scalar(select(ChannelIdentityBinding).where(
        ChannelIdentityBinding.channel == msg.channel,
        ChannelIdentityBinding.external_user_id == msg.external_user_id,
    ))
    if row is None:
        row = ChannelIdentityBinding(
            channel=msg.channel,
            external_user_id=msg.external_user_id,
            owner_user_id=owner_user_id,
            last_thread_id=msg.thread_id or "",
        )
        db.add(row)
    else:
        row.last_thread_id = msg.thread_id or row.last_thread_id
    db.flush()
    return row


def _bind_channel_message(
    db: Session,
    *,
    identity: ChannelIdentityBinding,
    msg: ChannelMessage,
    run_id: str,
    direction: str,
    external_message_id: str,
    related_message_id: str = "",
    metadata: dict[str, Any] | None = None,
) -> None:
    existing = _find_channel_message_binding(
        db,
        msg=msg,
        direction=direction,
        external_message_id=external_message_id,
    )
    if existing is not None:
        return
    db.add(ChannelMessageBinding(
        identity_binding_id=identity.id,
        channel=msg.channel,
        external_message_id=external_message_id,
        direction=direction,
        thread_id=msg.thread_id or "",
        run_id=run_id,
        related_message_id=related_message_id,
        metadata_json=metadata or {},
    ))
    db.flush()


def _find_channel_message_binding(
    db: Session,
    *,
    msg: ChannelMessage,
    direction: str,
    external_message_id: str,
) -> ChannelMessageBinding | None:
    return db.scalar(select(ChannelMessageBinding).where(
        ChannelMessageBinding.channel == msg.channel,
        ChannelMessageBinding.external_message_id == external_message_id,
        ChannelMessageBinding.direction == direction,
    ))


def _send_outbound_once(
    db: Session,
    settings: Settings,
    *,
    identity: ChannelIdentityBinding,
    msg: ChannelMessage,
    run_id: str,
    inbound_message_id: str,
    reply: ChannelReply,
    metadata: dict[str, Any],
) -> OutboundResult | None:
    """Reserve, send, and bind one outbound reply at most once.

    Inbound retries can reuse an existing Run.  The outbound binding is the
    durable idempotency marker, so it must be checked before touching the
    sender; checking only inside ``_bind_channel_message`` is too late.  The
    reservation is committed before the external side effect.  A second
    process therefore loses on the existing unique constraint and does not
    call the sender.  If the sender outcome is uncertain, the binding remains
    explicitly reconcilable instead of being silently retried.
    """
    outbound_message_id = f"{inbound_message_id}:outbound"
    existing = _find_channel_message_binding(
        db,
        msg=msg,
        direction="outbound",
        external_message_id=outbound_message_id,
    )
    if existing is not None:
        _expire_stale_outbound_reservation(db, existing)
        return None

    reservation = ChannelMessageBinding(
        identity_binding_id=identity.id,
        channel=msg.channel,
        external_message_id=outbound_message_id,
        direction="outbound",
        thread_id=msg.thread_id or "",
        run_id=run_id,
        related_message_id=inbound_message_id,
        metadata_json={
            **metadata,
            "idempotency_key": outbound_message_id,
            "state": "sending",
        },
    )
    try:
        with db.begin_nested():
            db.add(reservation)
            db.flush()
        # Persist the claim before networking or filesystem writes.  If two
        # workers race, the unique constraint makes one worker the owner.
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = _find_channel_message_binding(
            db,
            msg=msg,
            direction="outbound",
            external_message_id=outbound_message_id,
        )
        if existing is not None:
            return None
        raise

    try:
        outbound = get_outbound_sender(msg.channel, settings).send(
            reply=reply,
            external_user_id=msg.external_user_id,
            thread_id=msg.thread_id,
            metadata={**metadata, "idempotency_key": outbound_message_id},
        )
    except Exception as exc:
        _mark_outbound_reconciliation_required(db, outbound_message_id, msg, exc)
        raise

    current = _find_channel_message_binding(
        db,
        msg=msg,
        direction="outbound",
        external_message_id=outbound_message_id,
    )
    if current is not None:
        current.metadata_json = {
            **(current.metadata_json or {}),
            "outbound_mode": outbound.mode,
            "outbound_ok": outbound.ok,
            "state": "sent",
        }
        db.commit()
    return outbound


def _expire_stale_outbound_reservation(
    db: Session,
    binding: ChannelMessageBinding,
) -> None:
    """Convert a crash-left reservation to an explicit reconciliation state."""
    metadata = binding.metadata_json or {}
    if metadata.get("state") != "sending":
        return
    marker_time = binding.updated_at or binding.created_at
    if marker_time is None:
        return
    cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(
        seconds=CHANNEL_OUTBOUND_RESERVATION_TIMEOUT_SECONDS
    )
    if marker_time > cutoff:
        return
    binding.metadata_json = {
        **metadata,
        "state": "reconciliation_required",
        "error": "outbound reservation expired before sender outcome was recorded",
    }
    db.commit()


def _mark_outbound_reconciliation_required(
    db: Session,
    outbound_message_id: str,
    msg: ChannelMessage,
    exc: Exception,
) -> None:
    """Record an uncertain sender outcome without exposing exception details."""
    db.rollback()
    current = _find_channel_message_binding(
        db,
        msg=msg,
        direction="outbound",
        external_message_id=outbound_message_id,
    )
    if current is None:
        return
    current.metadata_json = {
        **(current.metadata_json or {}),
        "state": "reconciliation_required",
        "error": str(exc)[:200],
    }
    db.commit()


def extract_answer(result: dict[str, Any] | None, row: AgentRun | None = None) -> str:
    data = result or (row.result_json if row else None) or {}
    if not isinstance(data, dict):
        return ""
    for key in ("answer", "output", "text", "content", "final_answer"):
        val = data.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    # multi-agent / nested
    for nest_key in ("delivery", "writer", "final"):
        nest = data.get(nest_key)
        if isinstance(nest, dict):
            for key in ("answer", "output", "text", "content"):
                val = nest.get(key)
                if isinstance(val, str) and val.strip():
                    return val.strip()
    if data.get("refused") and data.get("path") == "no_evidence":
        return str(data.get("answer") or "当前知识库未找到明确依据，无法给出制度性结论。")
    # last resort: summarize kind
    kind = data.get("kind") or data.get("path")
    if kind:
        return f"（任务已完成，类型：{kind}）"
    return "已收到您的消息，系统已处理。"


def process_channel_message(
    db: Session,
    settings: Settings,
    msg: ChannelMessage,
    *,
    cipher: ContentCipher | None = None,
    execute: bool = True,
    send_outbound: bool = True,
) -> ChannelRunOutcome:
    """Create (or reuse) a Run for the channel message and optionally reply."""
    resolved_cipher = cipher or ContentCipher(settings.content_encryption_key)
    service = AgentRunService(
        db,
        resolved_cipher,
        key_version=settings.content_encryption_key_version,
    )
    owner = channel_owner_id(msg)
    dedupe = channel_message_key(msg)
    inbound_message_id = str((msg.metadata or {}).get("message_id") or dedupe)
    identity = _bind_channel_identity(db, msg, owner_user_id=owner)
    existing = find_existing_channel_run(db, dedupe_key=dedupe)
    if existing is not None:
        answer = extract_answer(existing.result_json, existing)
        outbound = None
        if send_outbound and answer:
            outbound = _send_outbound_once(
                db,
                settings,
                identity=identity,
                msg=msg,
                run_id=existing.uuid,
                inbound_message_id=inbound_message_id,
                reply=ChannelReply(text=answer),
                metadata={"run_id": existing.uuid, "deduped": True},
            )
        return ChannelRunOutcome(
            run_id=existing.uuid,
            owner_user_id=owner,
            answer=answer,
            status=existing.status,
            outbound=outbound,
            deduped=True,
            result=existing.result_json,
        )

    row = service.create_run(
        owner_user_id=owner,
        input_text=msg.text,
        conversation_id=msg.thread_id or "",
        message_id=str((msg.metadata or {}).get("message_id") or ""),
        run_type="channel",
        title=f"{msg.channel} 会话",
        max_steps=24,
        max_model_calls=8,
        metadata={
            "channel": msg.channel,
            "external_user_id": msg.external_user_id,
            "thread_id": msg.thread_id,
            "channel_dedupe_key": dedupe,
            "channel_metadata": msg.metadata or {},
        },
    )
    _bind_channel_message(
        db, identity=identity, msg=msg, run_id=row.uuid, direction="inbound",
        external_message_id=inbound_message_id, metadata=msg.metadata or {},
    )
    answer = ""
    status = row.status
    result: dict[str, Any] | None = None
    if execute:
        runtime = select_runtime(
            db,
            resolved_cipher,
            settings=settings,
            key_version=settings.content_encryption_key_version,
        )
        try:
            snap = runtime.start_sync(
                RunRequest(
                    run_id=row.uuid,
                    owner_user_id=owner,
                    input_text=msg.text,
                    conversation_id=msg.thread_id or "",
                    message_id=str((msg.metadata or {}).get("message_id") or ""),
                    run_type="channel",
                )
            )
            result = dict(snap.result or {})
            status = snap.status
            answer = extract_answer(result)
            # ensure result on row after commit path
            db.refresh(row)
            if not answer:
                answer = extract_answer(row.result_json, row)
        except Exception as exc:
            logger.exception("channel run failed")
            try:
                if hasattr(service, "mark_failed"):
                    service.mark_failed(row, code="CHANNEL_RUN_FAILED", message=str(exc)[:200])
                else:
                    row.status = "failed"
                    row.result_json = {"error": str(exc)[:500], "kind": "channel_error"}
                    db.add(row)
                    db.flush()
            except Exception:
                row.status = "failed"
                row.result_json = {"error": str(exc)[:500], "kind": "channel_error"}
                db.add(row)
                db.flush()
            answer = "抱歉，处理您的消息时出现异常，请稍后重试或在桌面端继续。"
            status = "failed"
            result = {"error": str(exc)[:500]}
    else:
        answer = f"已接收：{msg.text[:200]}"
        status = "accepted"

    outbound = None
    if send_outbound and answer:
        outbound = _send_outbound_once(
            db,
            settings,
            identity=identity,
            msg=msg,
            run_id=row.uuid,
            inbound_message_id=inbound_message_id,
            reply=ChannelReply(
                text=answer[:4000],
                cards=[{"type": "run_summary", "run_id": row.uuid, "status": status}],
            ),
            metadata={"run_id": row.uuid},
        )
    return ChannelRunOutcome(
        run_id=row.uuid,
        owner_user_id=owner,
        answer=answer,
        status=status,
        outbound=outbound,
        deduped=False,
        result=result,
    )
