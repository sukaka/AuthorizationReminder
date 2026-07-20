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


def _validate_http_endpoint(
    base_url: str,
    *,
    enabled: bool,
    allowed_hosts: str,
    auth_dev_bypass: bool,
    disabled_detail: str,
    invalid_detail: str,
    host_not_allowed_detail: str,
    dns_failed_detail: str,
    private_network_detail: str,
) -> str:
    """Validate a configured HTTPS endpoint before persisting or connecting.

    Production deployments must opt in and provide an exact hostname allowlist.
    DNS is resolved at the point of use so private/link-local/metadata targets
    cannot be reached through a public hostname.
    """
    normalized = base_url.strip().rstrip("/")
    try:
        parsed = urlsplit(normalized)
        hostname = (parsed.hostname or "").lower().rstrip(".")
        port = parsed.port
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=invalid_detail) from exc
    if (
        parsed.scheme != "https"
        or not hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise HTTPException(status_code=422, detail=invalid_detail)
    if auth_dev_bypass:
        return normalized
    if not enabled:
        raise HTTPException(status_code=403, detail=disabled_detail)
    if hostname not in _allowed_hosts(allowed_hosts):
        raise HTTPException(status_code=403, detail=host_not_allowed_detail)

    try:
        records = socket.getaddrinfo(
            hostname,
            port or 443,
            type=socket.SOCK_STREAM,
        )
    except OSError as exc:
        raise HTTPException(status_code=422, detail=dns_failed_detail) from exc
    for record in records:
        address = record[4][0]
        try:
            parsed_address = ipaddress.ip_address(address)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=dns_failed_detail) from exc
        if (
            parsed_address.is_private
            or parsed_address.is_loopback
            or parsed_address.is_link_local
            or parsed_address.is_reserved
            or parsed_address.is_multicast
            or parsed_address.is_unspecified
            or address == "169.254.169.254"
        ):
            raise HTTPException(status_code=403, detail=private_network_detail)
    return normalized


def validate_user_model_endpoint(base_url: str, settings: Settings) -> str:
    return _validate_http_endpoint(
        base_url,
        enabled=settings.user_model_custom_endpoint_enabled,
        allowed_hosts=settings.user_model_allowed_hosts,
        auth_dev_bypass=settings.auth_dev_bypass,
        disabled_detail="USER_MODEL_CUSTOM_ENDPOINT_DISABLED",
        invalid_detail="MODEL_ENDPOINT_INVALID",
        host_not_allowed_detail="MODEL_ENDPOINT_HOST_NOT_ALLOWED",
        dns_failed_detail="MODEL_ENDPOINT_DNS_FAILED",
        private_network_detail="MODEL_ENDPOINT_PRIVATE_NETWORK",
    )


def validate_agent_http_endpoint(base_url: str, settings: Settings) -> str:
    """Validate an Agent Hub remote endpoint with the same SSRF policy."""
    return _validate_http_endpoint(
        base_url,
        enabled=settings.agent_http_endpoint_enabled,
        allowed_hosts=settings.agent_http_allowed_hosts,
        auth_dev_bypass=settings.auth_dev_bypass,
        disabled_detail="AGENT_HTTP_ENDPOINT_DISABLED",
        invalid_detail="AGENT_HTTP_ENDPOINT_INVALID",
        host_not_allowed_detail="AGENT_HTTP_ENDPOINT_HOST_NOT_ALLOWED",
        dns_failed_detail="AGENT_HTTP_ENDPOINT_DNS_FAILED",
        private_network_detail="AGENT_HTTP_ENDPOINT_PRIVATE_NETWORK",
    )
