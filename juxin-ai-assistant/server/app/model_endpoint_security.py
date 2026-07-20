"""Security checks for user-configured model endpoints."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit

from fastapi import HTTPException

from .config import Settings


def _allowed_hosts(raw_hosts: str) -> set[str]:
    return {
        item.strip().lower().rstrip(".")
        for item in raw_hosts.split(",")
        if item.strip()
    }


def validate_user_model_endpoint(base_url: str, settings: Settings) -> str:
    normalized = base_url.strip().rstrip("/")
    try:
        parsed = urlsplit(normalized)
        hostname = (parsed.hostname or "").lower().rstrip(".")
        port = parsed.port
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="MODEL_ENDPOINT_INVALID") from exc
    if (
        parsed.scheme != "https"
        or not hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise HTTPException(status_code=422, detail="MODEL_ENDPOINT_INVALID")
    if settings.auth_dev_bypass:
        return normalized
    if not settings.user_model_custom_endpoint_enabled:
        raise HTTPException(status_code=403, detail="USER_MODEL_CUSTOM_ENDPOINT_DISABLED")
    if hostname not in _allowed_hosts(settings.user_model_allowed_hosts):
        raise HTTPException(status_code=403, detail="MODEL_ENDPOINT_HOST_NOT_ALLOWED")

    try:
        records = socket.getaddrinfo(hostname, port or 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise HTTPException(status_code=422, detail="MODEL_ENDPOINT_DNS_FAILED") from exc
    for record in records:
        address = record[4][0]
        try:
            parsed_address = ipaddress.ip_address(address)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="MODEL_ENDPOINT_DNS_FAILED") from exc
        if (
            parsed_address.is_private
            or parsed_address.is_loopback
            or parsed_address.is_link_local
            or parsed_address.is_reserved
            or parsed_address.is_multicast
            or parsed_address.is_unspecified
        ):
            raise HTTPException(status_code=403, detail="MODEL_ENDPOINT_PRIVATE_NETWORK")
    return normalized
