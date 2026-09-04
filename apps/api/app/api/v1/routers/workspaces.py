"""``/workspaces`` — tenant workspace administration (§10 / §9.4)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.v1.platform.directory import DirectoryService
from app.core.deps import (
    AuditDep,
    Ctx,
    Permission,
    provide_unscoped_service,
    require_permission,
)
from app.core.rate_limit import rate_limit
from app.domain.audit import AuditAction
from app.domain.request_response import (
    WorkspaceCreateRequest,
    WorkspaceResponse,
    WorkspaceUpdateRequest,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])

DirectoryDep = Annotated[DirectoryService, Depends(provide_unscoped_service(DirectoryService))]
CanRead = Annotated[Ctx, Depends(require_permission(Permission.WORKSPACE_READ))]
CanAdmin = Annotated[Ctx, Depends(require_permission(Permission.WORKSPACE_ADMIN))]


@router.get(
    "",
    response_model=list[WorkspaceResponse],
    summary="Workspaces the caller may enter (§58-2 picker)",
    dependencies=[Depends(rate_limit("workspaces.read", per_minute=120))],
)
async def list_workspaces(service: DirectoryDep, ctx: CanRead) -> list[WorkspaceResponse]:
    """Callable before a workspace is selected; admins see every workspace in the tenant."""
    return await service.list_workspaces()


@router.post(
    "",
    response_model=WorkspaceResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a workspace",
    dependencies=[Depends(rate_limit("workspaces.write", per_minute=10))],
)
async def create_workspace(
    payload: WorkspaceCreateRequest,
    service: DirectoryDep,
    ctx: CanAdmin,
    audit: AuditDep,
) -> WorkspaceResponse:
    workspace = await service.create_workspace(payload)
    await audit(
        AuditAction.PERMISSION_CHANGE,
        f"workspace:{workspace.id}",
        detail={"operation": "create", "kind": workspace.kind.value},
    )
    return workspace


@router.patch(
    "/{workspace_id}",
    response_model=WorkspaceResponse,
    summary="Rename or re-kind a workspace",
    dependencies=[Depends(rate_limit("workspaces.write", per_minute=20))],
)
async def update_workspace(
    workspace_id: str,
    payload: WorkspaceUpdateRequest,
    service: DirectoryDep,
    ctx: CanAdmin,
    audit: AuditDep,
) -> WorkspaceResponse:
    workspace = await service.update_workspace(workspace_id, payload)
    await audit(
        AuditAction.PERMISSION_CHANGE,
        f"workspace:{workspace_id}",
        detail={"operation": "update", "fields": sorted(payload.model_dump(exclude_none=True))},
    )
    return workspace
