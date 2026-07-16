import asyncio
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime
from typing import Any
import uuid as uuid_lib

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .chat_service import complete_chat_message
from .config import Settings
from .crypto import ContentCipher, EncryptedPayload
from .models import ChatMessage, ChatSession, LongTask
from .schemas import ChatCompleteIn, LongTaskChatCreateIn, LongTaskOut
from .server_model_client import ModelRequestConfig, ServerModelStreamEvent, stream_with_model_config
from .user_model_profiles import decrypt_user_model_api_key, get_default_user_model_profile


TERMINAL_STATUSES = {"completed", "failed", "cancelled"}
RUNNING_STATUSES = {"queued", "running", "retrying"}


class LongTaskService:
    def __init__(self, db: Session, cipher: ContentCipher) -> None:
        self.db = db
        self.cipher = cipher

    def create_chat_task(
        self,
        *,
        owner_user_id: str,
        body: LongTaskChatCreateIn,
        key_version: str,
    ) -> LongTask:
        message = self.db.scalar(
            select(ChatMessage)
            .join(ChatSession, ChatSession.id == ChatMessage.session_id)
            .where(
                ChatMessage.uuid == body.message_uuid,
                ChatMessage.sso_user_id == owner_user_id,
                ChatMessage.role == "assistant",
                ChatMessage.status == "PENDING",
                ChatSession.uuid == body.conversation_id,
                ChatSession.sso_user_id == owner_user_id,
                ChatSession.status == "active",
            )
        )
        if message is None:
            raise HTTPException(status_code=404, detail="待处理消息不存在或无权访问")
        existing = self.db.scalar(
            select(LongTask).where(LongTask.message_id == body.message_uuid)
        )
        if existing is not None:
            raise HTTPException(status_code=409, detail="该消息已加入后台处理")
        task_uuid = str(uuid_lib.uuid4())
        encrypted = self.cipher.encrypt_json(
            {
                "completion_token": body.completion_token,
                "messages": [message.model_dump() for message in body.messages],
                "temperature": body.temperature,
            },
            task_uuid.encode(),
        )
        row = LongTask(
            uuid=task_uuid,
            owner_user_id=owner_user_id,
            conversation_id=body.conversation_id,
            message_id=body.message_uuid,
            task_type="chat_generation",
            title=body.title.strip(),
            status="queued",
            stage="queued",
            progress=0,
            attempt=1,
            cancel_requested=False,
            request_ciphertext=encrypted.ciphertext,
            request_nonce=encrypted.nonce,
            draft_ciphertext=b"",
            draft_nonce=b"",
            key_version=key_version,
            checkpoint_json={"stage": "queued"},
            result_json={},
        )
        self.db.add(row)
        self.db.flush()
        return row

    def list_for_owner(self, owner_user_id: str) -> list[LongTask]:
        return list(self.db.scalars(
            select(LongTask)
            .where(LongTask.owner_user_id == owner_user_id)
            .order_by(LongTask.updated_at.desc(), LongTask.id.desc())
        ))

    def get(self, task_id: str, *, owner_user_id: str | None = None) -> LongTask:
        conditions = [LongTask.uuid == task_id]
        if owner_user_id is not None:
            conditions.append(LongTask.owner_user_id == owner_user_id)
        row = self.db.scalar(select(LongTask).where(*conditions))
        if row is None:
            raise HTTPException(status_code=404, detail="后台任务不存在")
        return row

    def request_cancel(self, task_id: str, *, owner_user_id: str) -> LongTask:
        row = self.get(task_id, owner_user_id=owner_user_id)
        if row.status in TERMINAL_STATUSES:
            return row
        row.cancel_requested = True
        row.status = "cancelled"
        row.stage = "cancelled"
        row.finished_at = datetime.now(UTC).replace(tzinfo=None)
        row.checkpoint_json = {**(row.checkpoint_json or {}), "stage": "cancelled"}
        self.db.flush()
        return row

    def retry(self, task_id: str, *, owner_user_id: str) -> LongTask:
        row = self.get(task_id, owner_user_id=owner_user_id)
        if row.status != "failed":
            raise HTTPException(status_code=409, detail="当前任务不可重试")
        row.status = "retrying"
        row.stage = str((row.checkpoint_json or {}).get("stage") or "queued")
        row.progress = max(0, min(row.progress, 95))
        row.attempt += 1
        row.cancel_requested = False
        row.error_code = ""
        row.error_message_safe = ""
        row.finished_at = None
        self.db.flush()
        return row

    def mark_running(self, task_id: str, *, owner_user_id: str) -> LongTask:
        row = self.get(task_id, owner_user_id=owner_user_id)
        if row.cancel_requested or row.status == "cancelled":
            return row
        row.status = "running"
        row.stage = "generating"
        row.progress = max(5, row.progress)
        row.started_at = row.started_at or datetime.now(UTC).replace(tzinfo=None)
        row.checkpoint_json = {**(row.checkpoint_json or {}), "stage": "generating"}
        self.db.flush()
        return row

    def save_draft(
        self,
        task_id: str,
        *,
        owner_user_id: str,
        draft: str,
        checkpoint: str,
    ) -> LongTask:
        row = self.get(task_id, owner_user_id=owner_user_id)
        encrypted = self.cipher.encrypt_json({"draft": draft}, row.uuid.encode())
        row.draft_ciphertext = encrypted.ciphertext
        row.draft_nonce = encrypted.nonce
        row.stage = checkpoint
        row.progress = min(95, max(row.progress, 10 + min(80, len(draft) // 100)))
        row.checkpoint_json = {
            **(row.checkpoint_json or {}),
            "stage": checkpoint,
            "draft_chars": len(draft),
        }
        self.db.flush()
        return row

    def mark_failed(
        self,
        task_id: str,
        *,
        owner_user_id: str,
        error_code: str,
        error_message: str,
    ) -> LongTask:
        row = self.get(task_id, owner_user_id=owner_user_id)
        row.status = "failed"
        row.error_code = error_code[:64]
        row.error_message_safe = error_message[:500]
        row.finished_at = datetime.now(UTC).replace(tzinfo=None)
        self.db.flush()
        return row

    def mark_completed(self, task_id: str, *, owner_user_id: str) -> LongTask:
        row = self.get(task_id, owner_user_id=owner_user_id)
        row.status = "completed"
        row.stage = "completed"
        row.progress = 100
        row.finished_at = datetime.now(UTC).replace(tzinfo=None)
        row.error_code = ""
        row.error_message_safe = ""
        row.checkpoint_json = {**(row.checkpoint_json or {}), "stage": "completed"}
        self.db.flush()
        return row

    def request_payload(self, row: LongTask) -> dict[str, Any]:
        return self.cipher.decrypt_json(
            EncryptedPayload(row.request_ciphertext, row.request_nonce),
            row.uuid.encode(),
        )

    def draft(self, row: LongTask) -> str:
        if not row.draft_ciphertext or not row.draft_nonce:
            return ""
        payload = self.cipher.decrypt_json(
            EncryptedPayload(row.draft_ciphertext, row.draft_nonce),
            row.uuid.encode(),
        )
        return str(payload.get("draft") or "")

    def public_out(self, row: LongTask) -> LongTaskOut:
        return LongTaskOut(
            task_id=row.uuid,
            task_type=row.task_type,
            title=row.title,
            conversation_id=row.conversation_id,
            message_uuid=row.message_id,
            status=row.status,
            stage=row.stage,
            progress=row.progress,
            attempt=row.attempt,
            draft=self.draft(row),
            error_code=row.error_code,
            error_message=row.error_message_safe,
            retry_allowed=row.status == "failed",
            cancel_allowed=row.status in RUNNING_STATUSES,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )


StreamModel = Callable[[LongTask, dict[str, Any]], AsyncIterator[ServerModelStreamEvent]]


class LongTaskExecutor:
    def __init__(
        self,
        db: Session,
        cipher: ContentCipher,
        *,
        settings: Settings | None = None,
        stream_model: StreamModel | None = None,
    ) -> None:
        self.db = db
        self.cipher = cipher
        self.settings = settings
        self.stream_model = stream_model

    async def run(self, task_id: str) -> None:
        service = LongTaskService(self.db, self.cipher)
        row = service.get(task_id)
        if row.cancel_requested or row.status == "cancelled":
            return
        owner_user_id = row.owner_user_id
        service.mark_running(task_id, owner_user_id=owner_user_id)
        self.db.commit()
        payload = service.request_payload(row)
        draft = service.draft(row)
        try:
            streamer = self.stream_model or self._stream_chat_model
            async for event in streamer(row, payload):
                self.db.refresh(row)
                if row.cancel_requested or row.status == "cancelled":
                    return
                if event.delta:
                    draft += event.delta
                    service.save_draft(
                        task_id,
                        owner_user_id=owner_user_id,
                        draft=draft,
                        checkpoint="generating",
                    )
                    self.db.commit()
            if not draft.strip():
                raise HTTPException(status_code=502, detail="SERVER_MODEL_EMPTY_OUTPUT")
            self.db.refresh(row)
            if row.cancel_requested or row.status == "cancelled":
                return
            complete_chat_message(
                self.db,
                sso_user_id=owner_user_id,
                message_uuid=row.message_id,
                body=ChatCompleteIn(
                    completion_token=str(payload.get("completion_token") or ""),
                    answer=draft,
                    model_display_name=str((row.result_json or {}).get("model_display_name") or "服务端模型"),
                    model_id=str((row.result_json or {}).get("model_id") or ""),
                    usage=dict((row.result_json or {}).get("usage") or {}),
                ),
                cipher=self.cipher,
            )
            service.mark_completed(task_id, owner_user_id=owner_user_id)
            self.db.commit()
        except asyncio.CancelledError:
            self.db.rollback()
            service.request_cancel(task_id, owner_user_id=owner_user_id)
            self.db.commit()
            raise
        except HTTPException as exc:
            self.db.rollback()
            service.mark_failed(
                task_id,
                owner_user_id=owner_user_id,
                error_code=str(exc.detail),
                error_message=_safe_failure_message(str(exc.detail)),
            )
            self.db.commit()
        except Exception:
            self.db.rollback()
            service.mark_failed(
                task_id,
                owner_user_id=owner_user_id,
                error_code="LONG_TASK_FAILED",
                error_message="任务执行失败，已保留当前草稿，可稍后重试",
            )
            self.db.commit()

    async def _stream_chat_model(
        self,
        row: LongTask,
        payload: dict[str, Any],
    ) -> AsyncIterator[ServerModelStreamEvent]:
        if self.settings is None:
            raise HTTPException(status_code=409, detail="SERVER_MODEL_NOT_CONFIGURED")
        profile = get_default_user_model_profile(self.db, row.owner_user_id)
        if profile is not None:
            config = ModelRequestConfig(
                base_url=profile.base_url,
                api_key=decrypt_user_model_api_key(self.cipher, profile),
                model_id=profile.model_id,
                display_name=profile.display_name,
                timeout_seconds=profile.timeout_seconds,
                max_output_tokens=profile.max_output_tokens,
            )
        else:
            if not (
                self.settings.server_model_base_url.strip()
                and self.settings.server_model_api_key.strip()
                and self.settings.server_model_id.strip()
            ):
                raise HTTPException(status_code=409, detail="SERVER_MODEL_NOT_CONFIGURED")
            config = ModelRequestConfig(
                base_url=self.settings.server_model_base_url,
                api_key=self.settings.server_model_api_key,
                model_id=self.settings.server_model_id,
                display_name=self.settings.server_model_display_name or self.settings.server_model_id,
                timeout_seconds=self.settings.server_model_timeout_seconds,
                max_output_tokens=self.settings.server_model_max_output_tokens,
            )
        row.result_json = {
            **(row.result_json or {}),
            "model_display_name": config.display_name,
            "model_id": config.model_id,
        }
        self.db.commit()
        messages = [dict(item) for item in payload.get("messages", []) if isinstance(item, dict)]
        existing_draft = LongTaskService(self.db, self.cipher).draft(row)
        if existing_draft:
            messages.extend([
                {"role": "assistant", "content": existing_draft},
                {"role": "user", "content": "请从上方草稿中断处继续，不要重复已经完成的内容。"},
            ])
        async for event in stream_with_model_config(
            config,
            messages,
            float(payload.get("temperature") or 0.3),
        ):
            if event.usage is not None:
                row.result_json = {**(row.result_json or {}), "usage": event.usage}
            yield event


def _safe_failure_message(code: str) -> str:
    if code == "SERVER_MODEL_NOT_CONFIGURED":
        return "当前没有可用模型，请完成模型设置后重试"
    if code == "SERVER_MODEL_AUTH_FAILED":
        return "模型认证失败，请检查模型设置后重试"
    if code == "SERVER_MODEL_TIMEOUT":
        return "模型调用超时，已保留当前草稿，可稍后重试"
    if code == "SERVER_MODEL_RATE_LIMITED":
        return "模型服务当前繁忙，已保留当前草稿，请稍后重试"
    if code == "SERVER_MODEL_UPSTREAM_UNAVAILABLE":
        return "模型服务暂时不可用，已保留当前草稿，可稍后重试"
    if code == "SERVER_MODEL_EMPTY_OUTPUT":
        return "模型未返回内容，已保留当前草稿，可重试"
    return "联网或模型调用失败，已保留当前草稿，可稍后重试"
