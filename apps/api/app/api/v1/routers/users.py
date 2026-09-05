"""``/users`` — user administration and role assignment (§9 / §9.4)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.v1.platform.directory import DirectoryService
from app.core.deps import AuditDep, Ctx, Permission, provide_service, require_permission
from app.core.rate_limit import rate_limit
from app.domain.audit import AuditAction
from app.domain.common import Acknowledgement, Page, PageParams
from app.domain.request_response import (
    RoleAssignmentRequest,
    UserCreateRequest,
    UserResponse,
    UserUpdateRequest,
)

router = APIRouter(prefix="/users", tags=["users"])

DirectoryDep = Annotated[DirectoryService, Depends(provide_service(DirectoryService))]
CanRead = Annotated[Ctx, Depends(require_permission(Permission.USER_READ))]
CanAdmin = Annotated[Ctx, Depends(require_permission(Permission.USER_ADMIN))]
CanAdminRoles = Annotated[Ctx, Depends(require_permission(Permission.ROLE_ADMIN))]


@router.get(
    "",
    response_model=Page[UserResponse],
    summary="List workspace members",
    dependencies=[Depends(rate_limit("users.read", per_minute=120))],
)
async def list_users(
    service: DirectoryDep,
    ctx: CanRead,
    params: Annotated[PageParams, Depends()],
    team_id: Annotated[str | None, Query(description="Filter by team membership")] = None,
    q: Annotated[str | None, Query(max_length=200, description="Display-name search")] = None,
) -> Page[UserResponse]:
    return await service.list_users(params, team_id=team_id, query=q)


@router.get("/{user_id}", response_model=UserResponse, summary="Read one member")
async def get_user(user_id: str, service: DirectoryDep, ctx: CanRead) -> UserResponse:
    return await service.get_user(user_id)


@router.post(
    "",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Invite a user into the workspace",
    dependencies=[Depends(rate_limit("users.write", per_minute=20))],
)
async def create_user(
    payload: UserCreateRequest,
    service: DirectoryDep,
    ctx: CanAdmin,
    audit: AuditDep,
) -> UserResponse:
    """Creates the account without a password: sign-in happens through SSO or an invite."""
    user = await service.create_user(payload)
    await audit(
        AuditAction.PERMISSION_CHANGE,
        f"user:{user.id}",
        detail={"operation": "create", "roles": [role.value for role in user.roles]},
    )
    return user


@router.patch(
    "/{user_id}",
    response_model=UserResponse,
    summary="Update a member",
    dependencies=[Depends(rate_limit("users.write", per_minute=40))],
)
async def update_user(
    user_id: str,
    payload: UserUpdateRequest,
    service: DirectoryDep,
    ctx: CanAdmin,
    audit: AuditDep,
) -> UserResponse:
    user = await service.update_user(user_id, payload)
    await audit(
        AuditAction.PERMISSION_CHANGE,
        f"user:{user_id}",
        detail={"operation": "update", "fields": sorted(payload.model_dump(exclude_none=True))},
    )
    return user


@router.put(
    "/{user_id}/roles",
    response_model=UserResponse,
    summary="Replace a member's roles in this workspace (§9)",
    dependencies=[Depends(rate_limit("users.roles", per_minute=20))],
)
async def set_roles(
    user_id: str,
    payload: RoleAssignmentRequest,
    service: DirectoryDep,
    ctx: CanAdminRoles,
    audit: AuditDep,
) -> UserResponse:
    user = await service.set_roles(user_id, payload)
    await audit(
        AuditAction.PERMISSION_CHANGE,
        f"user:{user_id}",
        detail={"operation": "set_roles", "roles": [role.value for role in payload.roles]},
    )
    return user


@router.delete(
    "/{user_id}",
    response_model=Acknowledgement,
    summary="Deactivate a member (soft delete, §40.2)",
    dependencies=[Depends(rate_limit("users.write", per_minute=10))],
)
async def deactivate_user(
    user_id: str, service: DirectoryDep, ctx: CanAdmin, audit: AuditDep
) -> Acknowledgement:
    """Soft delete only: report lineage and the audit trail must survive (§40.2)."""
    await service.deactivate_user(user_id)
    await audit(
        AuditAction.PERMISSION_CHANGE, f"user:{user_id}", detail={"operation": "deactivate"}
    )
    return Acknowledgement(ok=True, id=user_id)
