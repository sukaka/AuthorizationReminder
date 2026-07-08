from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from ..auth import get_session, require_action
from ..config import Settings, get_settings
from ..database import get_db
from ..prompt_client import PromptCenterClient
from ..schemas import SessionPayload
from .route_common import PromptDependency, write_request_audit
from .schemas import (
    PromptBindingIn,
    TaskConfigurationIn,
    TaskAdminListOut,
    TaskAdminOut,
    TaskCreateIn,
    TaskFieldsReplaceIn,
    TaskUpdateIn,
)
from .task_admin import (
    create_task,
    delete_draft_task,
    list_tasks,
    replace_fields,
    task_out,
)
from .task_configuration import (
    update_prompt_binding,
    update_task,
    update_task_configuration,
)


def create_task_router(prompt_dependency: PromptDependency) -> APIRouter:
    router = APIRouter()

    @router.get("/admin/tasks", response_model=TaskAdminListOut)
    async def admin_list_tasks(
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> TaskAdminListOut:
        await require_action("ai_assistant:admin", request, session, settings)
        items = list_tasks(db)
        return TaskAdminListOut(items=items, total=len(items))

    @router.post("/admin/tasks", response_model=TaskAdminOut, status_code=201)
    async def admin_create_task(
        body: TaskCreateIn,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> TaskAdminOut:
        await require_action("ai_assistant:admin", request, session, settings)
        task = create_task(db, body, str(session.user.id))
        write_request_audit(
            db,
            session,
            request,
            settings,
            action="task.create",
            entity_type="task",
            entity_uuid=task.uuid,
            metadata={"task_uuid": task.uuid, "status": task.status},
        )
        db.commit()
        return task_out(db, task)

    @router.put("/admin/tasks/{task_uuid}", response_model=TaskAdminOut)
    async def admin_update_task(
        task_uuid: str,
        body: TaskUpdateIn,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        prompt_client: Annotated[
            PromptCenterClient,
            Depends(prompt_dependency),
        ],
    ) -> TaskAdminOut:
        await require_action("ai_assistant:admin", request, session, settings)
        task = await update_task(
            db,
            task_uuid,
            body,
            str(session.user.id),
            prompt_client,
        )
        write_request_audit(
            db,
            session,
            request,
            settings,
            action="task.update",
            entity_type="task",
            entity_uuid=task.uuid,
            metadata={"task_uuid": task.uuid, "status": task.status},
        )
        db.commit()
        return task_out(db, task)

    @router.put(
        "/admin/tasks/{task_uuid}/configuration",
        response_model=TaskAdminOut,
    )
    async def admin_update_task_configuration(
        task_uuid: str,
        body: TaskConfigurationIn,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        prompt_client: Annotated[
            PromptCenterClient,
            Depends(prompt_dependency),
        ],
    ) -> TaskAdminOut:
        await require_action("ai_assistant:admin", request, session, settings)
        task = await update_task_configuration(
            db,
            task_uuid,
            body,
            str(session.user.id),
            prompt_client,
        )
        write_request_audit(
            db,
            session,
            request,
            settings,
            action="task.configuration.update",
            entity_type="task",
            entity_uuid=task.uuid,
            metadata={
                "task_uuid": task.uuid,
                "status": task.status,
                "record_count": len(body.fields),
                "prompt_external_id": body.prompt_binding.prompt_external_id,
                "prompt_version": body.prompt_binding.pinned_version,
            },
        )
        db.commit()
        return task_out(db, task)

    @router.delete("/admin/tasks/{task_uuid}", status_code=204)
    async def admin_delete_task(
        task_uuid: str,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> Response:
        await require_action("ai_assistant:admin", request, session, settings)
        delete_draft_task(db, task_uuid)
        write_request_audit(
            db,
            session,
            request,
            settings,
            action="task.delete",
            entity_type="task",
            entity_uuid=task_uuid,
            metadata={"task_uuid": task_uuid},
        )
        db.commit()
        return Response(status_code=204)

    @router.put(
        "/admin/tasks/{task_uuid}/fields",
        response_model=TaskAdminOut,
    )
    async def admin_replace_fields(
        task_uuid: str,
        body: TaskFieldsReplaceIn,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> TaskAdminOut:
        await require_action("ai_assistant:admin", request, session, settings)
        task = replace_fields(db, task_uuid, body, str(session.user.id))
        write_request_audit(
            db,
            session,
            request,
            settings,
            action="task.fields.replace",
            entity_type="task",
            entity_uuid=task.uuid,
            metadata={"task_uuid": task.uuid, "record_count": len(body.fields)},
        )
        db.commit()
        return task_out(db, task)

    @router.put(
        "/admin/tasks/{task_uuid}/prompt-binding",
        response_model=TaskAdminOut,
    )
    async def admin_update_prompt_binding(
        task_uuid: str,
        body: PromptBindingIn,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        prompt_client: Annotated[
            PromptCenterClient,
            Depends(prompt_dependency),
        ],
    ) -> TaskAdminOut:
        await require_action("ai_assistant:admin", request, session, settings)
        task = await update_prompt_binding(
            db,
            task_uuid,
            body,
            str(session.user.id),
            prompt_client,
        )
        write_request_audit(
            db,
            session,
            request,
            settings,
            action="task.prompt_binding.update",
            entity_type="task",
            entity_uuid=task.uuid,
            metadata={
                "task_uuid": task.uuid,
                "prompt_external_id": body.prompt_external_id,
                "prompt_version": body.pinned_version,
                "status": body.status,
            },
        )
        db.commit()
        return task_out(db, task)

    return router
