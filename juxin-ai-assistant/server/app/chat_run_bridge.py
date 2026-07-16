"""Bridge chat user messages to unified Agent Runs without replacing chat API."""

from __future__ import annotations

from sqlalchemy.orm import Session

from .agent_run_service import AgentRunService
from .agent_runtime.native_runtime import NativeRuntime
from .agent_runtime.protocol import RunRequest
from .config import Settings
from .crypto import ContentCipher


def attach_run_for_chat_question(
    db: Session,
    *,
    settings: Settings,
    owner_user_id: str,
    question: str,
    conversation_id: str = "",
    message_id: str = "",
    title: str = "对话任务",
    precomputed_answer: str | None = None,
) -> str:
    """Create and execute a Run for a chat message; return run uuid.

    If precomputed_answer is provided (e.g. file-delivery short circuit), store
    it as a completed chat-linked run without re-running NativeRuntime answer.
    """
    cipher = ContentCipher(settings.content_encryption_key)
    service = AgentRunService(
        db,
        cipher,
        key_version=settings.content_encryption_key_version,
    )
    row = service.create_run(
        owner_user_id=owner_user_id,
        input_text=question,
        conversation_id=conversation_id or "",
        message_id=message_id or "",
        run_type="chat",
        title=(title or "对话任务")[:255],
        metadata={"source": "chat_prepare"},
    )

    if precomputed_answer is not None:
        service.mark_running(row)
        service.add_step(
            row,
            step_type="chat_precomputed",
            status="succeeded",
            role="system",
            output_summary={"summary": "聊天路径预计算结果"},
        )
        service.mark_succeeded(
            row,
            result={
                "kind": "chat_precomputed",
                "answer": precomputed_answer,
                "model_calls": 0,
            },
        )
        db.flush()
        return row.uuid

    runtime = NativeRuntime(
        db,
        cipher,
        key_version=settings.content_encryption_key_version,
    )
    runtime.start_sync(
        RunRequest(
            run_id=row.uuid,
            owner_user_id=owner_user_id,
            input_text=question,
            conversation_id=conversation_id or "",
            message_id=message_id or "",
            run_type="chat",
        )
    )
    db.flush()
    return row.uuid
