"""``/auth`` — sign-in, workspace selection, refresh, sign-out (§9 / §58 / §73).

Tokens never appear in a response body: they are delivered as ``HttpOnly`` cookies so
XSS cannot exfiltrate them. The body carries only the CSRF value, which is *meant* to be
readable by the SPA.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status

from app.api.v1.platform.identity import IdentityService, LoginOutcome
from app.core.audit import record_audit
from app.core.config import get_settings
from app.core.context import RequestContext, anonymous_context
from app.core.deps import Ctx, DbSession, provide_unscoped_service
from app.core.errors import AppError, TokenInvalidError, UnauthenticatedError
from app.core.rate_limit import rate_limit
from app.core.security import clear_session_cookies, set_session_cookies
from app.db.session import get_sessionmaker
from app.domain.audit import AuditAction
from app.domain.common import Acknowledgement
from app.domain.enums import AuditResult, ComplianceRisk
from app.domain.request_response import (
    LoginRequest,
    LoginResponse,
    SelectWorkspaceRequest,
    SessionIdentityResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])

IdentityDep = Annotated[IdentityService, Depends(provide_unscoped_service(IdentityService))]


def _login_response(outcome: LoginOutcome, response: Response) -> LoginResponse:
    set_session_cookies(
        response,
        access_token=outcome.access_token,
        csrf_token=outcome.csrf_token,
        refresh_token=outcome.refresh_token,
    )
    return LoginResponse(
        user=outcome.user,
        workspaces=outcome.workspaces,
        csrf_token=outcome.csrf_token,
        expires_at=outcome.expires_at,
    )


async def _audit_failed_login(ctx: RequestContext, email: str) -> None:
    """Record a denied sign-in in its **own** transaction.

    The request transaction is rolled back when the login raises, so the "denied" row
    must not ride along with it — a failed-login trail that disappears on failure is
    worthless for §42.
    """
    factory = get_sessionmaker()
    async with factory() as audit_db:
        await record_audit(
            audit_db,
            ctx,
            action=AuditAction.LOGIN,
            resource=f"auth:{email[:64]}",
            result=AuditResult.DENIED,
            risk=ComplianceRisk.MEDIUM,
        )
        await audit_db.commit()


@router.post(
    "/login",
    response_model=LoginResponse,
    status_code=status.HTTP_200_OK,
    summary="Sign in with e-mail and password",
    dependencies=[
        Depends(rate_limit("auth.login", per_minute=10, burst=5, fail_closed=True, by_ip=True))
    ],
)
async def login(
    payload: LoginRequest,
    response: Response,
    request: Request,
    db: DbSession,
) -> LoginResponse:
    """Authenticate and issue cookies. Rate limited per IP and fail-closed (§40.3)."""
    request_id = str(getattr(request.state, "request_id", "") or "")
    client_ip = request.client.host if request.client else None
    anonymous = anonymous_context(request_id)
    service = IdentityService(db, anonymous)
    try:
        outcome = await service.login(payload.email, payload.password)
    except AppError:
        await _audit_failed_login(anonymous, payload.email)
        raise

    authenticated = RequestContext(
        tenant_id=outcome.user.tenant_id,
        workspace_id=outcome.user.workspace_id,
        user_id=outcome.user.id,
        request_id=request_id,
        ip=client_ip,
    )
    await record_audit(
        db, authenticated, action=AuditAction.LOGIN, resource=f"user:{outcome.user.id}"
    )
    return _login_response(outcome, response)


@router.post(
    "/workspace",
    response_model=LoginResponse,
    summary="Select a workspace and re-scope the session (§58-2)",
    dependencies=[Depends(rate_limit("auth.workspace", per_minute=30))],
)
async def select_workspace(
    payload: SelectWorkspaceRequest,
    response: Response,
    service: IdentityDep,
    ctx: Ctx,
    db: DbSession,
) -> LoginResponse:
    """Issue a new access token carrying the roles held in the chosen workspace."""
    outcome = await service.select_workspace(payload.workspace_id)
    await record_audit(
        db,
        ctx,
        action=AuditAction.API_ACCESS,
        resource=f"workspace:{payload.workspace_id}",
        detail={"operation": "select_workspace"},
    )
    return _login_response(outcome, response)


@router.post(
    "/refresh",
    response_model=LoginResponse,
    summary="Rotate the access token using the refresh cookie",
    dependencies=[Depends(rate_limit("auth.refresh", per_minute=60, by_ip=True))],
)
async def refresh(request: Request, response: Response, db: DbSession) -> LoginResponse:
    """Refresh without requiring a still-valid access token.

    Protected by a ``SameSite=Strict``, path-scoped refresh cookie rather than the CSRF
    header, because the access token is usually already expired at this point.
    """
    settings = get_settings()
    token = request.cookies.get(settings.refresh_cookie_name)
    if not token:
        raise UnauthenticatedError("No refresh token present. Sign in again.")
    ctx = anonymous_context(str(getattr(request.state, "request_id", "") or ""))
    service = IdentityService(db, ctx)
    try:
        outcome = await service.refresh(token)
    except TokenInvalidError:
        clear_session_cookies(response, settings)
        raise
    return _login_response(outcome, response)


@router.get("/me", response_model=SessionIdentityResponse, summary="Current identity")
async def me(service: IdentityDep) -> SessionIdentityResponse:
    """Identity plus the caller's effective §9 permission list."""
    return await service.me()


@router.post(
    "/logout",
    response_model=Acknowledgement,
    summary="Sign out and clear every auth cookie",
    dependencies=[Depends(rate_limit("auth.logout", per_minute=30))],
)
async def logout(response: Response, ctx: Ctx, db: DbSession) -> Acknowledgement:
    """Clear cookies and audit the logout.

    The client must additionally honour ``RuntimePolicy.clear_on_logout`` and drop its
    local model/data caches (§61).
    """
    await record_audit(
        db, ctx, action=AuditAction.LOGOUT, resource=f"user:{ctx.user_id or 'unknown'}"
    )
    clear_session_cookies(response)
    return Acknowledgement(ok=True, id=ctx.user_id)
