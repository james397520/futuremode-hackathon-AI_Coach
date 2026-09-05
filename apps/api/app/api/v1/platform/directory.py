"""Directory service: workspaces, users, teams and role assignments (§9 / §10).

Every read goes through :class:`~app.core.tenancy.ScopedRepository`, so these queries
are physically confined to the caller's tenant + workspace. ``workspace`` itself has no
``workspace_id`` column and is therefore queried with an explicit tenant filter.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import delete, func, insert, select

from app.core.errors import ConflictError, NotFoundError
from app.core.tenancy import ScopedRepository, allow_cross_tenant, scope_from_context
from app.db.models.org import (
    Organization,
    RoleAssignment,
    Team,
    User,
    Workspace,
    user_team,
)
from app.domain.common import Page, PageParams
from app.domain.enums import Role, WorkspaceKind
from app.domain.request_response import (
    RoleAssignmentRequest,
    TeamCreateRequest,
    TeamResponse,
    TeamUpdateRequest,
    UserCreateRequest,
    UserResponse,
    UserUpdateRequest,
    WorkspaceCreateRequest,
    WorkspaceResponse,
    WorkspaceUpdateRequest,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.core.context import RequestContext


class DirectoryService:
    """Workspace / user / team administration."""

    __slots__ = ("ctx", "db")

    def __init__(self, db: AsyncSession, ctx: RequestContext) -> None:
        self.db = db
        self.ctx = ctx

    @property
    def repo(self) -> ScopedRepository:
        return ScopedRepository(self.db, scope_from_context(self.ctx))

    # ---- workspaces -----------------------------------------------------
    async def list_workspaces(self) -> list[WorkspaceResponse]:
        """Workspaces of the caller's tenant that the caller holds a role in."""
        role_statement = allow_cross_tenant(
            select(RoleAssignment.workspace_id).where(
                RoleAssignment.tenant_id == self.ctx.tenant_id,
                RoleAssignment.user_id == self.ctx.require_user(),
            ),
            reason="workspace picker: the caller has not selected a workspace yet",
        )
        allowed = {str(row[0]) for row in (await self.db.execute(role_statement)).all()}
        is_admin = self.ctx.is_admin
        if not is_admin and not allowed:
            # A member with no role assignment sees nothing — never "everything".
            return []

        statement = select(Workspace).where(
            Workspace.tenant_id == self.ctx.tenant_id, Workspace.deleted_at.is_(None)
        )
        if not is_admin:
            statement = statement.where(Workspace.id.in_(allowed))
        statement = allow_cross_tenant(
            statement.order_by(Workspace.name),
            reason="workspace table is tenant-scoped only (no workspace_id column)",
        )
        result = await self.db.execute(statement)
        return [self._workspace_response(workspace) for workspace in result.scalars().all()]

    async def create_workspace(self, payload: WorkspaceCreateRequest) -> WorkspaceResponse:
        organization = await self.db.get(Organization, self.ctx.tenant_id)
        if organization is None:
            raise NotFoundError.of("organization", self.ctx.tenant_id)
        existing = await self.db.execute(
            allow_cross_tenant(
                select(func.count())
                .select_from(Workspace)
                .where(
                    Workspace.tenant_id == self.ctx.tenant_id,
                    Workspace.slug == payload.slug,
                ),
                reason="uniqueness check on a tenant-scoped-only table",
            )
        )
        if int(existing.scalar_one()) > 0:
            raise ConflictError("A workspace with that slug already exists.")
        workspace = Workspace(
            tenant_id=self.ctx.tenant_id,
            name=payload.name,
            slug=payload.slug,
            kind=payload.kind,
        )
        self.db.add(workspace)
        await self.db.flush()
        return self._workspace_response(workspace)

    async def update_workspace(
        self, workspace_id: str, payload: WorkspaceUpdateRequest
    ) -> WorkspaceResponse:
        statement = allow_cross_tenant(
            select(Workspace).where(
                Workspace.id == workspace_id, Workspace.tenant_id == self.ctx.tenant_id
            ),
            reason="workspace table is tenant-scoped only (no workspace_id column)",
        )
        workspace = (await self.db.execute(statement)).scalars().first()
        if workspace is None or workspace.deleted_at is not None:
            raise NotFoundError.of("workspace", workspace_id)
        if payload.name is not None:
            workspace.name = payload.name
        if payload.kind is not None:
            workspace.kind = payload.kind
        await self.db.flush()
        return self._workspace_response(workspace)

    @staticmethod
    def _workspace_response(workspace: Workspace) -> WorkspaceResponse:
        return WorkspaceResponse(
            id=workspace.id,
            tenant_id=workspace.tenant_id,
            name=workspace.name,
            kind=WorkspaceKind(workspace.kind),
            created_at=workspace.created_at,
            updated_at=workspace.updated_at,
        )

    # ---- users ----------------------------------------------------------
    async def list_users(
        self, params: PageParams, *, team_id: str | None = None, query: str | None = None
    ) -> Page[UserResponse]:
        repo = self.repo
        criteria = [User.deleted_at.is_(None)]
        if query:
            criteria.append(User.display_name.ilike(f"%{query}%"))
        statement = repo.select(User).where(*criteria)
        if team_id:
            statement = statement.join(user_team, user_team.c.user_id == User.id).where(
                user_team.c.team_id == team_id
            )
        total = await repo.count(User, *criteria)
        result = await self.db.execute(
            statement.order_by(User.display_name).limit(params.limit).offset(params.offset)
        )
        users = list(result.scalars().unique().all())
        items = [await self._user_response(user) for user in users]
        return Page.of(items, total=total, params=params)

    async def get_user(self, user_id: str) -> UserResponse:
        user = await self.repo.require(User, user_id)
        return await self._user_response(user)

    async def create_user(self, payload: UserCreateRequest) -> UserResponse:
        scope = scope_from_context(self.ctx)
        email = payload.email.strip().lower()
        duplicate = await self.db.execute(
            allow_cross_tenant(
                select(func.count())
                .select_from(User)
                .where(User.tenant_id == scope.tenant_id, User.email == email),
                reason="e-mail uniqueness is enforced per tenant, across workspaces",
            )
        )
        if int(duplicate.scalar_one()) > 0:
            raise ConflictError("A user with that e-mail already exists in this organization.")
        user = User(
            tenant_id=scope.tenant_id,
            workspace_id=scope.workspace_id,
            email=email,
            display_name=payload.display_name,
            locale=payload.locale,
        )
        self.db.add(user)
        await self.db.flush()
        await self._replace_roles(user, payload.roles)
        await self._replace_teams(user, payload.team_ids)
        await self.db.flush()
        return await self._user_response(user)

    async def update_user(self, user_id: str, payload: UserUpdateRequest) -> UserResponse:
        user = await self.repo.require(User, user_id)
        if payload.display_name is not None:
            user.display_name = payload.display_name
        if payload.is_active is not None:
            user.is_active = payload.is_active
        if payload.locale is not None:
            user.locale = payload.locale
        if payload.team_ids is not None:
            await self._replace_teams(user, payload.team_ids)
        await self.db.flush()
        return await self._user_response(user)

    async def deactivate_user(self, user_id: str) -> None:
        """Soft delete (§40.2): the row is retained for audit and report lineage."""
        user = await self.repo.require(User, user_id)
        user.is_active = False
        user.deleted_at = datetime.now(tz=UTC)
        user.deleted_by = self.ctx.user_id
        await self.db.flush()

    async def set_roles(self, user_id: str, payload: RoleAssignmentRequest) -> UserResponse:
        """Replace the caller-workspace roles of ``user_id`` (audited as permission_change)."""
        user = await self.repo.require(User, user_id)
        await self._replace_roles(user, payload.roles)
        await self.db.flush()
        return await self._user_response(user)

    async def _replace_roles(self, user: User, roles: list[Role]) -> None:
        scope = scope_from_context(self.ctx)
        await self.db.execute(
            delete(RoleAssignment).where(
                RoleAssignment.tenant_id == scope.tenant_id,
                RoleAssignment.workspace_id == scope.workspace_id,
                RoleAssignment.user_id == user.id,
            )
        )
        for role in dict.fromkeys(roles):
            self.db.add(
                RoleAssignment(
                    tenant_id=scope.tenant_id,
                    workspace_id=scope.workspace_id,
                    user_id=user.id,
                    role=role,
                    granted_by=self.ctx.user_id,
                )
            )

    async def _replace_teams(self, user: User, team_ids: list[str]) -> None:
        repo = self.repo
        for team_id in team_ids:
            await repo.require(Team, team_id)  # tenancy check per id
        await self.db.execute(delete(user_team).where(user_team.c.user_id == user.id))
        for team_id in dict.fromkeys(team_ids):
            await self.db.execute(
                insert(user_team).values(user_id=user.id, team_id=team_id)
            )

    async def _user_roles(self, user: User) -> list[Role]:
        scope = scope_from_context(self.ctx)
        result = await self.db.execute(
            select(RoleAssignment.role).where(
                RoleAssignment.tenant_id == scope.tenant_id,
                RoleAssignment.workspace_id == scope.workspace_id,
                RoleAssignment.user_id == user.id,
            )
        )
        return sorted({Role(row[0]) for row in result.all()})

    async def _user_teams(self, user: User) -> list[str]:
        result = await self.db.execute(
            select(user_team.c.team_id).where(user_team.c.user_id == user.id)
        )
        return [str(row[0]) for row in result.all()]

    async def _user_response(self, user: User) -> UserResponse:
        return UserResponse(
            id=user.id,
            tenant_id=user.tenant_id,
            workspace_id=user.workspace_id,
            created_at=user.created_at,
            updated_at=user.updated_at,
            email=user.email,
            display_name=user.display_name,
            roles=await self._user_roles(user),
            team_ids=await self._user_teams(user),
            is_active=user.is_active,
            last_login_at=user.last_login_at,
        )

    # ---- teams ----------------------------------------------------------
    async def list_teams(self, params: PageParams) -> Page[TeamResponse]:
        repo = self.repo
        criteria = [Team.deleted_at.is_(None)]
        total = await repo.count(Team, *criteria)
        teams = await repo.list(
            Team, *criteria, order_by=[Team.name], limit=params.limit, offset=params.offset
        )
        items = [await self._team_response(team) for team in teams]
        return Page.of(items, total=total, params=params)

    async def get_team(self, team_id: str) -> TeamResponse:
        return await self._team_response(await self.repo.require(Team, team_id))

    async def create_team(self, payload: TeamCreateRequest) -> TeamResponse:
        scope = scope_from_context(self.ctx)
        team = Team(
            tenant_id=scope.tenant_id,
            workspace_id=scope.workspace_id,
            name=payload.name,
            department=payload.department,
        )
        self.db.add(team)
        await self.db.flush()
        return await self._team_response(team)

    async def update_team(self, team_id: str, payload: TeamUpdateRequest) -> TeamResponse:
        team = await self.repo.require(Team, team_id)
        if payload.name is not None:
            team.name = payload.name
        if payload.department is not None:
            team.department = payload.department
        await self.db.flush()
        return await self._team_response(team)

    async def delete_team(self, team_id: str) -> None:
        team = await self.repo.require(Team, team_id)
        team.deleted_at = datetime.now(tz=UTC)
        team.deleted_by = self.ctx.user_id
        await self.db.execute(delete(user_team).where(user_team.c.team_id == team.id))
        await self.db.flush()

    async def add_members(self, team_id: str, user_ids: list[str]) -> TeamResponse:
        repo = self.repo
        team = await repo.require(Team, team_id)
        for user_id in dict.fromkeys(user_ids):
            await repo.require(User, user_id)
            existing = await self.db.execute(
                select(func.count())
                .select_from(user_team)
                .where(user_team.c.team_id == team.id, user_team.c.user_id == user_id)
            )
            if int(existing.scalar_one()) == 0:
                await self.db.execute(
                    insert(user_team).values(user_id=user_id, team_id=team.id)
                )
        await self.db.flush()
        return await self._team_response(team)

    async def remove_member(self, team_id: str, user_id: str) -> TeamResponse:
        repo = self.repo
        team = await repo.require(Team, team_id)
        await repo.require(User, user_id)
        await self.db.execute(
            delete(user_team).where(
                user_team.c.team_id == team.id, user_team.c.user_id == user_id
            )
        )
        await self.db.flush()
        return await self._team_response(team)

    async def _team_response(self, team: Team) -> TeamResponse:
        result = await self.db.execute(
            select(func.count()).select_from(user_team).where(user_team.c.team_id == team.id)
        )
        return TeamResponse(
            id=team.id,
            tenant_id=team.tenant_id,
            workspace_id=team.workspace_id,
            created_at=team.created_at,
            updated_at=team.updated_at,
            name=team.name,
            department=team.department,
            member_count=int(result.scalar_one()),
        )
