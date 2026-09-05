"""Per-request identity + tenancy context (spec §10 / §74).

``RequestContext`` is the *only* sanctioned carrier of caller identity below the
router layer. Services are constructed as ``Service(db_session, ctx)`` and must never
re-derive tenant/workspace from request bodies or query strings: an attacker-controlled
body must not be able to widen the scope of a query.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Iterable

from app.domain.enums import Role


@dataclass(frozen=True, slots=True)
class RequestContext:
    """Immutable identity/tenancy facts derived from the verified access token.

    Attributes:
        tenant_id: Organization id (top of the §74 hierarchy). Always present.
        workspace_id: Selected workspace. ``None`` only during the login /
            workspace-select flow (§58-2) and on tenant-level admin endpoints.
        user_id: Authenticated principal, or ``None`` for anonymous probes.
        roles: Effective §9 roles for ``workspace_id``.
        request_id: Correlation id echoed in ``X-Request-ID`` and bound to every log line.
    """

    tenant_id: str
    workspace_id: str | None = None
    user_id: str | None = None
    roles: frozenset[Role] = field(default_factory=frozenset)
    request_id: str = ""
    team_ids: frozenset[str] = field(default_factory=frozenset)
    ip: str | None = None
    session_ref: str | None = None

    # ---- role helpers -------------------------------------------------------
    def has_role(self, role: Role) -> bool:
        return role in self.roles

    def has_any_role(self, roles: Iterable[Role]) -> bool:
        return any(role in self.roles for role in roles)

    @property
    def is_admin(self) -> bool:
        return Role.ADMIN in self.roles

    @property
    def is_authenticated(self) -> bool:
        return self.user_id is not None

    # ---- scope helpers ------------------------------------------------------
    def require_workspace(self) -> str:
        """Return the selected workspace id, or raise if the caller has not selected one.

        Imported lazily to keep ``context`` free of a circular dependency on ``errors``.
        """
        if self.workspace_id is None:
            from app.core.errors import WorkspaceScopeRequiredError

            raise WorkspaceScopeRequiredError()
        return self.workspace_id

    def require_user(self) -> str:
        if self.user_id is None:
            from app.core.errors import UnauthenticatedError

            raise UnauthenticatedError()
        return self.user_id

    def with_workspace(self, workspace_id: str, roles: frozenset[Role]) -> RequestContext:
        """Derive a workspace-scoped context (used after workspace selection)."""
        return replace(self, workspace_id=workspace_id, roles=roles)

    # ---- logging ------------------------------------------------------------
    def log_fields(self) -> dict[str, str]:
        """Non-PII fields safe to bind to the structlog context (§49.5 / §40.2).

        Deliberately excludes e-mail, display name, IP and any free text.
        """
        fields = {"tenant_id": self.tenant_id, "request_id": self.request_id}
        if self.workspace_id:
            fields["workspace_id"] = self.workspace_id
        if self.user_id:
            fields["user_id"] = self.user_id
        return fields


def anonymous_context(request_id: str) -> RequestContext:
    """Context for unauthenticated endpoints (health probes, login)."""
    return RequestContext(tenant_id="", request_id=request_id)
