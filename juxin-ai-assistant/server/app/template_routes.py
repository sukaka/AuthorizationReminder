"""List enterprise document templates for product UI."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from .auth import get_session, require_action
from .config import Settings, get_settings
from .document_templates.registry import list_document_templates
from .schemas import SessionPayload

router = APIRouter(prefix="/api/ai/document-templates", tags=["document-templates"])


class TemplateItem(BaseModel):
    code: str
    name: str


class TemplateListOut(BaseModel):
    items: list[TemplateItem]
    total: int


@router.get("", response_model=TemplateListOut)
async def get_templates(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> TemplateListOut:
    await require_action("ai_assistant:use", request, session, settings)
    items = [TemplateItem(**row) for row in list_document_templates()]
    return TemplateListOut(items=items, total=len(items))
