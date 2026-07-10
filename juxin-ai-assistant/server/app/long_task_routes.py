import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from typing import Annotated

from .auth import get_session, require_action
from .config import Settings, get_settings
from .crypto import ContentCipher
from .database import SessionLocal, get_db
from .long_tasks import LongTaskExecutor, LongTaskService
from .models import LongTask
from .schemas import LongTaskChatCreateIn, LongTaskListOut, LongTaskOut, SessionPayload


router = APIRouter(prefix="/api/ai/long-tasks", tags=["long-tasks"])


async def run_long_task(task_id: str) -> None:
    settings = get_settings()
    with SessionLocal() as db:
        await LongTaskExecutor(
            db,
            ContentCipher(settings.content_encryption_key),
            settings=settings,
        ).run(task_id)


class LongTaskDispatcher:
    def __init__(self) -> None:
        self.tasks: dict[str, asyncio.Task[None]] = {}

    def enqueue(self, task_id: str) -> None:
        current = self.tasks.get(task_id)
        if current is not None and not current.done():
            return
        task = asyncio.get_running_loop().create_task(run_long_task(task_id))
        self.tasks[task_id] = task
        task.add_done_callback(lambda _task: self.tasks.pop(task_id, None))

    def cancel(self, task_id: str) -> None:
        task = self.tasks.get(task_id)
        if task is not None and not task.done():
            task.cancel()

    def recover(self) -> None:
        try:
            with SessionLocal() as db:
                rows = list(db.query(LongTask).filter(LongTask.status.in_(["queued", "running", "retrying"])))
                for row in rows:
                    if row.status == "running":
                        row.status = "retrying"
                    row.cancel_requested = False
                db.commit()
                task_ids = [row.uuid for row in rows]
        except SQLAlchemyError:
            return
        for task_id in task_ids:
            self.enqueue(task_id)


dispatcher = LongTaskDispatcher()


def _service(db: Session, settings: Settings) -> LongTaskService:
    return LongTaskService(db, ContentCipher(settings.content_encryption_key))


async def _require_use(
    request: Request,
    session_payload: SessionPayload,
    settings: Settings,
) -> None:
    await require_action("ai_assistant:use", request, session_payload, settings)


@router.post("/chat-generation", response_model=LongTaskOut, status_code=202)
async def create_chat_long_task(
    body: LongTaskChatCreateIn,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> LongTaskOut:
    await _require_use(request, session_payload, settings)
    service = _service(db, settings)
    row = service.create_chat_task(
        owner_user_id=str(session_payload.user.id),
        body=body,
        key_version=settings.content_encryption_key_version,
    )
    db.commit()
    result = service.public_out(row)
    dispatcher.enqueue(row.uuid)
    return result


@router.get("", response_model=LongTaskListOut)
async def list_long_tasks(
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> LongTaskListOut:
    await _require_use(request, session_payload, settings)
    service = _service(db, settings)
    rows = service.list_for_owner(str(session_payload.user.id))
    return LongTaskListOut(items=[service.public_out(row) for row in rows], total=len(rows))


@router.get("/{task_id}", response_model=LongTaskOut)
async def long_task_detail(
    task_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> LongTaskOut:
    await _require_use(request, session_payload, settings)
    service = _service(db, settings)
    return service.public_out(service.get(task_id, owner_user_id=str(session_payload.user.id)))


@router.post("/{task_id}/cancel", response_model=LongTaskOut)
async def cancel_long_task(
    task_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> LongTaskOut:
    await _require_use(request, session_payload, settings)
    service = _service(db, settings)
    row = service.request_cancel(task_id, owner_user_id=str(session_payload.user.id))
    db.commit()
    dispatcher.cancel(task_id)
    return service.public_out(row)


@router.post("/{task_id}/retry", response_model=LongTaskOut)
async def retry_long_task(
    task_id: str,
    request: Request,
    session_payload: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
) -> LongTaskOut:
    await _require_use(request, session_payload, settings)
    service = _service(db, settings)
    row = service.retry(task_id, owner_user_id=str(session_payload.user.id))
    db.commit()
    result = service.public_out(row)
    dispatcher.enqueue(task_id)
    return result
