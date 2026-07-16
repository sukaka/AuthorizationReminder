"""7.0 Connector SDK — resilient external Agent / vendor adapters.

Publish contract for third-party and internal connectors:

* :class:`BaseConnector` — capability + health + invoke
* :class:`CircuitBreaker` / :class:`RateLimiter` / :class:`RetryPolicy`
* :func:`mask_secret` / :class:`CredentialVault` — never log raw secrets
* :class:`HttpConnector` — reference HTTP implementation

See docs/connector-sdk.md for the full publishing guide.
"""

from .base import (
    BaseConnector,
    CapabilitySpec,
    ConnectorHealth,
    ConnectorMeta,
    InvokeRequest,
    InvokeResult,
)
from .credentials import CredentialVault, mask_secret
from .http_connector import HttpConnector
from .resilience import CircuitBreaker, CircuitOpenError, RateLimiter, RetryPolicy, call_with_resilience

__all__ = [
    "BaseConnector",
    "CapabilitySpec",
    "CircuitBreaker",
    "CircuitOpenError",
    "ConnectorHealth",
    "ConnectorMeta",
    "CredentialVault",
    "HttpConnector",
    "InvokeRequest",
    "InvokeResult",
    "RateLimiter",
    "RetryPolicy",
    "call_with_resilience",
    "mask_secret",
]
