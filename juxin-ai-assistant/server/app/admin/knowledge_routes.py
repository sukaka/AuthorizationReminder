from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from ..auth import get_session, require_action
from ..config import Settings, get_settings
from ..crypto import ContentCipher
from ..database import get_db
from ..schemas import SessionPayload
from .knowledge_admin import (
    create_knowledge,
    disable_knowledge,
    get_knowledge_detail,
    knowledge_out,
    list_knowledge,
    update_knowledge,
)
from .route_common import CipherDependency, write_request_audit
from .schemas import (
    KnowledgeCreateIn,
    KnowledgeListOut,
    KnowledgeOut,
    KnowledgeUpdateIn,
)


def create_knowledge_router(cipher_dependency: CipherDependency) -> APIRouter:
    router = APIRouter()

    @router.get("/admin/knowledge", response_model=KnowledgeListOut)
    async def admin_list_knowledge(
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> KnowledgeListOut:
        await require_action("ai_assistant:admin", request, session, settings)
        items = list_knowledge(db)
        return KnowledgeListOut(items=items, total=len(items))

    @router.post(
        "/admin/knowledge",
        response_model=KnowledgeOut,
        status_code=201,
    )
    async def admin_create_knowledge(
        body: KnowledgeCreateIn,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        cipher: Annotated[ContentCipher, Depends(cipher_dependency)],
    ) -> KnowledgeOut:
        await require_action("ai_assistant:admin", request, session, settings)
        item = create_knowledge(
            db,
            body,
            str(session.user.id),
            cipher,
            settings.content_encryption_key_version,
        )
        write_request_audit(
            db,
            session,
            request,
            settings,
            action="knowledge.create",
            entity_type="knowledge",
            entity_uuid=item.uuid,
            metadata={"record_count": len(body.task_uuids), "status": item.status},
        )
        db.commit()
        return knowledge_out(db, item)

    @router.get(
        "/admin/knowledge/{knowledge_uuid}",
        response_model=KnowledgeOut,
    )
    async def admin_get_knowledge(
        knowledge_uuid: str,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        cipher: Annotated[ContentCipher, Depends(cipher_dependency)],
    ) -> KnowledgeOut:
        await require_action("ai_assistant:admin", request, session, settings)
        return get_knowledge_detail(db, knowledge_uuid, cipher)

    @router.put(
        "/admin/knowledge/{knowledge_uuid}",
        response_model=KnowledgeOut,
    )
    async def admin_update_knowledge(
        knowledge_uuid: str,
        body: KnowledgeUpdateIn,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        cipher: Annotated[ContentCipher, Depends(cipher_dependency)],
    ) -> KnowledgeOut:
        await require_action("ai_assistant:admin", request, session, settings)
        item = update_knowledge(
            db,
            knowledge_uuid,
            body,
            str(session.user.id),
            cipher,
            settings.content_encryption_key_version,
        )
        write_request_audit(
            db,
            session,
            request,
            settings,
            action="knowledge.update",
            entity_type="knowledge",
            entity_uuid=item.uuid,
            metadata={"status": item.status},
        )
        db.commit()
        return knowledge_out(db, item)

    @router.delete("/admin/knowledge/{knowledge_uuid}", status_code=204)
    async def admin_disable_knowledge(
        knowledge_uuid: str,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> Response:
        await require_action("ai_assistant:admin", request, session, settings)
        item = disable_knowledge(db, knowledge_uuid, str(session.user.id))
        write_request_audit(
            db,
            session,
            request,
            settings,
            action="knowledge.disable",
            entity_type="knowledge",
            entity_uuid=item.uuid,
            metadata={"status": item.status},
        )
        db.commit()
        return Response(status_code=204)

    return router
