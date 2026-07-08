from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_user, require_action
from ..config import get_settings
from ..database import get_db
from ..devops_service import devops_dashboard, record_devops_event
from ..models import DevopsScanEvent
from ..schemas import (
    DevopsDashboardOut,
    DevopsEventListOut,
    DevopsEventOut,
    DevopsWebhookIn,
    UserPayload,
)
from ..webhook_security import verify_webhook_request

router = APIRouter(prefix="/api/sca/devops", tags=["devsecops"])


async def _record_webhook(request: Request, payload: DevopsWebhookIn, db: Session, platform: str, source: str) -> DevopsScanEvent:
    current_settings = get_settings()
    await verify_webhook_request(request, platform, current_settings)
    event = record_devops_event(db, {**payload.model_dump(), "source": source}, current_settings)
    db.commit()
    db.refresh(event)
    return event


@router.post("/webhooks/gitlab", response_model=DevopsEventOut)
async def gitlab_webhook(
    request: Request,
    payload: DevopsWebhookIn,
    db: Annotated[Session, Depends(get_db)],
) -> DevopsEventOut:
    return await _record_webhook(request, payload, db, "gitlab", "gitlab")


@router.post("/webhooks/github", response_model=DevopsEventOut)
async def github_actions_webhook(
    request: Request,
    payload: DevopsWebhookIn,
    db: Annotated[Session, Depends(get_db)],
) -> DevopsEventOut:
    return await _record_webhook(request, payload, db, "github", "github-actions")


@router.post("/webhooks/jenkins", response_model=DevopsEventOut)
async def jenkins_webhook(
    request: Request,
    payload: DevopsWebhookIn,
    db: Annotated[Session, Depends(get_db)],
) -> DevopsEventOut:
    return await _record_webhook(request, payload, db, "jenkins", "jenkins")


@router.get("/events", response_model=DevopsEventListOut)
async def list_devops_events(
    request: Request,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> DevopsEventListOut:
    await require_action("sca:read", request, user, get_settings())
    items = list(db.scalars(select(DevopsScanEvent).order_by(DevopsScanEvent.created_at.desc()).limit(100)))
    return DevopsEventListOut(total=len(items), items=items)


@router.get("/dashboard", response_model=DevopsDashboardOut)
async def devops_dashboard_api(
    request: Request,
    user: Annotated[UserPayload, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> DevopsDashboardOut:
    await require_action("sca:read", request, user, get_settings())
    return DevopsDashboardOut(**devops_dashboard(list(db.scalars(select(DevopsScanEvent)))))
