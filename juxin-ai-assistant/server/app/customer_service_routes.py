"""Signed API for integrating third-party customer-service systems."""

from __future__ import annotations

import json
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .customer_service_security import (
    CREDENTIAL_HEADER,
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
    CustomerServiceSignatureError,
    resolve_customer_service_credential,
    verify_customer_service_signature,
)
from .customer_service_service import (
    CustomerServiceResult,
    answer_customer_service_message,
    get_customer_service_result,
)
from .database import get_db
from .external_answer_safety import MAX_EXTERNAL_QUESTION_CHARS


router = APIRouter(prefix="/api/ai/customer-service/v1", tags=["customer-service-api"])


class CustomerServiceMessageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message_id: str = Field(min_length=1, max_length=96)
    conversation_id: str = Field(min_length=1, max_length=128)
    customer_id: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=MAX_EXTERNAL_QUESTION_CHARS)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_bounded_payload(self) -> "CustomerServiceMessageIn":
        if not self.message.strip():
            raise ValueError("message 不能为空")
        if len(json.dumps(
            self.metadata,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")) > 8192:
            raise ValueError("metadata 不能超过 8 KiB")
        return self


class CustomerServiceSourceOut(BaseModel):
    file_uuid: str
    file_name: str


class CustomerServiceMessageOut(BaseModel):
    request_id: str
    message_id: str
    status: str
    answer: str
    sources: list[CustomerServiceSourceOut]
    handoff_required: bool
    ticket_id: str
    replayed: bool


def _response(result: CustomerServiceResult) -> CustomerServiceMessageOut:
    return CustomerServiceMessageOut(
        request_id=result.request_id,
        message_id=result.message_id,
        status=result.status,
        answer=result.answer,
        sources=[
            CustomerServiceSourceOut(
                file_uuid=item.file_uuid,
                file_name=item.file_name,
            )
            for item in result.sources
        ],
        handoff_required=result.handoff_required,
        ticket_id=result.ticket_id,
        replayed=result.replayed,
    )


def _authenticate(
    payload: dict[str, Any],
    *,
    settings: Settings,
    credential_id: str | None,
    timestamp: str | None,
    signature: str | None,
) -> str:
    if not settings.customer_service_api_enabled:
        raise HTTPException(status_code=404, detail="Not Found")
    try:
        credential = resolve_customer_service_credential(
            settings.customer_service_api_credentials,
            credential_id=credential_id,
        )
        verify_customer_service_signature(
            payload,
            timestamp_header=timestamp,
            signature_header=signature,
            secret=credential.secret,
            tolerance_seconds=(
                settings.customer_service_api_signature_tolerance_seconds
            ),
        )
    except CustomerServiceSignatureError as exc:
        raise HTTPException(
            status_code=401,
            detail="CUSTOMER_SERVICE_SIGNATURE_INVALID",
        ) from exc
    return credential.credential_id


@router.post("/messages", response_model=CustomerServiceMessageOut)
async def create_message(
    request: Request,
    body: CustomerServiceMessageIn,
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    credential_id: Annotated[str | None, Header(alias=CREDENTIAL_HEADER)] = None,
    timestamp: Annotated[str | None, Header(alias=TIMESTAMP_HEADER)] = None,
    signature: Annotated[str | None, Header(alias=SIGNATURE_HEADER)] = None,
) -> CustomerServiceMessageOut:
    raw_payload = await request.json()
    resolved_credential_id = _authenticate(
        raw_payload,
        settings=settings,
        credential_id=credential_id,
        timestamp=timestamp,
        signature=signature,
    )
    result = await answer_customer_service_message(
        db,
        settings=settings,
        credential_id=resolved_credential_id,
        message_id=body.message_id,
        conversation_id=body.conversation_id,
        customer_id=body.customer_id,
        message=body.message,
    )
    return _response(result)


@router.get(
    "/messages/{message_id}",
    response_model=CustomerServiceMessageOut,
)
def message_status(
    message_id: Annotated[str, Path(min_length=1, max_length=96)],
    settings: Annotated[Settings, Depends(get_settings)],
    db: Annotated[Session, Depends(get_db)],
    credential_id: Annotated[str | None, Header(alias=CREDENTIAL_HEADER)] = None,
    timestamp: Annotated[str | None, Header(alias=TIMESTAMP_HEADER)] = None,
    signature: Annotated[str | None, Header(alias=SIGNATURE_HEADER)] = None,
) -> CustomerServiceMessageOut:
    resolved_credential_id = _authenticate(
        {"message_id": message_id},
        settings=settings,
        credential_id=credential_id,
        timestamp=timestamp,
        signature=signature,
    )
    result = get_customer_service_result(
        db,
        settings=settings,
        credential_id=resolved_credential_id,
        message_id=message_id,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="CUSTOMER_SERVICE_MESSAGE_NOT_FOUND")
    return _response(result)
