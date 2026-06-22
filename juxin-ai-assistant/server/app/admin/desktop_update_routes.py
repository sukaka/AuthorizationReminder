from typing import Annotated

from fastapi import APIRouter, Depends, Form, Request, UploadFile
from sqlalchemy.orm import Session

from ..auth import get_session, require_action
from ..config import Settings, get_settings
from ..database import get_db
from ..schemas import SessionPayload
from .desktop_update_service import (
    create_release,
    get_artifacts,
    get_release,
    list_releases,
    publish_release,
    store_artifact,
    withdraw_release,
)
from .route_common import write_request_audit
from .schemas import (
    DesktopUpdateCreateIn,
    DesktopUpdateReleaseDetailOut,
    DesktopUpdateReleaseOut,
)


def create_desktop_update_admin_router() -> APIRouter:
    router = APIRouter(prefix="/admin/desktop-updates", tags=["desktop-updates"])

    @router.post("", status_code=201)
    async def admin_create_release(
        body: DesktopUpdateCreateIn,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ):
        await require_action("ai_assistant:admin", request, session, settings)
        release = create_release(
            db,
            body.agent_version,
            body.channel,
            body.release_notes,
            str(session.user.id),
        )
        write_request_audit(
            db,
            session,
            request,
            settings,
            action="desktop_update.create",
            entity_type="desktop_update_release",
            entity_id=release.uuid,
        )
        db.commit()
        return DesktopUpdateReleaseOut.model_validate(release).model_dump()

    @router.get("")
    async def admin_list_releases(
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
        channel: str | None = None,
    ):
        await require_action("ai_assistant:admin", request, session, settings)
        releases = list_releases(db, channel=channel)
        return [
            DesktopUpdateReleaseDetailOut(
                uuid=r.uuid,
                agent_version=r.agent_version,
                channel=r.channel,
                status=r.status,
                release_notes=r.release_notes,
                created_by=r.created_by,
                created_at=r.created_at,
                published_at=r.published_at,
                withdrawn_at=r.withdrawn_at,
                artifacts=[
                    {
                        "target": a.target,
                        "file_name": a.file_name,
                        "content_type": a.content_type,
                        "size_bytes": a.size_bytes,
                        "sha256": a.sha256,
                        "created_at": a.created_at,
                    }
                    for a in get_artifacts(db, r.id)
                ],
            ).model_dump()
            for r in releases
        ]

    @router.post("/{release_uuid}/artifacts", status_code=201)
    async def admin_upload_artifact(
        release_uuid: str,
        target: Annotated[str, Form()],
        sha256: Annotated[str, Form()],
        signature: Annotated[str, Form()],
        file: UploadFile,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ):
        await require_action("ai_assistant:admin", request, session, settings)
        artifact = await store_artifact(
            db,
            release_uuid,
            target,
            sha256,
            signature,
            file,
            settings,
        )
        write_request_audit(
            db,
            session,
            request,
            settings,
            action="desktop_update.upload",
            entity_type="desktop_update_release",
            entity_id=release_uuid,
        )
        db.commit()
        return {
            "target": artifact.target,
            "file_name": artifact.file_name,
            "size_bytes": artifact.size_bytes,
            "sha256": artifact.sha256,
        }

    @router.post("/{release_uuid}/publish")
    async def admin_publish_release(
        release_uuid: str,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ):
        await require_action("ai_assistant:admin", request, session, settings)
        release = publish_release(db, release_uuid)
        write_request_audit(
            db,
            session,
            request,
            settings,
            action="desktop_update.publish",
            entity_type="desktop_update_release",
            entity_id=release_uuid,
        )
        db.commit()
        return DesktopUpdateReleaseOut.model_validate(release).model_dump()

    @router.post("/{release_uuid}/withdraw")
    async def admin_withdraw_release(
        release_uuid: str,
        request: Request,
        session: Annotated[SessionPayload, Depends(get_session)],
        settings: Annotated[Settings, Depends(get_settings)],
        db: Annotated[Session, Depends(get_db)],
    ):
        await require_action("ai_assistant:admin", request, session, settings)
        release = withdraw_release(db, release_uuid)
        write_request_audit(
            db,
            session,
            request,
            settings,
            action="desktop_update.withdraw",
            entity_type="desktop_update_release",
            entity_id=release_uuid,
        )
        db.commit()
        return DesktopUpdateReleaseOut.model_validate(release).model_dump()

    return router
