"""``/scenarios`` — Scenario Builder plus the rubric surface (§17 / §26 / §28 / §38).

Rubrics live here because a rubric is only meaningful as the scoring contract of a
scenario; ``/scenarios/rubrics`` keeps them under one owner (coach authors, reviewer
approves — §9.2 / §9.5).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.core.deps import AuditDep, Ctx, Permission, provide_service, require_permission
from app.core.rate_limit import rate_limit
from app.domain.audit import AuditAction
from app.domain.common import Acknowledgement, Page, PageParams
from app.domain.enums import ContentStatus, Difficulty
from app.domain.request_response import (
    ContentReviewRequest,
    RubricCreateRequest,
    RubricUpdateRequest,
    ScenarioCreateRequest,
    ScenarioResponse,
    ScenarioUpdateRequest,
)
from app.domain.scenario import Rubric, ScenarioVersion
from app.services.scenario_service import ScenarioService

router = APIRouter(prefix="/scenarios", tags=["scenarios"])

ScenarioDep = Annotated[ScenarioService, Depends(provide_service(ScenarioService))]
CanRead = Annotated[Ctx, Depends(require_permission(Permission.SCENARIO_READ))]
CanWrite = Annotated[Ctx, Depends(require_permission(Permission.SCENARIO_WRITE))]
CanPublish = Annotated[Ctx, Depends(require_permission(Permission.CONTENT_PUBLISH))]
CanReadRubric = Annotated[Ctx, Depends(require_permission(Permission.RUBRIC_READ))]
CanWriteRubric = Annotated[Ctx, Depends(require_permission(Permission.RUBRIC_WRITE))]
CanApproveRubric = Annotated[Ctx, Depends(require_permission(Permission.RUBRIC_APPROVE))]


# --- rubrics (declared before /{scenario_id} so the literal path wins) -------


@router.get(
    "/rubrics",
    response_model=Page[Rubric],
    summary="List rubrics (§26)",
    dependencies=[Depends(rate_limit("rubrics.read", per_minute=120))],
)
async def list_rubrics(
    service: ScenarioDep,
    ctx: CanReadRubric,
    params: Annotated[PageParams, Depends()],
    status_filter: Annotated[ContentStatus | None, Query(alias="status")] = None,
) -> Page[Rubric]:
    return await service.list_rubrics(params=params, status=status_filter)


@router.post(
    "/rubrics",
    response_model=Rubric,
    status_code=status.HTTP_201_CREATED,
    summary="Create a rubric",
    dependencies=[Depends(rate_limit("rubrics.write", per_minute=20))],
)
async def create_rubric(
    payload: RubricCreateRequest, service: ScenarioDep, ctx: CanWriteRubric, audit: AuditDep
) -> Rubric:
    rubric = await service.create_rubric(payload)
    await audit(
        AuditAction.RUBRIC_CHANGE, f"rubric:{rubric.id}", detail={"operation": "create"}
    )
    return rubric


@router.get("/rubrics/{rubric_id}", response_model=Rubric, summary="Read one rubric")
async def get_rubric(rubric_id: str, service: ScenarioDep, ctx: CanReadRubric) -> Rubric:
    return await service.get_rubric(rubric_id)


@router.patch(
    "/rubrics/{rubric_id}",
    response_model=Rubric,
    summary="Update rubric weights or thresholds (bumps version)",
    dependencies=[Depends(rate_limit("rubrics.write", per_minute=40))],
)
async def update_rubric(
    rubric_id: str,
    payload: RubricUpdateRequest,
    service: ScenarioDep,
    ctx: CanWriteRubric,
    audit: AuditDep,
) -> Rubric:
    rubric = await service.update_rubric(rubric_id, payload)
    await audit(
        AuditAction.RUBRIC_CHANGE,
        f"rubric:{rubric_id}",
        detail={"operation": "update", "fields": sorted(payload.model_dump(exclude_none=True))},
    )
    return rubric


@router.post(
    "/rubrics/{rubric_id}/approve",
    response_model=Rubric,
    summary="Approve a rubric (reviewer / compliance officer, §9.5)",
    dependencies=[Depends(rate_limit("rubrics.approve", per_minute=20))],
)
async def approve_rubric(
    rubric_id: str,
    payload: ContentReviewRequest,
    service: ScenarioDep,
    ctx: CanApproveRubric,
    audit: AuditDep,
) -> Rubric:
    rubric = await service.approve_rubric(rubric_id, payload)
    await audit(
        AuditAction.RUBRIC_CHANGE,
        f"rubric:{rubric_id}",
        detail={"operation": "approve", "status": payload.status.value},
    )
    return rubric


# --- scenarios ---------------------------------------------------------------


@router.get(
    "",
    response_model=Page[ScenarioResponse],
    summary="List scenarios",
    dependencies=[Depends(rate_limit("scenarios.read", per_minute=180))],
)
async def list_scenarios(
    service: ScenarioDep,
    ctx: CanRead,
    params: Annotated[PageParams, Depends()],
    status_filter: Annotated[ContentStatus | None, Query(alias="status")] = None,
    difficulty: Annotated[Difficulty | None, Query()] = None,
    industry: Annotated[str | None, Query(max_length=200)] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
) -> Page[ScenarioResponse]:
    return await service.list_scenarios(
        params=params,
        status=status_filter,
        difficulty=difficulty,
        industry=industry,
        query=q,
    )


@router.get("/{scenario_id}", response_model=ScenarioResponse, summary="Read one scenario")
async def get_scenario(
    scenario_id: str, service: ScenarioDep, ctx: CanRead
) -> ScenarioResponse:
    return await service.get_scenario(scenario_id)


@router.get(
    "/{scenario_id}/versions",
    response_model=list[ScenarioVersion],
    summary="Version history — what a past session was pinned to (§54)",
)
async def list_scenario_versions(
    scenario_id: str, service: ScenarioDep, ctx: CanRead
) -> list[ScenarioVersion]:
    return await service.list_scenario_versions(scenario_id)


@router.post(
    "",
    response_model=ScenarioResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a scenario",
    dependencies=[Depends(rate_limit("scenarios.write", per_minute=30))],
)
async def create_scenario(
    payload: ScenarioCreateRequest, service: ScenarioDep, ctx: CanWrite, audit: AuditDep
) -> ScenarioResponse:
    scenario = await service.create_scenario(payload)
    await audit(
        AuditAction.SCENARIO_CHANGE,
        f"scenario:{scenario.id}",
        detail={"operation": "create", "persona_id": payload.persona_id},
    )
    return scenario


@router.patch(
    "/{scenario_id}",
    response_model=ScenarioResponse,
    summary="Update a scenario (creates a new pinned version, §54)",
    dependencies=[Depends(rate_limit("scenarios.write", per_minute=60))],
)
async def update_scenario(
    scenario_id: str,
    payload: ScenarioUpdateRequest,
    service: ScenarioDep,
    ctx: CanWrite,
    audit: AuditDep,
) -> ScenarioResponse:
    scenario = await service.update_scenario(scenario_id, payload)
    await audit(
        AuditAction.SCENARIO_CHANGE,
        f"scenario:{scenario_id}",
        detail={
            "operation": "update",
            "version": scenario.version,
            "fields": sorted(payload.model_dump(exclude_none=True)),
        },
    )
    return scenario


@router.post(
    "/{scenario_id}/review",
    response_model=ScenarioResponse,
    summary="Approve, publish or archive a scenario (§38)",
    dependencies=[Depends(rate_limit("scenarios.review", per_minute=30))],
)
async def review_scenario(
    scenario_id: str,
    payload: ContentReviewRequest,
    service: ScenarioDep,
    ctx: CanPublish,
    audit: AuditDep,
) -> ScenarioResponse:
    scenario = await service.review_scenario(scenario_id, payload)
    await audit(
        AuditAction.SCENARIO_CHANGE,
        f"scenario:{scenario_id}",
        detail={"operation": "review", "status": payload.status.value},
    )
    return scenario


@router.delete(
    "/{scenario_id}",
    response_model=Acknowledgement,
    summary="Archive a scenario (soft delete)",
    dependencies=[Depends(rate_limit("scenarios.write", per_minute=20))],
)
async def delete_scenario(
    scenario_id: str, service: ScenarioDep, ctx: CanWrite, audit: AuditDep
) -> Acknowledgement:
    await service.delete_scenario(scenario_id)
    await audit(
        AuditAction.SCENARIO_CHANGE, f"scenario:{scenario_id}", detail={"operation": "delete"}
    )
    return Acknowledgement(ok=True, id=scenario_id)
