"""Identity service: sign-in, workspace selection, token refresh (§9 / §10 / §58 / §73).

The login lookup is the one legitimate cross-tenant read in the system — an e-mail
address must resolve to its organization before any tenant is known — so it is tagged
with :func:`~app.core.tenancy.allow_cross_tenant` and a reason, which the guard logs.
Everything after that point is workspace-scoped.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import structlog
from sqlalchemy import select

from app.core.config import get_settings
from app.core.errors import (
    InvalidCredentialsError,
    NotFoundError,
    PermissionDeniedError,
)
from app.core.security import (
    TokenType,
    decode_token,
    dummy_verify,
    issue_access_token,
    issue_csrf_token,
    issue_refresh_token,
    verify_password,
)
from app.core.tenancy import allow_cross_tenant
from app.db.models.org import RoleAssignment, User, Workspace
from app.domain.enums import Role
from app.domain.request_response import (
    AuthenticatedUser,
    SessionIdentityResponse,
    WorkspaceSummary,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.core.context import RequestContext

logger = structlog.get_logger(__name__)


@dataclass(frozen=True, slots=True)
class LoginOutcome:
    """Everything the router needs to set cookies and shape the response."""

    user: AuthenticatedUser
    workspaces: list[WorkspaceSummary]
    access_token: str
    refresh_token: str | None
    csrf_token: str
    expires_at: datetime


class IdentityService:
    """Authentication and workspace selection."""

    __slots__ = ("ctx", "db")

    def __init__(self, db: AsyncSession, ctx: RequestContext) -> None:
        self.db = db
        self.ctx = ctx

    # ---- internals ------------------------------------------------------
    async def _load_user_by_email(self, email: str) -> User | None:
        statement = allow_cross_tenant(
            select(User).where(
                User.email == email.strip().lower(),
                User.deleted_at.is_(None),
                User.is_active.is_(True),
            ),
            reason="login: resolve tenant from e-mail before any tenant is known",
        )
        result = await self.db.execute(statement)
        return result.scalars().first()

    async def _load_user(self, tenant_id: str, user_id: str) -> User:
        statement = allow_cross_tenant(
            select(User).where(
                User.id == user_id,
                User.tenant_id == tenant_id,
                User.deleted_at.is_(None),
                User.is_active.is_(True),
            ),
            reason="token refresh: re-derive privileges without a workspace scope",
        )
        result = await self.db.execute(statement)
        user = result.scalars().first()
        if user is None:
            raise InvalidCredentialsError()
        return user

    async def _workspace_roles(self, user: User) -> dict[str, set[Role]]:
        """Map workspace id -> roles held by ``user`` in that workspace (§9)."""
        statement = allow_cross_tenant(
            select(RoleAssignment.workspace_id, RoleAssignment.role).where(
                RoleAssignment.user_id == user.id,
                RoleAssignment.tenant_id == user.tenant_id,
            ),
            reason="login: enumerate the workspaces this user may select",
        )
        result = await self.db.execute(statement)
        mapping: dict[str, set[Role]] = {}
        for workspace_id, role in result.all():
            mapping.setdefault(str(workspace_id), set()).add(Role(role))
        return mapping

    async def _workspace_summaries(self, user: User) -> list[WorkspaceSummary]:
        roles_by_workspace = await self._workspace_roles(user)
        if not roles_by_workspace:
            return []
        statement = allow_cross_tenant(
            select(Workspace).where(
                Workspace.tenant_id == user.tenant_id,
                Workspace.id.in_(roles_by_workspace.keys()),
                Workspace.deleted_at.is_(None),
            ),
            reason="login: list selectable workspaces for the resolved tenant",
        )
        result = await self.db.execute(statement)
        return [
            WorkspaceSummary(
                id=workspace.id,
                name=workspace.name,
                kind=workspace.kind,
                roles=sorted(roles_by_workspace.get(workspace.id, set())),
            )
            for workspace in result.scalars().all()
        ]

    async def _team_ids(self, user: User) -> list[str]:
        from app.db.models.org import user_team

        statement = allow_cross_tenant(
            select(user_team.c.team_id).where(user_team.c.user_id == user.id),
            reason="login: attach team membership to the access token",
        )
        result = await self.db.execute(statement)
        return [str(row[0]) for row in result.all()]

    def _mint(
        self,
        user: User,
        *,
        workspace_id: str | None,
        roles: set[Role],
        team_ids: list[str],
        with_refresh: bool,
    ) -> tuple[str, str | None, str, datetime]:
        settings = get_settings()
        access_token, claims = issue_access_token(
            user_id=user.id,
            tenant_id=user.tenant_id,
            workspace_id=workspace_id,
            roles=sorted(roles),
            team_ids=team_ids,
            settings=settings,
        )
        refresh_token: str | None = None
        if with_refresh:
            refresh_token, _ = issue_refresh_token(
                user_id=user.id, tenant_id=user.tenant_id, settings=settings
            )
        csrf_token = issue_csrf_token(claims.jti, settings=settings)
        expires_at = datetime.now(tz=UTC) + timedelta(
            seconds=settings.access_token_ttl_seconds
        )
        return access_token, refresh_token, csrf_token, expires_at

    @staticmethod
    def _authenticated_user(
        user: User, *, workspace_id: str | None, roles: set[Role], team_ids: list[str]
    ) -> AuthenticatedUser:
        return AuthenticatedUser(
            id=user.id,
            tenant_id=user.tenant_id,
            workspace_id=workspace_id,
            email=user.email,
            display_name=user.display_name,
            roles=sorted(roles),
            team_ids=team_ids,
            locale=user.locale,
        )

    # ---- public API -----------------------------------------------------
    async def login(self, email: str, password: str) -> LoginOutcome:
        """Verify credentials and mint a tenant-scoped (workspace-less) session.

        A single workspace is auto-selected so the common case skips the §58-2 picker.

        Raises:
            InvalidCredentialsError: unknown account, disabled account, wrong password
                or an SSO-only account with no local password. The message is identical
                in every case to avoid user enumeration.
        """
        user = await self._load_user_by_email(email)
        if user is None or not user.password_hash:
            # Constant work for unknown accounts (timing channel).
            dummy_verify()
            raise InvalidCredentialsError()
        if not verify_password(password, user.password_hash):
            raise InvalidCredentialsError()

        workspaces = await self._workspace_summaries(user)
        team_ids = await self._team_ids(user)
        selected = workspaces[0] if len(workspaces) == 1 else None
        roles = set(selected.roles) if selected else set()
        access_token, refresh_token, csrf_token, expires_at = self._mint(
            user,
            workspace_id=selected.id if selected else None,
            roles=roles,
            team_ids=team_ids,
            with_refresh=True,
        )
        user.last_login_at = datetime.now(tz=UTC)
        return LoginOutcome(
            user=self._authenticated_user(
                user,
                workspace_id=selected.id if selected else None,
                roles=roles,
                team_ids=team_ids,
            ),
            workspaces=workspaces,
            access_token=access_token,
            refresh_token=refresh_token,
            csrf_token=csrf_token,
            expires_at=expires_at,
        )

    async def select_workspace(self, workspace_id: str) -> LoginOutcome:
        """Re-mint the access token scoped to ``workspace_id`` (§58-2).

        Raises:
            PermissionDeniedError: the caller holds no role in that workspace.
        """
        user = await self._load_user(self.ctx.tenant_id, self.ctx.require_user())
        roles_by_workspace = await self._workspace_roles(user)
        roles = roles_by_workspace.get(workspace_id)
        if not roles:
            logger.warning("workspace_select_denied", workspace_id=workspace_id)
            raise PermissionDeniedError("You do not have access to that workspace.")

        team_ids = await self._team_ids(user)
        access_token, _, csrf_token, expires_at = self._mint(
            user,
            workspace_id=workspace_id,
            roles=roles,
            team_ids=team_ids,
            with_refresh=False,
        )
        return LoginOutcome(
            user=self._authenticated_user(
                user, workspace_id=workspace_id, roles=roles, team_ids=team_ids
            ),
            workspaces=await self._workspace_summaries(user),
            access_token=access_token,
            refresh_token=None,
            csrf_token=csrf_token,
            expires_at=expires_at,
        )

    async def refresh(self, refresh_token: str) -> LoginOutcome:
        """Exchange a refresh token for a new access token.

        Roles are re-read from the database rather than copied from the old token, so a
        revocation takes effect within one access-token lifetime (§9).
        """
        claims = decode_token(refresh_token, expected_type=TokenType.REFRESH)
        user = await self._load_user(claims.tid, claims.sub)
        roles_by_workspace = await self._workspace_roles(user)
        workspace_id = self.ctx.workspace_id
        roles = roles_by_workspace.get(workspace_id or "", set())
        if workspace_id and not roles:
            raise PermissionDeniedError("Your access to this workspace was removed.")
        team_ids = await self._team_ids(user)
        access_token, new_refresh, csrf_token, expires_at = self._mint(
            user,
            workspace_id=workspace_id,
            roles=roles,
            team_ids=team_ids,
            with_refresh=True,
        )
        return LoginOutcome(
            user=self._authenticated_user(
                user, workspace_id=workspace_id, roles=roles, team_ids=team_ids
            ),
            workspaces=await self._workspace_summaries(user),
            access_token=access_token,
            refresh_token=new_refresh,
            csrf_token=csrf_token,
            expires_at=expires_at,
        )

    async def me(self) -> SessionIdentityResponse:
        """``GET /auth/me`` — identity plus the caller's effective permissions."""
        from app.core.deps import permissions_for

        user = await self._load_user(self.ctx.tenant_id, self.ctx.require_user())
        team_ids = await self._team_ids(user)
        return SessionIdentityResponse(
            user=self._authenticated_user(
                user,
                workspace_id=self.ctx.workspace_id,
                roles=set(self.ctx.roles),
                team_ids=team_ids,
            ),
            permissions=sorted(
                permission.value for permission in permissions_for(self.ctx.roles)
            ),
            workspaces=await self._workspace_summaries(user),
        )

    async def require_workspace_exists(self, workspace_id: str) -> Workspace:
        """Resolve a workspace inside the caller's tenant, or 404."""
        statement = allow_cross_tenant(
            select(Workspace).where(
                Workspace.id == workspace_id,
                Workspace.tenant_id == self.ctx.tenant_id,
                Workspace.deleted_at.is_(None),
            ),
            reason="workspace lookup is tenant-scoped by definition (no workspace_id column)",
        )
        result = await self.db.execute(statement)
        workspace = result.scalars().first()
        if workspace is None:
            raise NotFoundError.of("workspace", workspace_id)
        return workspace
