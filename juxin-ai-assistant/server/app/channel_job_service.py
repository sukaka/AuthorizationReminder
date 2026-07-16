"""Persistent channel jobs: enqueue, process, retry, dead-letter."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .channel_gateway import ChannelMessage
from .channel_run_bridge import process_channel_message
from .config import Settings
from .crypto import ContentCipher
from .models import ChannelJob


def _message_to_dict(msg: ChannelMessage) -> dict[str, Any]:
    return {
        "channel": msg.channel,
        "external_user_id": msg.external_user_id,
        "text": msg.text,
        "thread_id": msg.thread_id,
        "raw": msg.raw,
        "metadata": msg.metadata,
    }


def _message_from_dict(data: dict[str, Any]) -> ChannelMessage:
    return ChannelMessage(
        channel=str(data.get("channel") or "web"),
        external_user_id=str(data.get("external_user_id") or ""),
        text=str(data.get("text") or ""),
        thread_id=str(data.get("thread_id") or ""),
        raw=data.get("raw") if isinstance(data.get("raw"), dict) else {},
        metadata=data.get("metadata") if isinstance(data.get("metadata"), dict) else {},
    )


class ChannelJobService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def enqueue(
        self,
        msg: ChannelMessage,
        *,
        job_key: str = "",
        max_attempts: int = 3,
    ) -> ChannelJob:
        key = (job_key or f"{msg.channel}:{msg.metadata.get('message_id') or ''}")[:128]
        if key:
            existing = self.db.scalar(
                select(ChannelJob)
                .where(ChannelJob.job_key == key, ChannelJob.status.in_(("queued", "running", "succeeded")))
                .order_by(ChannelJob.id.desc())
                .limit(1)
            )
            if existing is not None:
                return existing
        row = ChannelJob(
            channel=msg.channel,
            job_key=key,
            external_user_id=msg.external_user_id[:128],
            thread_id=(msg.thread_id or "")[:128],
            status="queued",
            attempt=0,
            max_attempts=max(1, int(max_attempts)),
            payload_json=_message_to_dict(msg),
            result_json={},
            last_error="",
        )
        self.db.add(row)
        self.db.flush()
        return row

    def get(self, job_id: str) -> ChannelJob | None:
        return self.db.scalar(select(ChannelJob).where(ChannelJob.uuid == job_id))

    def list_recent(self, *, limit: int = 50, status: str = "") -> list[ChannelJob]:
        stmt = select(ChannelJob).order_by(ChannelJob.id.desc()).limit(limit)
        if status:
            stmt = select(ChannelJob).where(ChannelJob.status == status).order_by(ChannelJob.id.desc()).limit(limit)
        return list(self.db.scalars(stmt))

    def list_retryable(self, *, now: datetime | None = None, limit: int = 20) -> list[ChannelJob]:
        now = now or datetime.now(UTC).replace(tzinfo=None)
        rows = list(
            self.db.scalars(
                select(ChannelJob)
                .where(ChannelJob.status.in_(("queued", "failed")))
                .order_by(ChannelJob.id.asc())
                .limit(limit * 3)
            )
        )
        out: list[ChannelJob] = []
        for row in rows:
            if row.status == "queued":
                out.append(row)
            elif row.status == "failed" and int(row.attempt) < int(row.max_attempts):
                if row.next_retry_at is None or row.next_retry_at <= now:
                    out.append(row)
            if len(out) >= limit:
                break
        return out

    def process_job(
        self,
        job: ChannelJob,
        settings: Settings,
        *,
        cipher: ContentCipher | None = None,
    ) -> ChannelJob:
        job.status = "running"
        job.attempt = int(job.attempt or 0) + 1
        self.db.add(job)
        self.db.flush()
        msg = _message_from_dict(job.payload_json or {})
        try:
            outcome = process_channel_message(
                self.db,
                settings,
                msg,
                cipher=cipher,
                execute=True,
                send_outbound=True,
            )
            job.status = "succeeded"
            job.run_id = outcome.run_id or ""
            job.result_json = {
                "answer_preview": (outcome.answer or "")[:500],
                "status": outcome.status,
                "deduped": outcome.deduped,
                "outbound_mode": outcome.outbound.mode if outcome.outbound else "",
            }
            job.last_error = ""
            job.next_retry_at = None
        except Exception as exc:
            job.last_error = str(exc)[:1000]
            if int(job.attempt) >= int(job.max_attempts):
                job.status = "dead"
                job.next_retry_at = None
            else:
                job.status = "failed"
                # exponential backoff: 30s, 60s, 120s...
                delay = 30 * (2 ** max(0, int(job.attempt) - 1))
                job.next_retry_at = datetime.now(UTC).replace(tzinfo=None) + timedelta(seconds=delay)
            job.result_json = {"error": job.last_error}
        self.db.add(job)
        self.db.flush()
        return job

    def to_public(self, job: ChannelJob) -> dict[str, Any]:
        return {
            "job_id": job.uuid,
            "channel": job.channel,
            "job_key": job.job_key,
            "external_user_id": job.external_user_id,
            "thread_id": job.thread_id,
            "status": job.status,
            "attempt": int(job.attempt or 0),
            "max_attempts": int(job.max_attempts or 3),
            "run_id": job.run_id or "",
            "last_error": job.last_error or "",
            "next_retry_at": job.next_retry_at.isoformat() if job.next_retry_at else None,
            "result": job.result_json or {},
        }
