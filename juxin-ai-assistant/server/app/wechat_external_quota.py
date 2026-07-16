"""Atomic Redis quota for the WeChat external channel (fail closed)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import secrets
from zoneinfo import ZoneInfo

from fastapi import HTTPException

try:
    import redis
except ImportError:  # pragma: no cover
    redis = None

SHANGHAI = ZoneInfo("Asia/Shanghai")

RESERVE_LUA = """
local now=tonumber(ARGV[1]); local hour_start=now-3600000; local minute_start=now-60000
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', hour_start)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', minute_start)
local hour=redis.call('ZCARD', KEYS[1]); local day=redis.call('ZCARD', KEYS[3]); local minute=redis.call('ZCARD', KEYS[2])
if hour >= tonumber(ARGV[2]) then return {0, 'hour', hour, day} end
if day >= tonumber(ARGV[3]) then return {0, 'day', hour, day} end
if minute >= 3 then return {0, 'minute', hour, day} end
for _, key in ipairs(KEYS) do redis.call('ZADD', key, now, ARGV[4]) end
redis.call('EXPIRE', KEYS[1], 7200); redis.call('EXPIRE', KEYS[2], 120); redis.call('EXPIRE', KEYS[3], tonumber(ARGV[5]))
return {1, 'ok', hour + 1, day + 1}
"""
REFUND_LUA = "for _, key in ipairs(KEYS) do redis.call('ZREM', key, ARGV[1]) end; return 1"


@dataclass(frozen=True)
class QuotaReservation:
    event_id: str
    hour_remaining: int
    day_remaining: int


class WechatExternalQuota:
    def __init__(self, *, url: str, prefix: str, hourly_limit: int, daily_limit: int, client=None) -> None:
        self.prefix = prefix.strip(":")
        self.hourly_limit = hourly_limit
        self.daily_limit = daily_limit
        self.client = client or (redis.Redis.from_url(url, decode_responses=True, socket_connect_timeout=0.3, socket_timeout=0.5) if redis else None)

    @classmethod
    def from_settings(cls, settings):
        return cls(url=settings.knowledge_redis_url, prefix=settings.wechat_external_redis_prefix, hourly_limit=settings.wechat_external_hourly_question_limit, daily_limit=settings.wechat_external_daily_question_limit)

    def _keys(self, visitor_uuid: str, now: datetime) -> list[str]:
        local = now.astimezone(SHANGHAI)
        root = f"{self.prefix}:{visitor_uuid}"
        return [f"{root}:hour", f"{root}:minute", f"{root}:day:{local:%Y%m%d}"]

    def reserve(self, visitor_uuid: str, *, now: datetime | None = None) -> QuotaReservation:
        if self.client is None:
            raise HTTPException(status_code=503, detail="EXTERNAL_QUOTA_UNAVAILABLE")
        now = now or datetime.now(SHANGHAI)
        event_id = secrets.token_hex(32)
        next_day = (now.astimezone(SHANGHAI).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1))
        day_ttl = max(3600, int((next_day - now.astimezone(SHANGHAI)).total_seconds()) + 3600)
        try:
            allowed, reason, hour_used, day_used = self.client.eval(RESERVE_LUA, 3, *self._keys(visitor_uuid, now), int(now.timestamp() * 1000), self.hourly_limit, self.daily_limit, event_id, day_ttl)
        except Exception as exc:
            raise HTTPException(status_code=503, detail="EXTERNAL_QUOTA_UNAVAILABLE") from exc
        if int(allowed) != 1:
            raise HTTPException(status_code=429, detail={"code": "EXTERNAL_QUOTA_EXCEEDED", "reason": str(reason), "hour_remaining": 0, "day_remaining": max(0, self.daily_limit - int(day_used))})
        return QuotaReservation(event_id, max(0, self.hourly_limit - int(hour_used)), max(0, self.daily_limit - int(day_used)))

    def refund(self, visitor_uuid: str, reservation: QuotaReservation, *, now: datetime | None = None) -> None:
        if self.client is None:
            return
        try:
            self.client.eval(REFUND_LUA, 3, *self._keys(visitor_uuid, now or datetime.now(SHANGHAI)), reservation.event_id)
        except Exception:
            return

    def remaining(self, visitor_uuid: str, *, now: datetime | None = None) -> tuple[int, int]:
        if self.client is None:
            raise HTTPException(status_code=503, detail="EXTERNAL_QUOTA_UNAVAILABLE")
        now = now or datetime.now(SHANGHAI)
        try:
            keys = self._keys(visitor_uuid, now)
            self.client.zremrangebyscore(keys[0], "-inf", int(now.timestamp() * 1000) - 3_600_000)
            return max(0, self.hourly_limit - int(self.client.zcard(keys[0]))), max(0, self.daily_limit - int(self.client.zcard(keys[2])))
        except Exception as exc:
            raise HTTPException(status_code=503, detail="EXTERNAL_QUOTA_UNAVAILABLE") from exc
