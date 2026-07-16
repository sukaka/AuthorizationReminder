"""HTTP surface for 7.0 channel gateway (normalize + echo for integration tests)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from .auth import get_session, require_action
from .channel_gateway import ChannelReply, get_channel_gateway
from .config import Settings, get_settings
from .schemas import SessionPayload

router = APIRouter(prefix="/api/ai/channels", tags=["channels"])


class NormalizeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    channel: str = Field(..., min_length=1, max_length=32)
    payload: dict[str, Any] = Field(default_factory=dict)


class NormalizeOut(BaseModel):
    ok: bool
    channel: str = ""
    external_user_id: str = ""
    text: str = ""
    thread_id: str = ""
    error: str = ""


class RenderIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    channel: str = Field(..., min_length=1, max_length=32)
    text: str = Field(..., min_length=1, max_length=50_000)
    cards: list[dict[str, Any]] = Field(default_factory=list)


@router.get("")
async def list_channels(
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    gw = get_channel_gateway()
    return {"channels": gw.list_channels()}


@router.post("/normalize", response_model=NormalizeOut)
async def normalize_message(
    body: NormalizeIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> NormalizeOut:
    await require_action("ai_assistant:use", request, session, settings)
    gw = get_channel_gateway()
    if gw.get(body.channel) is None:
        raise HTTPException(status_code=400, detail="unknown_channel")
    msg = gw.normalize(body.channel, body.payload)
    if msg is None:
        return NormalizeOut(ok=False, channel=body.channel, error="parse_failed")
    return NormalizeOut(
        ok=True,
        channel=msg.channel,
        external_user_id=msg.external_user_id,
        text=msg.text,
        thread_id=msg.thread_id,
    )


@router.post("/render")
async def render_reply(
    body: RenderIn,
    request: Request,
    session: Annotated[SessionPayload, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    await require_action("ai_assistant:use", request, session, settings)
    gw = get_channel_gateway()
    if gw.get(body.channel) is None:
        raise HTTPException(status_code=400, detail="unknown_channel")
    return gw.render(body.channel, ChannelReply(text=body.text, cards=body.cards))
