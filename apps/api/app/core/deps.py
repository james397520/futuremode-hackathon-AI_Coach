"""FastAPI dependencies: session, context, RBAC and workspace scope (spec §9 / §73 / §74).

Dependency order (each builds on the previous)::

    get_db ──────────────► AsyncSession, one transaction per request
    get_context ─────────► RequestContext from the token (+ CSRF on writes)
    get_workspace_scope ─► TenantScope, and installs the §74 query guard on the session
    get_repository ──────► ScopedRepository — the only sanctioned read path
    provide_service(X) ──► X(db_session, ctx) — the service contract

RBAC (§9)
---------
Roles are coarse; permissions are fine. A router declares the *permission* it needs,
never the role, so the matrix below is the single place the §9 lists are encoded.

===============================  ========================================
Role                             Highlights (full matrix: ROLE_PERMISSIONS)
===============================  ========================================
``trainee`` (§9.1)               run assigned training, review own results
``coach`` (§9.2)                 author scenario/persona/rubric/questions,
                                 review transcripts, override scores,
                                 read persona hidden state
``manager`` (§9.3)               assign training, team benchmark, exports
``admin`` (§9.4)                 workspace/user/role/SSO/model/security/audit
``reviewer`` (§9.5)              triage flagged sessions, approve rubric and
                                 compliance rules, close findings
===============================  ========================================
"""

from __future__ import annotations

from enum import StrEnum
from typing import TYPE_CHECKING, Annotated, TypeVar

import structlog
from fastapi import Depends, Request, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditRecorder
from app.core.config import Settings, get_settings
from app.core.context import RequestContext
from app.core.errors import (
    CsrfError,
    PermissionDeniedError,
    UnauthenticatedError,
)
from app.core.security import CSRF_HEADER_NAME, TokenClaims, verify_access_token
from app.core.tenancy import ScopedRepository, TenantScope, install_tenant_guard, scope_from_context
from app.db.session import get_sessionmaker
from app.domain.enums import Role

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable, Iterable

logger = structlog.get_logger(__name__)

#: HTTP methods that mutate state and therefore require CSRF + audit + rate limiting.
UNSAFE_METHODS: frozenset[str] = frozenset({"POST", "PUT", "PATCH", "DELETE"})


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


class Permission(StrEnum):
    """Fine-grained capabilities referenced by routers."""

    # --- shared, any authenticated member of a workspace ---
    WORKSPACE_READ = "workspace.read"
    SEARCH_READ = "search.read"
    RUNTIME_READ = "runtime.read"
    RUNTIME_TELEMETRY_WRITE = "runtime.telemetry.write"

    # --- §9.1 trainee ---
    ASSIGNMENT_VIEW_ASSIGNED = "assignment.view_assigned"
    SESSION_START = "session.start"
    SESSION_PARTICIPATE = "session.participate"
    SESSION_RETRY = "session.retry"
    RESULT_VIEW_OWN = "result.view_own"
    MATERIAL_VIEW_ASSIGNED = "material.view_assigned"
    PROGRESS_VIEW_OWN = "progress.view_own"

    # --- §9.2 coach ---
    SCENARIO_READ = "scenario.read"
    SCENARIO_WRITE = "scenario.write"
    PERSONA_READ = "persona.read"
    PERSONA_WRITE = "persona.write"
    PERSONA_READ_HIDDEN = "persona.read_hidden"
    RUBRIC_READ = "rubric.read"
    RUBRIC_WRITE = "rubric.write"
    QUESTION_READ = "question.read"
    QUESTION_WRITE = "question.write"
    KNOWLEDGE_READ = "knowledge.read"
    KNOWLEDGE_WRITE = "knowledge.write"
    RETRIEVAL_TEST = "retrieval.test"
    TRANSCRIPT_REVIEW = "transcript.review"
    EVALUATION_OVERRIDE = "evaluation.override"
    COACHING_NOTE_WRITE = "coaching_note.write"
    CONTENT_PUBLISH = "content.publish"
    SESSION_READ_ANY = "session.read_any"

    # --- §9.3 manager ---
    ASSIGNMENT_WRITE = "assignment.write"
    ASSIGNMENT_SET_CRITERIA = "assignment.set_criteria"
    TEAM_READ = "team.read"
    TEAM_REVIEW = "team.review"
    TEAM_BENCHMARK = "team.benchmark"
    RISK_VIEW = "risk.view"
    COMMENT_WRITE = "comment.write"
    REPORT_READ = "report.read"
    REPORT_EXPORT = "report.export"
    USER_READ = "user.read"

    # --- §9.4 admin ---
    WORKSPACE_ADMIN = "workspace.admin"
    USER_ADMIN = "user.admin"
    TEAM_ADMIN = "team.admin"
    ROLE_ADMIN = "role.admin"
    SSO_ADMIN = "sso.admin"
    KNOWLEDGE_ACL_ADMIN = "knowledge.acl.admin"
    MODEL_ADMIN = "model.admin"
    VECTOR_ADMIN = "vector.admin"
    INTEGRATION_ADMIN = "integration.admin"
    SECURITY_ADMIN = "security.admin"
    AUDIT_READ = "audit.read"
    RETENTION_ADMIN = "retention.admin"
    BILLING_ADMIN = "billing.admin"
    RUNTIME_POLICY_WRITE = "runtime.policy.write"

    # --- §9.5 reviewer / compliance officer ---
    SESSION_REVIEW_FLAGGED = "session.review_flagged"
    COMPLIANCE_REVIEW = "compliance.review"
    RUBRIC_APPROVE = "rubric.approve"
    COMPLIANCE_RULE_APPROVE = "compliance_rule.approve"
    FINDING_CLOSE = "finding.close"


#: Granted to every authenticated caller inside a workspace.
_BASE: frozenset[Permission] = frozenset(
    {
        Permission.WORKSPACE_READ,
        Permission.SEARCH_READ,
        Permission.RUNTIME_READ,
        Permission.RUNTIME_TELEMETRY_WRITE,
    }
)

_TRAINEE: frozenset[Permission] = _BASE | {
    Permission.ASSIGNMENT_VIEW_ASSIGNED,
    Permission.SESSION_START,
    Permission.SESSION_PARTICIPATE,
    Permission.SESSION_RETRY,
    Permission.RESULT_VIEW_OWN,
    Permission.MATERIAL_VIEW_ASSIGNED,
    Permission.PROGRESS_VIEW_OWN,
}

_COACH: frozenset[Permission] = _TRAINEE | {
    Permission.SCENARIO_READ,
    Permission.SCENARIO_WRITE,
    Permission.PERSONA_READ,
    Permission.PERSONA_WRITE,
    Permission.PERSONA_READ_HIDDEN,
    Permission.RUBRIC_READ,
    Permission.RUBRIC_WRITE,
    Permission.QUESTION_READ,
    Permission.QUESTION_WRITE,
    Permission.KNOWLEDGE_READ,
    Permission.KNOWLEDGE_WRITE,
    Permission.RETRIEVAL_TEST,
    Permission.TRANSCRIPT_REVIEW,
    Permission.EVALUATION_OVERRIDE,
    Permission.COACHING_NOTE_WRITE,
    Permission.CONTENT_PUBLISH,
    Permission.SESSION_READ_ANY,
    Permission.REPORT_READ,
    Permission.TEAM_READ,
    Permission.USER_READ,
}

_MANAGER: frozenset[Permission] = _BASE | {
    Permission.ASSIGNMENT_VIEW_ASSIGNED,
    Permission.ASSIGNMENT_WRITE,
    Permission.ASSIGNMENT_SET_CRITERIA,
    Permission.TEAM_READ,
    Permission.TEAM_REVIEW,
    Permission.TEAM_BENCHMARK,
    Permission.RISK_VIEW,
    Permission.COMMENT_WRITE,
    Permission.REPORT_READ,
    Permission.REPORT_EXPORT,
    Permission.USER_READ,
    Permission.SCENARIO_READ,
    Permission.PERSONA_READ,
    Permission.QUESTION_READ,
    Permission.KNOWLEDGE_READ,
    Permission.RUBRIC_READ,
    Permission.SESSION_READ_ANY,
    Permission.TRANSCRIPT_REVIEW,
    Permission.RESULT_VIEW_OWN,
    Permission.PROGRESS_VIEW_OWN,
}

_REVIEWER: frozenset[Permission] = _BASE | {
    Permission.SESSION_REVIEW_FLAGGED,
    Permission.SESSION_READ_ANY,
    Permission.COMPLIANCE_REVIEW,
    Permission.RUBRIC_APPROVE,
    Permission.RUBRIC_READ,
    Permission.COMPLIANCE_RULE_APPROVE,
    Permission.FINDING_CLOSE,
    Permission.AUDIT_READ,
    Permission.TRANSCRIPT_REVIEW,
    Permission.REPORT_READ,
    Permission.RISK_VIEW,
    Permission.SCENARIO_READ,
    Permission.PERSONA_READ,
    Permission.KNOWLEDGE_READ,
    Permission.QUESTION_READ,
}

#: Admin holds every permission — §9.4 is defined as full workspace control.
_ADMIN: frozenset[Permission] = frozenset(Permission)

ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.TRAINEE: _TRAINEE,
    Role.COACH: _COACH,
    Role.MANAGER: _MANAGER,
    Role.ADMIN: _ADMIN,
    Role.REVIEWER: _REVIEWER,
}


def permissions_for(roles: Iterable[Role]) -> frozenset[Permission]:
    """Union of the permissions granted by ``roles``."""
    granted: set[Permission] = set()
    for role in roles:
        granted |= ROLE_PERMISSIONS.get(role, frozenset())
    return frozenset(granted)


def has_permission(ctx: RequestContext, permission: Permission) -> bool:
    """Pure check, usable inside services for object-level decisions."""
    return permission in permissions_for(ctx.roles)


# ---------------------------------------------------------------------------
# Database session
# ---------------------------------------------------------------------------


async def get_db() -> AsyncIterator[AsyncSession]:
    """One transaction per request: commit on success, roll back on any exception."""
    factory = get_sessionmaker()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except BaseException:
            await session.rollback()
            raise


DbSession = Annotated[AsyncSession, Depends(get_db)]


# ---------------------------------------------------------------------------
# Authentication / context
# ---------------------------------------------------------------------------


def _extract_token(request: Request, settings: Settings) -> tuple[str | None, bool]:
    """Return ``(token, from_cookie)``.

    A bearer header is accepted for service-to-service calls; browsers use the
    HttpOnly cookie, and only the cookie path requires CSRF (§73).
    """
    authorization = request.headers.get("Authorization", "")
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None, False
    cookie = request.cookies.get(settings.session_cookie_name)
    return (cookie or None), True


def _verify_csrf(request: Request, claims: TokenClaims, settings: Settings) -> None:
    """Double-submit CSRF check for cookie-authenticated mutating requests."""
    from app.core.security import verify_csrf_pair

    if request.method not in UNSAFE_METHODS:
        return
    if not verify_csrf_pair(
        cookie_token=request.cookies.get(settings.csrf_cookie_name),
        header_token=request.headers.get(CSRF_HEADER_NAME),
        jti=claims.jti,
        settings=settings,
    ):
        logger.warning("csrf_rejected", path=request.url.path, method=request.method)
        raise CsrfError()


async def get_context(request: Request) -> RequestContext:
    """Resolve the caller's :class:`RequestContext` from the verified access token.

    Also enforces CSRF on cookie-authenticated writes and re-binds the log context so
    every subsequent log line in this request carries tenant/user/request ids.
    """
    settings = get_settings()
    token, from_cookie = _extract_token(request, settings)
    if not token:
        raise UnauthenticatedError()

    claims = verify_access_token(token, settings=settings)
    if from_cookie:
        _verify_csrf(request, claims, settings)

    ctx = RequestContext(
        tenant_id=claims.tid,
        workspace_id=claims.wid,
        user_id=claims.sub,
        roles=frozenset(claims.rls),
        request_id=str(getattr(request.state, "request_id", "") or ""),
        team_ids=frozenset(claims.tms),
        ip=request.client.host if request.client else None,
        session_ref=claims.jti,
    )
    request.state.context = ctx

    from app.core.logging import bind_request_context

    bind_request_context(ctx)
    return ctx


Ctx = Annotated[RequestContext, Depends(get_context)]


async def get_optional_context(request: Request) -> RequestContext | None:
    """Context when a token is present, otherwise ``None`` (public endpoints)."""
    try:
        return await get_context(request)
    except UnauthenticatedError:
        return None


OptionalCtx = Annotated[RequestContext | None, Depends(get_optional_context)]


# ---------------------------------------------------------------------------
# RBAC dependencies
# ---------------------------------------------------------------------------


async def get_ws_context(websocket: WebSocket) -> RequestContext:
    """Resolve the context for a WebSocket upgrade (§68).

    Differences from the HTTP path, both deliberate:

    * **No CSRF token.** There is no CSRF check because there is no cross-site *write*
      to protect: instead the ``Origin`` header is validated against the configured
      allowlist. Browsers do **not** apply the same-origin policy to WebSockets, so
      without this check any site could open an authenticated socket.
    * **No query-string token.** A token in the URL would end up in access logs and
      proxy history; only the ``HttpOnly`` cookie (or an explicit ``Authorization``
      header for service clients) is accepted.
    """
    settings = get_settings()
    origin = websocket.headers.get("origin")
    if origin is not None and origin not in settings.cors_allow_origins:
        logger.warning("ws_origin_rejected", origin=origin)
        raise PermissionDeniedError("This origin may not open a session socket.")

    authorization = websocket.headers.get("Authorization", "")
    if authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    else:
        token = websocket.cookies.get(settings.session_cookie_name, "")
    if not token:
        raise UnauthenticatedError()

    claims = verify_access_token(token, settings=settings)
    ctx = RequestContext(
        tenant_id=claims.tid,
        workspace_id=claims.wid,
        user_id=claims.sub,
        roles=frozenset(claims.rls),
        request_id=str(websocket.headers.get("x-request-id", "") or ""),
        team_ids=frozenset(claims.tms),
        ip=websocket.client.host if websocket.client else None,
        session_ref=claims.jti,
    )

    from app.core.logging import bind_request_context

    bind_request_context(ctx)
    return ctx


WsCtx = Annotated[RequestContext, Depends(get_ws_context)]


def require_roles(*roles: Role) -> Callable[[RequestContext], RequestContext]:
    """Dependency factory: caller must hold at least one of ``roles``.

    Prefer :func:`require_permission`; use this only where the spec names a role
    directly (``/security`` and ``/audit`` are admin/reviewer surfaces, §41/§42).
    """
    allowed = frozenset(roles)

    def dependency(ctx: Ctx) -> RequestContext:
        if not ctx.is_authenticated:
            raise UnauthenticatedError()
        if not ctx.has_any_role(allowed):
            logger.warning(
                "rbac_role_denied",
                required=sorted(role.value for role in allowed),
                held=sorted(role.value for role in ctx.roles),
            )
            raise PermissionDeniedError(
                "This action requires one of: "
                + ", ".join(sorted(role.value for role in allowed))
                + "."
            )
        return ctx

    return dependency


def require_permission(
    *permissions: Permission, require_all: bool = True
) -> Callable[[RequestContext], RequestContext]:
    """Dependency factory implementing the §9 matrix.

    Args:
        permissions: Permissions the caller must hold.
        require_all: ``True`` (default) demands every permission; ``False`` accepts any.
    """
    required = frozenset(permissions)

    def dependency(ctx: Ctx) -> RequestContext:
        if not ctx.is_authenticated:
            raise UnauthenticatedError()
        granted = permissions_for(ctx.roles)
        ok = required <= granted if require_all else bool(required & granted)
        if not ok:
            missing = sorted(permission.value for permission in required - granted)
            logger.warning(
                "rbac_permission_denied",
                missing=missing,
                held_roles=sorted(role.value for role in ctx.roles),
            )
            raise PermissionDeniedError(
                "Your role does not allow this action (missing: " + ", ".join(missing) + ")."
            )
        return ctx

    return dependency


#: Admin-or-reviewer surfaces (§41 Security & Audit).
AdminOnly = Annotated[RequestContext, Depends(require_roles(Role.ADMIN))]
AdminOrReviewer = Annotated[RequestContext, Depends(require_roles(Role.ADMIN, Role.REVIEWER))]


# ---------------------------------------------------------------------------
# Workspace scope + repository
# ---------------------------------------------------------------------------


async def get_workspace_scope(ctx: Ctx, db: DbSession) -> TenantScope:
    """Derive the §74 scope and arm the isolation guard on this request's session.

    After this dependency runs, *any* ORM query on ``db`` that touches a table with
    ``tenant_id``/``workspace_id`` and does not constrain both is rejected. Every
    router that reads tenant data must depend on this (directly or through a service).
    """
    scope = scope_from_context(ctx)
    install_tenant_guard(db, scope)
    return scope


Scope = Annotated[TenantScope, Depends(get_workspace_scope)]


async def get_repository(db: DbSession, scope: Scope) -> ScopedRepository:
    """The always-scoped data-access facade."""
    return ScopedRepository(db, scope)


Repo = Annotated[ScopedRepository, Depends(get_repository)]


async def get_audit(db: DbSession, ctx: Ctx) -> AuditRecorder:
    """Request-bound §42 audit writer."""
    return AuditRecorder(db, ctx)


AuditDep = Annotated[AuditRecorder, Depends(get_audit)]


# ---------------------------------------------------------------------------
# Service providers — the contract with the Agents & RAG owner
# ---------------------------------------------------------------------------

ServiceT = TypeVar("ServiceT")


def provide_service(service_cls: type[ServiceT]) -> Callable[..., ServiceT]:
    """Build a dependency that constructs ``service_cls(db_session, ctx)``.

    This is the *only* construction signature services may have. Depending on
    :data:`Scope` first guarantees the tenant guard is armed on the session the service
    receives, so a service cannot read across tenants even with a hand-written query.
    """

    def dependency(db: DbSession, ctx: Ctx, scope: Scope) -> ServiceT:
        _ = scope  # ordering dependency: arms the §74 guard before the service exists
        return service_cls(db, ctx)

    return dependency


def provide_unscoped_service(service_cls: type[ServiceT]) -> Callable[..., ServiceT]:
    """Like :func:`provide_service` but without requiring a selected workspace.

    Only for the pre-selection surfaces (``/auth``, ``GET /workspaces``): those services
    must pin ``tenant_id`` themselves and mark any tenant-wide read with
    :func:`~app.core.tenancy.allow_cross_tenant` plus a reason.
    """

    def dependency(db: DbSession, ctx: Ctx) -> ServiceT:
        return service_cls(db, ctx)

    return dependency


def get_workspace_id(ctx: Ctx) -> str:
    """The selected workspace id, or 400 if the caller has not selected one."""
    return ctx.require_workspace()


WorkspaceId = Annotated[str, Depends(get_workspace_id)]
