from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from ..auth import get_session, require_action
from ..config import Settings, get_settings
from ..crypto import ContentCipher
from ..database import get_db
from ..schemas import SessionPayload
from .route_common import CipherDependency, write_request_audit
from .schemas import (
    SettingsUpdateIn,
    SuggestionCreateIn,
    SuggestionListOut,
    SuggestionOut,
    SuggestionReviewIn,
)
from .settings_service import list_settings, update_settings
from .suggestion_service import (
    create_suggestion,
    list_suggestions,
    review_suggestion,
    suggestion_out,
)


def create_governance_write_router(
    cipher_dependency: CipherDependency,
) -> APIRouter:
    router = APIRouter()

    @router.get("/admin/settings")
    async def admin_list_settings(
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> dict[str, str | int | float | bool | None]:
        await require_action("ai_assistant:admin", request, session, settings)
        return list_settings(db)

    @router.put("/admin/settings")
    async def admin_update_settings(
        body: SettingsUpdateIn,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ) -> dict[str, str | int | float | bool | None]:
        await require_action("ai_assistant:admin", request, session, settings)
        result = update_settings(db, body, str(session.user.id))
        for key in body.root:
            write_request_audit(
                db,
                session,
                request,
                settings,
                action="setting.update",
                entity_type="setting",
                entity_uuid=key,
                metadata={"setting_key": key},
            )
        db.commit()
        return result

    @router.post(
        "/suggestions",
        response_model=SuggestionOut,
        status_code=201,
    )
    async def submit_suggestion(
        body: SuggestionCreateIn,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        cipher: Annotated[ContentCipher, Depends(cipher_dependency)],
    ) -> SuggestionOut:
        await require_action(
            "ai_assistant:task:suggest",
            request,
            session,
            settings,
            resource={"department_code": body.department_code},
        )
        suggestion = create_suggestion(
            db,
            body,
            str(session.user.id),
            session.scope.managed_departments,
            cipher,
            settings.content_encryption_key_version,
        )
        write_request_audit(
            db,
            session,
            request,
            settings,
            action="suggestion.create",
            entity_type="suggestion",
            entity_uuid=suggestion.uuid,
            metadata={
                "suggestion_uuid": suggestion.uuid,
                "status": suggestion.status,
                "task_uuid": body.task_uuid,
            },
        )
        db.commit()
        return suggestion_out(
            db,
            suggestion,
            cipher,
            decrypt_content=False,
        )

    @router.get("/admin/suggestions", response_model=SuggestionListOut)
    async def admin_list_suggestions(
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        cipher: Annotated[ContentCipher, Depends(cipher_dependency)],
    ) -> SuggestionListOut:
        await require_action("ai_assistant:admin", request, session, settings)
        items = list_suggestions(db, cipher)
        return SuggestionListOut(items=items, total=len(items))

    @router.post(
        "/admin/suggestions/{suggestion_uuid}/review",
        response_model=SuggestionOut,
    )
    async def admin_review_suggestion(
        suggestion_uuid: str,
        body: SuggestionReviewIn,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        cipher: Annotated[ContentCipher, Depends(cipher_dependency)],
    ) -> SuggestionOut:
        await require_action("ai_assistant:admin", request, session, settings)
        suggestion = review_suggestion(
            db,
            suggestion_uuid,
            body,
            str(session.user.id),
            cipher,
        )
        write_request_audit(
            db,
            session,
            request,
            settings,
            action="suggestion.review",
            entity_type="suggestion",
            entity_uuid=suggestion.uuid,
            metadata={
                "suggestion_uuid": suggestion.uuid,
                "status": suggestion.status,
            },
        )
        db.commit()
        return suggestion_out(
            db,
            suggestion,
            cipher,
            decrypt_content=True,
        )

    return router
