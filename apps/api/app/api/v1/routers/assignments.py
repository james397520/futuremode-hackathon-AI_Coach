"""``/assignments`` — Training Assignment management (§36) and progress (§35)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.core.deps import AuditDep, Ctx, Permission, provide_service, require_permission
from app.core.rate_limit import rate_limit
from app.domain.audit import AuditAction
from app.domain.common import Acknowledgement, Page, PageParams
from app.domain.request_response import (
    AssignmentCreateRequest,
    AssignmentProgressRow,
    AssignmentResponse,
    AssignmentUpdateRequest,
)
from app.services.scenario_service import ScenarioService

router = APIRouter(prefix="/assignments", tags=["assignments"])

ScenarioDep = Annotated[ScenarioService, Depends(provide_service(ScenarioService))]
CanViewAssigned = Annotated[
    Ctx, Depends(require_permission(Permission.ASSIGNMENT_VIEW_ASSIGNED))
]
CanWrite = Annotated[Ctx, Depends(require_permission(Permission.ASSIGNMENT_WRITE))]
CanReview = Annotated[Ctx, Depends(require_permission(Permission.TEAM_REVIEW))]


@router.get(
    "",
    response_model=Page[AssignmentResponse],
    summary="List assignments (trainees see only their own, §9.1)",
    dependencies=[Depends(rate_limit("assignments.read", per_minute=120))],
)
async def list_assignments(
    service: ScenarioDep,
    ctx: CanViewAssigned,
    params: Annotated[PageParams, Depends()],
    mine: Annotated[bool, Query(description="Restrict to the caller's assignments")] = True,
) -> Page[AssignmentResponse]:
    """A caller without ``team.review`` is always restricted to their own assignments."""
    return await service.list_assignments(params=params, mine_only=mine)


@router.get(
    "/{assignment_id}", response_model=AssignmentResponse, summary="Read one assignment"
)
async def get_assignment(
    assignment_id: str, service: ScenarioDep, ctx: CanViewAssigned
) -> AssignmentResponse:
    return await service.get_assignment(assignment_id)


@router.get(
    "/{assignment_id}/progress",
    response_model=list[AssignmentProgressRow],
    summary="Per-assignee completion status (§36)",
    dependencies=[Depends(rate_limit("assignments.progress", per_minute=60))],
)
async def get_progress(
    assignment_id: str, service: ScenarioDep, ctx: CanReview
) -> list[AssignmentProgressRow]:
    return await service.get_assignment_progress(assignment_id)


@router.post(
    "",
    response_model=AssignmentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Assign training to users or teams (§36)",
    dependencies=[Depends(rate_limit("assignments.write", per_minute=30))],
)
async def create_assignment(
    payload: AssignmentCreateRequest, service: ScenarioDep, ctx: CanWrite, audit: AuditDep
) -> AssignmentResponse:
    assignment = await service.create_assignment(payload)
    await audit(
        AuditAction.ASSIGNMENT_CHANGE,
        f"assignment:{assignment.id}",
        detail={
            "operation": "create",
            "scenario_id": payload.scenario_id,
            "users": len(payload.assignee_user_ids),
            "teams": len(payload.assignee_team_ids),
            "mode": payload.mode.value,
        },
    )
    return assignment


@router.patch(
    "/{assignment_id}",
    response_model=AssignmentResponse,
    summary="Update deadline, attempts or passing criteria (§9.3)",
    dependencies=[Depends(rate_limit("assignments.write", per_minute=40))],
)
async def update_assignment(
    assignment_id: str,
    payload: AssignmentUpdateRequest,
    service: ScenarioDep,
    ctx: CanWrite,
    audit: AuditDep,
) -> AssignmentResponse:
    assignment = await service.update_assignment(assignment_id, payload)
    await audit(
        AuditAction.ASSIGNMENT_CHANGE,
        f"assignment:{assignment_id}",
        detail={"operation": "update", "fields": sorted(payload.model_dump(exclude_none=True))},
    )
    return assignment


@router.delete(
    "/{assignment_id}",
    response_model=Acknowledgement,
    summary="Withdraw an assignment (soft delete)",
    dependencies=[Depends(rate_limit("assignments.write", per_minute=20))],
)
async def delete_assignment(
    assignment_id: str, service: ScenarioDep, ctx: CanWrite, audit: AuditDep
) -> Acknowledgement:
    await service.delete_assignment(assignment_id)
    await audit(
        AuditAction.ASSIGNMENT_CHANGE,
        f"assignment:{assignment_id}",
        detail={"operation": "delete"},
    )
    return Acknowledgement(ok=True, id=assignment_id)
