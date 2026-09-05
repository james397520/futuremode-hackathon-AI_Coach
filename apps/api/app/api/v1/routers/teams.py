"""``/teams`` — team and membership administration (§10 / §35 filters)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.v1.platform.directory import DirectoryService
from app.core.deps import AuditDep, Ctx, Permission, provide_service, require_permission
from app.core.rate_limit import rate_limit
from app.domain.audit import AuditAction
from app.domain.common import Acknowledgement, Page, PageParams
from app.domain.request_response import (
    TeamCreateRequest,
    TeamMembershipRequest,
    TeamResponse,
    TeamUpdateRequest,
)

router = APIRouter(prefix="/teams", tags=["teams"])

DirectoryDep = Annotated[DirectoryService, Depends(provide_service(DirectoryService))]
CanRead = Annotated[Ctx, Depends(require_permission(Permission.TEAM_READ))]
CanAdmin = Annotated[Ctx, Depends(require_permission(Permission.TEAM_ADMIN))]


@router.get(
    "",
    response_model=Page[TeamResponse],
    summary="List teams",
    dependencies=[Depends(rate_limit("teams.read", per_minute=120))],
)
async def list_teams(
    service: DirectoryDep, ctx: CanRead, params: Annotated[PageParams, Depends()]
) -> Page[TeamResponse]:
    return await service.list_teams(params)


@router.get("/{team_id}", response_model=TeamResponse, summary="Read one team")
async def get_team(team_id: str, service: DirectoryDep, ctx: CanRead) -> TeamResponse:
    return await service.get_team(team_id)


@router.post(
    "",
    response_model=TeamResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a team",
    dependencies=[Depends(rate_limit("teams.write", per_minute=20))],
)
async def create_team(
    payload: TeamCreateRequest, service: DirectoryDep, ctx: CanAdmin, audit: AuditDep
) -> TeamResponse:
    team = await service.create_team(payload)
    await audit(AuditAction.PERMISSION_CHANGE, f"team:{team.id}", detail={"operation": "create"})
    return team


@router.patch(
    "/{team_id}",
    response_model=TeamResponse,
    summary="Rename a team or move its department",
    dependencies=[Depends(rate_limit("teams.write", per_minute=40))],
)
async def update_team(
    team_id: str,
    payload: TeamUpdateRequest,
    service: DirectoryDep,
    ctx: CanAdmin,
    audit: AuditDep,
) -> TeamResponse:
    team = await service.update_team(team_id, payload)
    await audit(
        AuditAction.PERMISSION_CHANGE,
        f"team:{team_id}",
        detail={"operation": "update", "fields": sorted(payload.model_dump(exclude_none=True))},
    )
    return team


@router.post(
    "/{team_id}/members",
    response_model=TeamResponse,
    summary="Add members to a team",
    dependencies=[Depends(rate_limit("teams.members", per_minute=40))],
)
async def add_members(
    team_id: str,
    payload: TeamMembershipRequest,
    service: DirectoryDep,
    ctx: CanAdmin,
    audit: AuditDep,
) -> TeamResponse:
    team = await service.add_members(team_id, payload.user_ids)
    await audit(
        AuditAction.PERMISSION_CHANGE,
        f"team:{team_id}",
        detail={"operation": "add_members", "count": len(payload.user_ids)},
    )
    return team


@router.delete(
    "/{team_id}/members/{user_id}",
    response_model=TeamResponse,
    summary="Remove one member from a team",
    dependencies=[Depends(rate_limit("teams.members", per_minute=40))],
)
async def remove_member(
    team_id: str, user_id: str, service: DirectoryDep, ctx: CanAdmin, audit: AuditDep
) -> TeamResponse:
    team = await service.remove_member(team_id, user_id)
    await audit(
        AuditAction.PERMISSION_CHANGE,
        f"team:{team_id}",
        detail={"operation": "remove_member", "user_id": user_id},
    )
    return team


@router.delete(
    "/{team_id}",
    response_model=Acknowledgement,
    summary="Delete a team (soft delete, §40.2)",
    dependencies=[Depends(rate_limit("teams.write", per_minute=10))],
)
async def delete_team(
    team_id: str, service: DirectoryDep, ctx: CanAdmin, audit: AuditDep
) -> Acknowledgement:
    await service.delete_team(team_id)
    await audit(AuditAction.PERMISSION_CHANGE, f"team:{team_id}", detail={"operation": "delete"})
    return Acknowledgement(ok=True, id=team_id)
