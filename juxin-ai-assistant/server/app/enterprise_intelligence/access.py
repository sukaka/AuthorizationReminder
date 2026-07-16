from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256

from ..schemas import SessionPayload


_ADMIN_ROLES = frozenset({"admin", "superadmin", "sys_admin", "platform_admin"})
_EXTERNAL_ROLES = frozenset(
    {"external", "external_customer", "customer", "visitor", "guest"}
)


@dataclass(frozen=True)
class EnterpriseAccessScope:
    """Stable, request-local view of the enterprise access contract."""

    user_id: str
    username: str
    role: str
    department: str | None
    managed_departments: tuple[str, ...]
    is_admin: bool
    is_external: bool
    capabilities: frozenset[str]
    policy_version: str = "enterprise-scope-v1"

    @classmethod
    def from_session(cls, session: SessionPayload) -> "EnterpriseAccessScope":
        role = str(session.user.role or "").strip().lower() or "employee"
        is_admin = role in _ADMIN_ROLES
        is_external = role in _EXTERNAL_ROLES
        capabilities = {"assistant:use"}
        if not is_external:
            capabilities.add("intelligence:view")
        if is_admin:
            capabilities.update(
                {
                    "intelligence:manage",
                    "intelligence:admin",
                    "intelligence:insight:read",
                    "intelligence:insight:manage",
                    "intelligence:recommendation:execute",
                    "intelligence:capability:read",
                    "intelligence:capability:propose",
                    "intelligence:capability:review",
                }
            )
        department = session.scope.department
        managed = tuple(
            dict.fromkeys(
                item.strip()
                for item in [department, *session.scope.managed_departments]
                if isinstance(item, str) and item.strip()
            )
        )
        return cls(
            user_id=str(session.user.id),
            username=session.user.username,
            role=role,
            department=department,
            managed_departments=managed,
            is_admin=is_admin,
            is_external=is_external,
            capabilities=frozenset(capabilities),
        )

    def can(self, capability: str) -> bool:
        return capability in self.capabilities

    @property
    def scope_fingerprint(self) -> str:
        payload = "|".join(
            [
                self.policy_version,
                self.user_id,
                self.role,
                self.department or "",
                ",".join(self.managed_departments),
                "admin" if self.is_admin else "user",
            ]
        )
        return sha256(payload.encode("utf-8")).hexdigest()

    def as_dict(self) -> dict[str, object]:
        return {
            "user_id": self.user_id,
            "role": self.role,
            "department": self.department,
            "managed_departments": list(self.managed_departments),
            "is_admin": self.is_admin,
            "is_external": self.is_external,
            "capabilities": sorted(self.capabilities),
            "policy_version": self.policy_version,
            "scope_fingerprint": self.scope_fingerprint,
        }
