"""``/security`` — Security & Audit console (§32 / §40 / §41). Admin or reviewer only.

Two role gates apply: the router requires the ``admin``/``reviewer`` role (§41 is an
admin surface), and each operation additionally requires the fine-grained permission,
so a reviewer can close findings without gaining workspace administration.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.deps import (
    AdminOrReviewer,
    AuditDep,
    Ctx,
    Permission,
    provide_service,
    require_permission,
)
from app.core.rate_limit import rate_limit
from app.domain.audit import AuditAction
from app.domain.common import Page, PageParams
from app.domain.enums import ComplianceRisk, ReviewerStatus
from app.domain.evaluation import ComplianceFinding
from app.domain.request_response import (
    ComplianceFindingUpdateRequest,
    SafetyCheckRequest,
    SafetyCheckResponse,
    SecurityOverviewResponse,
)
from app.services.safety_service import SafetyService

router = APIRouter(
    prefix="/security",
    tags=["security"],
    dependencies=[Depends(rate_limit("security.read", per_minute=120))],
)

SafetyDep = Annotated[SafetyService, Depends(provide_service(SafetyService))]
CanViewRisk = Annotated[Ctx, Depends(require_permission(Permission.RISK_VIEW))]
CanReviewCompliance = Annotated[Ctx, Depends(require_permission(Permission.COMPLIANCE_REVIEW))]
CanCloseFinding = Annotated[Ctx, Depends(require_permission(Permission.FINDING_CLOSE))]


@router.get(
    "/overview",
    response_model=SecurityOverviewResponse,
    summary="Findings, risk and retention summary (§41)",
)
async def get_overview(
    service: SafetyDep, admin: AdminOrReviewer, ctx: CanViewRisk
) -> SecurityOverviewResponse:
    return await service.get_security_overview()


@router.get(
    "/findings",
    response_model=Page[ComplianceFinding],
    summary="List compliance findings (§32)",
)
async def list_findings(
    service: SafetyDep,
    admin: AdminOrReviewer,
    ctx: CanViewRisk,
    params: Annotated[PageParams, Depends()],
    severity: Annotated[ComplianceRisk | None, Query()] = None,
    reviewer_status: Annotated[ReviewerStatus | None, Query()] = None,
    session_id: Annotated[str | None, Query()] = None,
) -> Page[ComplianceFinding]:
    return await service.list_findings(
        params=params,
        severity=severity,
        reviewer_status=reviewer_status,
        session_id=session_id,
    )


@router.get(
    "/findings/{finding_id}",
    response_model=ComplianceFinding,
    summary="Read one finding with its evidence",
)
async def get_finding(
    finding_id: str, service: SafetyDep, admin: AdminOrReviewer, ctx: CanViewRisk
) -> ComplianceFinding:
    return await service.get_finding(finding_id)


@router.patch(
    "/findings/{finding_id}",
    response_model=ComplianceFinding,
    summary="Acknowledge, resolve or dismiss a finding (§9.5)",
    dependencies=[Depends(rate_limit("security.write", per_minute=60))],
)
async def update_finding(
    finding_id: str,
    payload: ComplianceFindingUpdateRequest,
    service: SafetyDep,
    admin: AdminOrReviewer,
    ctx: CanCloseFinding,
    audit: AuditDep,
) -> ComplianceFinding:
    finding = await service.update_finding(finding_id, payload)
    await audit(
        AuditAction.SECURITY_FINDING,
        f"compliance_finding:{finding_id}",
        detail={"reviewer_status": payload.reviewer_status.value},
        risk=finding.severity,
    )
    return finding


@router.post(
    "/safety-check",
    response_model=SafetyCheckResponse,
    summary="Evaluate text against the §40.1 safety policy",
    dependencies=[Depends(rate_limit("security.safety_check", per_minute=30, cost=2))],
)
async def safety_check(
    payload: SafetyCheckRequest,
    service: SafetyDep,
    admin: AdminOrReviewer,
    ctx: CanReviewCompliance,
    audit: AuditDep,
) -> SafetyCheckResponse:
    """Used to validate policy changes. The submitted text is never logged (§49.5)."""
    result = await service.check_text(payload)
    await audit(
        AuditAction.API_ACCESS,
        "security:safety_check",
        detail={"blocked": result.blocked, "risk": result.risk.value},
        risk=result.risk,
    )
    return result
