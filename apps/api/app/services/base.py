"""`BaseService` — the shared constructor, RBAC helpers and tenancy plumbing.

Every service in this package is constructed exactly as `Service(db_session, ctx)`,
where `ctx` is `app.core.context.RequestContext` (`tenant_id`, `workspace_id`,
`user_id`, `roles`, `request_id`). That is the contract the routers rely on, so it is
implemented once here and never varied.

Two invariants live in this class:

* **Nothing crosses a tenant.** `scope()` builds the `TenantScope` every RAG call
  needs, and `assert_same_tenant()` is called on every entity a service loads.
* **RBAC is explicit.** `require_role()` raises `PermissionDeniedError` rather than
  silently returning empty results, so a missing check is a visible 403 in tests.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence
from datetime import UTC, datetime
from typing import Any

import structlog

from app.core.context import RequestContext  # assumed: app.core.context.RequestContext
from app.rag.vectorstore import TenantScope
from app.services.exceptions import PermissionDeniedError, TenantMismatchError

log = structlog.get_logger(__name__)

#: §9 RBAC roles (mirrors ROLES in packages/shared-types/src/state-machines.ts)
ROLE_TRAINEE = "trainee"
ROLE_COACH = "coach"
ROLE_MANAGER = "manager"
ROLE_ADMIN = "admin"
ROLE_REVIEWER = "reviewer"

AUTHORING_ROLES = (ROLE_COACH, ROLE_ADMIN)
REVIEW_ROLES = (ROLE_REVIEWER, ROLE_COACH, ROLE_ADMIN)
MANAGEMENT_ROLES = (ROLE_MANAGER, ROLE_ADMIN)


def utcnow() -> datetime:
    return datetime.now(UTC)


def iso_now() -> str:
    return utcnow().isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


class BaseService:
    """Common constructor + guards."""

    def __init__(self, db: Any, ctx: RequestContext) -> None:
        self.db = db
        self.ctx = ctx

    # -- context ----------------------------------------------------------
    @property
    def tenant_id(self) -> str:
        return str(getattr(self.ctx, "tenant_id", "") or "")

    @property
    def workspace_id(self) -> str:
        return str(getattr(self.ctx, "workspace_id", "") or "")

    @property
    def user_id(self) -> str:
        return str(getattr(self.ctx, "user_id", "") or "")

    @property
    def roles(self) -> tuple[str, ...]:
        raw = getattr(self.ctx, "roles", ()) or ()
        return tuple(str(role) for role in raw)

    @property
    def request_id(self) -> str:
        return str(getattr(self.ctx, "request_id", "") or "")

    # -- RBAC -------------------------------------------------------------
    def has_role(self, *roles: str) -> bool:
        return bool(set(roles) & set(self.roles))

    def require_role(self, *roles: str, action: str = "") -> None:
        if not self.has_role(*roles):
            raise PermissionDeniedError(
                f"role {sorted(self.roles)} may not {action or 'perform this action'}; "
                f"requires one of {sorted(roles)}"
            )

    def require_self_or_role(self, user_id: str, *roles: str, action: str = "") -> None:
        """Trainees may read their own data; coaches/managers may read their team's."""
        if user_id and user_id == self.user_id:
            return
        self.require_role(*roles, action=action)

    # -- tenancy ----------------------------------------------------------
    def assert_same_tenant(self, entity: Any, *, resource: str = "resource") -> None:
        """Refuse to operate on anything from another tenant/workspace (§10/§74)."""
        if entity is None:
            return
        tenant = _attr(entity, "tenant_id")
        workspace = _attr(entity, "workspace_id")
        if tenant is not None and str(tenant) != self.tenant_id:
            raise TenantMismatchError(f"{resource} belongs to another tenant")
        if workspace is not None and str(workspace) != self.workspace_id:
            raise TenantMismatchError(f"{resource} belongs to another workspace")

    def scope(
        self,
        knowledge_base_ids: Sequence[str] = (),
        *,
        acl_subject_ids: Sequence[str] | None = None,
        metadata_filter: dict[str, Any] | None = None,
    ) -> TenantScope:
        """Build the mandatory vector-store scope for this request."""
        return TenantScope(
            tenant_id=self.tenant_id,
            workspace_id=self.workspace_id,
            knowledge_base_ids=tuple(knowledge_base_ids),
            acl_subject_ids=tuple(
                acl_subject_ids if acl_subject_ids is not None else self.acl_subjects()
            ),
            metadata_filter=dict(metadata_filter or {}),
        )

    def acl_subjects(self) -> tuple[str, ...]:
        """Subject ids this caller holds, for §39 knowledge ACL matching."""
        subjects: list[str] = [self.user_id, self.workspace_id, self.tenant_id, *self.roles]
        for attribute in ("team_ids", "department_ids", "group_ids"):
            values = getattr(self.ctx, attribute, None) or ()
            subjects.extend(str(value) for value in values)
        return tuple(dict.fromkeys(s for s in subjects if s))

    def owned_fields(self) -> dict[str, Any]:
        """Tenant columns every created row must carry (§10)."""
        return {
            "tenant_id": self.tenant_id,
            "workspace_id": self.workspace_id,
        }

    # -- audit ------------------------------------------------------------
    def audit(
        self,
        action: str,
        resource: str,
        *,
        result: str = "success",
        risk: str = "safe",
        **extra: Any,
    ) -> dict[str, Any]:
        """Build an `AuditEvent`-shaped record (§42) and log it.

        Persisting it is the API-platform module's job (`app.db`); returning the dict
        keeps this layer testable and lets the caller decide on the write.
        """
        event = {
            "id": new_id("ae"),
            "tenant_id": self.tenant_id,
            "workspace_id": self.workspace_id,
            "at": iso_now(),
            "user_id": self.user_id,
            "action": action,
            "resource": resource,
            "session_ref": self.request_id,
            "result": result,
            "risk": risk,
            **extra,
        }
        log.info("audit", **event)
        return event


def _attr(entity: Any, name: str) -> Any:
    if isinstance(entity, dict):
        return entity.get(name)
    return getattr(entity, name, None)


def first(items: Iterable[Any]) -> Any | None:
    for item in items:
        return item
    return None


__all__ = [
    "AUTHORING_ROLES",
    "MANAGEMENT_ROLES",
    "REVIEW_ROLES",
    "ROLE_ADMIN",
    "ROLE_COACH",
    "ROLE_MANAGER",
    "ROLE_REVIEWER",
    "ROLE_TRAINEE",
    "BaseService",
    "first",
    "iso_now",
    "new_id",
    "utcnow",
]
