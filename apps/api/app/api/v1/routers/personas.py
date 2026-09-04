"""``/personas`` — Persona Builder CRUD and the §34 Test Lab.

``PersonaHiddenState`` (§16.3) is stripped from every response unless the caller holds
``persona.read_hidden`` (coach/admin). The router asks the service for the caller-safe
view rather than filtering after the fact, so a new field added to the hidden brief
cannot leak by omission.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.core.deps import (
    AuditDep,
    Ctx,
    Permission,
    has_permission,
    provide_service,
    require_permission,
)
from app.core.rate_limit import rate_limit
from app.domain.audit import AuditAction
from app.domain.common import Acknowledgement, Page, PageParams
from app.domain.enums import ContentStatus
from app.domain.request_response import (
    ContentReviewRequest,
    PersonaCreateRequest,
    PersonaResponse,
    PersonaTestRequest,
    PersonaTestResponse,
    PersonaUpdateRequest,
)
from app.services.persona_service import PersonaService

router = APIRouter(prefix="/personas", tags=["personas"])

PersonaDep = Annotated[PersonaService, Depends(provide_service(PersonaService))]
CanRead = Annotated[Ctx, Depends(require_permission(Permission.PERSONA_READ))]
CanWrite = Annotated[Ctx, Depends(require_permission(Permission.PERSONA_WRITE))]
CanPublish = Annotated[Ctx, Depends(require_permission(Permission.CONTENT_PUBLISH))]


@router.get(
    "",
    response_model=Page[PersonaResponse],
    summary="List personas",
    dependencies=[Depends(rate_limit("personas.read", per_minute=180))],
)
async def list_personas(
    service: PersonaDep,
    ctx: CanRead,
    params: Annotated[PageParams, Depends()],
    status_filter: Annotated[ContentStatus | None, Query(alias="status")] = None,
    industry: Annotated[str | None, Query(max_length=200)] = None,
) -> Page[PersonaResponse]:
    return await service.list_personas(
        params=params,
        status=status_filter,
        industry=industry,
        include_hidden=has_permission(ctx, Permission.PERSONA_READ_HIDDEN),
    )


@router.get(
    "/{persona_id}",
    response_model=PersonaResponse,
    summary="Read one persona (hidden state only for coach/admin, §16.3)",
)
async def get_persona(
    persona_id: str, service: PersonaDep, ctx: CanRead
) -> PersonaResponse:
    return await service.get_persona(
        persona_id, include_hidden=has_permission(ctx, Permission.PERSONA_READ_HIDDEN)
    )


@router.post(
    "",
    response_model=PersonaResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a persona",
    dependencies=[Depends(rate_limit("personas.write", per_minute=30))],
)
async def create_persona(
    payload: PersonaCreateRequest, service: PersonaDep, ctx: CanWrite, audit: AuditDep
) -> PersonaResponse:
    persona = await service.create_persona(payload)
    await audit(
        AuditAction.PERSONA_CHANGE,
        f"persona:{persona.id}",
        detail={"operation": "create", "has_hidden": payload.hidden is not None},
    )
    return persona


@router.patch(
    "/{persona_id}",
    response_model=PersonaResponse,
    summary="Update a persona (bumps its version, §54)",
    dependencies=[Depends(rate_limit("personas.write", per_minute=60))],
)
async def update_persona(
    persona_id: str,
    payload: PersonaUpdateRequest,
    service: PersonaDep,
    ctx: CanWrite,
    audit: AuditDep,
) -> PersonaResponse:
    """Editing creates a new version; running sessions keep the version they pinned."""
    persona = await service.update_persona(persona_id, payload)
    await audit(
        AuditAction.PERSONA_CHANGE,
        f"persona:{persona_id}",
        detail={
            "operation": "update",
            "version": persona.version,
            "fields": sorted(payload.model_dump(exclude_none=True)),
        },
    )
    return persona


@router.post(
    "/{persona_id}/test",
    response_model=PersonaTestResponse,
    summary="Single-turn persona test without creating a session (§34)",
    dependencies=[Depends(rate_limit("personas.test", per_minute=20, burst=8, cost=2))],
)
async def test_persona(
    persona_id: str,
    payload: PersonaTestRequest,
    service: PersonaDep,
    ctx: CanWrite,
    audit: AuditDep,
) -> PersonaTestResponse:
    """The learner-facing message is never audited or logged (§49.5)."""
    result = await service.test_persona(persona_id, payload)
    await audit(
        AuditAction.API_ACCESS,
        f"persona:{persona_id}/test",
        detail={"latency_ms": round(result.latency_ms)},
    )
    return result


@router.post(
    "/{persona_id}/review",
    response_model=PersonaResponse,
    summary="Approve, publish or archive a persona (§38)",
    dependencies=[Depends(rate_limit("personas.review", per_minute=30))],
)
async def review_persona(
    persona_id: str,
    payload: ContentReviewRequest,
    service: PersonaDep,
    ctx: CanPublish,
    audit: AuditDep,
) -> PersonaResponse:
    persona = await service.review_persona(persona_id, payload)
    await audit(
        AuditAction.PERSONA_CHANGE,
        f"persona:{persona_id}",
        detail={"operation": "review", "status": payload.status.value},
    )
    return persona


@router.delete(
    "/{persona_id}",
    response_model=Acknowledgement,
    summary="Archive a persona (soft delete)",
    dependencies=[Depends(rate_limit("personas.write", per_minute=20))],
)
async def delete_persona(
    persona_id: str, service: PersonaDep, ctx: CanWrite, audit: AuditDep
) -> Acknowledgement:
    await service.delete_persona(persona_id)
    await audit(
        AuditAction.PERSONA_CHANGE, f"persona:{persona_id}", detail={"operation": "delete"}
    )
    return Acknowledgement(ok=True, id=persona_id)
