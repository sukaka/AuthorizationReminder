"""Background worker that drains durable channel jobs periodically."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from .channel_queue import channel_dispatcher
from .config import Settings
from .feature_flags import load_feature_flags

logger = logging.getLogger(__name__)


async def channel_job_scheduler(settings: Settings) -> None:
    """Loop: schedule retryable channel jobs until cancelled."""
    while True:
        try:
            flags = load_feature_flags(settings)
            enabled = bool(flags.get("channel_durable_jobs", True))
            interval = int(flags.get("channel_drain_interval_seconds") or 30)
            interval = max(5, min(interval, 600))
            batch = int(flags.get("channel_drain_batch") or 10)
            batch = max(1, min(batch, 50))
            if enabled:
                ids = await asyncio.to_thread(channel_dispatcher.drain_retries, limit=batch)
                if ids:
                    logger.info("channel drain scheduled %s jobs", len(ids))
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("channel job scheduler tick failed")
        await asyncio.sleep(interval)


def scheduler_status(settings: Settings | None = None) -> dict[str, Any]:
    flags = load_feature_flags(settings)
    return {
        "durable": bool(flags.get("channel_durable_jobs", True)),
        "interval_seconds": int(flags.get("channel_drain_interval_seconds") or 30),
        "batch": int(flags.get("channel_drain_batch") or 10),
        "pending_async": channel_dispatcher.pending_count(),
    }
