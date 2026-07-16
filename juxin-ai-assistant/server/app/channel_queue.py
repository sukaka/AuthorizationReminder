"""Async dispatcher for channel runs with optional durable ChannelJob rows."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from .channel_gateway import ChannelMessage
from .channel_job_service import ChannelJobService
from .channel_run_bridge import process_channel_message
from .config import get_settings
from .crypto import ContentCipher
from .database import SessionLocal
from .feature_flags import load_feature_flags

logger = logging.getLogger(__name__)


class ChannelRunDispatcher:
    def __init__(self) -> None:
        self.tasks: dict[str, asyncio.Task[None]] = {}

    def enqueue_message(self, msg: ChannelMessage, *, job_key: str = "") -> str:
        """Schedule background processing. Returns job key or durable job uuid."""
        key = job_key or f"{msg.channel}:{msg.metadata.get('message_id') or msg.text[:32]}"
        key = key[:128]
        durable_id = self._persist_job(msg, key)

        current = self.tasks.get(key)
        if current is not None and not current.done():
            return durable_id or key

        job_uuid = durable_id

        async def _runner() -> None:
            await asyncio.to_thread(self._run_sync, msg, job_uuid)

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            self._run_sync(msg, job_uuid)
            return durable_id or key

        task = loop.create_task(_runner())
        self.tasks[key] = task
        task.add_done_callback(lambda _t: self.tasks.pop(key, None))
        return durable_id or key

    def enqueue_job_retry(self, job_uuid: str) -> str:
        async def _runner() -> None:
            await asyncio.to_thread(self._process_job_uuid, job_uuid)

        try:
            loop = asyncio.get_running_loop()
            task = loop.create_task(_runner())
            self.tasks[job_uuid] = task
            task.add_done_callback(lambda _t: self.tasks.pop(job_uuid, None))
        except RuntimeError:
            self._process_job_uuid(job_uuid)
        return job_uuid

    def drain_retries(self, *, limit: int = 10) -> list[str]:
        """Pick retryable durable jobs and schedule them. Returns job uuids."""
        settings = get_settings()
        processed: list[str] = []
        with SessionLocal() as db:
            service = ChannelJobService(db)
            jobs = service.list_retryable(limit=limit)
            ids = [j.uuid for j in jobs]
            db.commit()
        for job_id in ids:
            self.enqueue_job_retry(job_id)
            processed.append(job_id)
        return processed

    def _persist_job(self, msg: ChannelMessage, key: str) -> str:
        flags = load_feature_flags()
        if not flags.get("channel_durable_jobs", True):
            return ""
        try:
            with SessionLocal() as db:
                row = ChannelJobService(db).enqueue(msg, job_key=key)
                db.commit()
                return row.uuid
        except Exception:
            logger.exception("persist channel job failed")
            return ""

    def _run_sync(self, msg: ChannelMessage, job_uuid: str = "") -> None:
        if job_uuid:
            self._process_job_uuid(job_uuid)
            return
        settings = get_settings()
        try:
            cipher = ContentCipher(settings.content_encryption_key)
        except Exception:
            cipher = None
        with SessionLocal() as db:
            try:
                process_channel_message(
                    db,
                    settings,
                    msg,
                    cipher=cipher,
                    execute=True,
                    send_outbound=True,
                )
                db.commit()
            except Exception:
                logger.exception("channel async run failed")
                db.rollback()

    def _process_job_uuid(self, job_uuid: str) -> None:
        settings = get_settings()
        try:
            cipher = ContentCipher(settings.content_encryption_key)
        except Exception:
            cipher = None
        with SessionLocal() as db:
            service = ChannelJobService(db)
            job = service.get(job_uuid)
            if job is None:
                return
            if job.status == "succeeded":
                return
            try:
                service.process_job(job, settings, cipher=cipher)
                db.commit()
            except Exception:
                logger.exception("channel job process failed")
                db.rollback()

    def pending_count(self) -> int:
        return sum(1 for t in self.tasks.values() if not t.done())


channel_dispatcher = ChannelRunDispatcher()


def message_to_dict(msg: ChannelMessage) -> dict[str, Any]:
    return {
        "channel": msg.channel,
        "external_user_id": msg.external_user_id,
        "text": msg.text,
        "thread_id": msg.thread_id,
        "raw": msg.raw,
        "metadata": msg.metadata,
    }


def message_from_dict(data: dict[str, Any]) -> ChannelMessage:
    return ChannelMessage(
        channel=str(data.get("channel") or "web"),
        external_user_id=str(data.get("external_user_id") or ""),
        text=str(data.get("text") or ""),
        thread_id=str(data.get("thread_id") or ""),
        raw=data.get("raw") if isinstance(data.get("raw"), dict) else {},
        metadata=data.get("metadata") if isinstance(data.get("metadata"), dict) else {},
    )
