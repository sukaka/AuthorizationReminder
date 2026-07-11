import asyncio
import re
import uuid as uuid_lib
from collections import defaultdict
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings
from .crypto import ContentCipher, EncryptedPayload
from .database import SessionLocal
from .models import ChatMessage, HotQuestionReportItem
from .product_aliases import expand_product_aliases


SHANGHAI = ZoneInfo("Asia/Shanghai")


def _decrypt_message(cipher: ContentCipher, message: ChatMessage) -> str:
    if not message.content_ciphertext or not message.content_nonce:
        return ""
    return str(cipher.decrypt_json(EncryptedPayload(
        ciphertext=message.content_ciphertext,
        nonce=message.content_nonce,
    ), message.uuid.encode()).get("content") or "").strip()


def _normalize_question(question: str) -> str:
    expanded = expand_product_aliases(question).lower()
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]", "", expanded)


def _bigrams(value: str) -> set[str]:
    return {value[index:index + 2] for index in range(max(0, len(value) - 1))} or {value}


def _similar(left: str, right: str) -> bool:
    if left in right or right in left:
        return min(len(left), len(right)) >= 4
    a, b = _bigrams(left), _bigrams(right)
    return len(a & b) / max(1, len(a | b)) >= 0.55


def generate_report(
    db: Session,
    *,
    period_type: str,
    period_start: datetime,
    period_end: datetime,
    cipher: ContentCipher,
    limit: int = 20,
) -> int:
    exists = db.scalar(select(HotQuestionReportItem.id).where(
        HotQuestionReportItem.period_type == period_type,
        HotQuestionReportItem.period_start == period_start,
        HotQuestionReportItem.period_end == period_end,
    ).limit(1))
    if exists:
        return 0
    rows = list(db.scalars(select(ChatMessage).where(
        ChatMessage.role == "user",
        ChatMessage.status == "COMPLETED",
        ChatMessage.created_at >= period_start,
        ChatMessage.created_at < period_end,
    ).order_by(ChatMessage.created_at.asc())))
    questions = [(row, _decrypt_message(cipher, row)) for row in rows]
    questions = [(row, question) for row, question in questions if question]
    clusters: list[dict] = []
    for row, question in questions:
        normalized = _normalize_question(question)
        target = next((cluster for cluster in clusters if _similar(normalized, cluster["normalized"])), None)
        if target is None:
            target = {"normalized": normalized, "questions": [], "session_id": row.session_id, "message_id": row.id}
            clusters.append(target)
        target["questions"].append(question)
    clusters.sort(key=lambda cluster: len(cluster["questions"]), reverse=True)
    for rank, cluster in enumerate(clusters[:limit], start=1):
        representative = cluster["questions"][0]
        assistant = db.scalar(select(ChatMessage).where(
            ChatMessage.session_id == cluster["session_id"],
            ChatMessage.role == "assistant",
            ChatMessage.status == "COMPLETED",
            ChatMessage.id > cluster["message_id"],
        ).order_by(ChatMessage.id.asc()).limit(1))
        reply = _decrypt_message(cipher, assistant) if assistant else "待结合正式知识库完善专项回复。"
        item_uuid = str(uuid_lib.uuid4())
        question_payload = cipher.encrypt_json({"text": representative}, item_uuid.encode())
        samples_payload = cipher.encrypt_json({"items": cluster["questions"][:10]}, f"{item_uuid}:samples".encode())
        reply_payload = cipher.encrypt_json({"text": reply}, f"{item_uuid}:reply".encode())
        db.add(HotQuestionReportItem(
            uuid=item_uuid,
            period_type=period_type,
            period_start=period_start,
            period_end=period_end,
            rank=rank,
            question_count=len(cluster["questions"]),
            question_ciphertext=question_payload.ciphertext,
            question_nonce=question_payload.nonce,
            samples_ciphertext=samples_payload.ciphertext,
            samples_nonce=samples_payload.nonce,
            reply_ciphertext=reply_payload.ciphertext,
            reply_nonce=reply_payload.nonce,
            analysis_summary=f"共出现 {len(cluster['questions'])} 次，已合并相似问法 {len(set(cluster['questions']))} 种。",
        ))
    db.commit()
    return min(limit, len(clusters))


def _utc_naive(value: datetime) -> datetime:
    return value.astimezone(UTC).replace(tzinfo=None)


def ensure_due_reports(settings: Settings, now: datetime | None = None) -> None:
    local_now = (now or datetime.now(SHANGHAI)).astimezone(SHANGHAI)
    if local_now.hour < 6:
        return
    today = local_now.date()
    periods: list[tuple[str, datetime, datetime]] = []
    day_end = datetime.combine(today, time.min, SHANGHAI)
    periods.append(("daily", day_end - timedelta(days=1), day_end))
    if local_now.weekday() == 0:
        periods.append(("weekly", day_end - timedelta(days=7), day_end))
    if today.day == 1:
        month_end = day_end
        previous_month_last = today - timedelta(days=1)
        month_start = datetime.combine(previous_month_last.replace(day=1), time.min, SHANGHAI)
        periods.append(("monthly", month_start, month_end))
    cipher = ContentCipher(settings.content_encryption_key)
    with SessionLocal() as db:
        for period_type, start, end in periods:
            generate_report(db, period_type=period_type, period_start=_utc_naive(start), period_end=_utc_naive(end), cipher=cipher)


async def hot_question_scheduler(settings: Settings) -> None:
    while True:
        try:
            await asyncio.to_thread(ensure_due_reports, settings)
        except Exception:
            pass
        await asyncio.sleep(300)
