"""``/reports`` — report generation, export and analytics reads (§34 / §35 / §47 / §69)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.core.deps import AuditDep, Ctx, Permission, provide_service, require_permission
from app.core.rate_limit import rate_limit
from app.domain.analytics import AnalyticsFilter
from app.domain.audit import AuditAction
from app.domain.common import Page, PageParams
from app.domain.enums import ReportKind
from app.domain.request_response import (
    ReportExportRequest,
    ReportExportResponse,
    ReportGenerateRequest,
    ReportResponse,
    SkillProfileResponse,
    TeamAnalyticsResponse,
)
from app.services.evaluation_service import EvaluationService
from app.services.report_service import ReportService

router = APIRouter(prefix="/reports", tags=["reports"])

ReportDep = Annotated[ReportService, Depends(provide_service(ReportService))]
EvaluationDep = Annotated[EvaluationService, Depends(provide_service(EvaluationService))]

CanRead = Annotated[Ctx, Depends(require_permission(Permission.REPORT_READ))]
CanExport = Annotated[Ctx, Depends(require_permission(Permission.REPORT_EXPORT))]
CanViewOwnProgress = Annotated[Ctx, Depends(require_permission(Permission.PROGRESS_VIEW_OWN))]
CanBenchmark = Annotated[Ctx, Depends(require_permission(Permission.TEAM_BENCHMARK))]


@router.get(
    "",
    response_model=Page[ReportResponse],
    summary="List generated reports",
    dependencies=[Depends(rate_limit("reports.read", per_minute=120))],
)
async def list_reports(
    service: ReportDep,
    ctx: CanRead,
    params: Annotated[PageParams, Depends()],
    kind: Annotated[ReportKind | None, Query()] = None,
) -> Page[ReportResponse]:
    return await service.list_reports(params=params, kind=kind)


@router.post(
    "",
    response_model=ReportResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Generate a report (§47)",
    dependencies=[Depends(rate_limit("reports.generate", per_minute=12, burst=4, cost=2))],
)
async def generate_report(
    payload: ReportGenerateRequest, service: ReportDep, ctx: CanRead, audit: AuditDep
) -> ReportResponse:
    report = await service.generate_report(payload)
    await audit(
        AuditAction.API_ACCESS,
        f"report:{report.id}",
        detail={"operation": "generate", "kind": report.kind.value},
    )
    return report


@router.get(
    "/skill-profile/{user_id}",
    response_model=SkillProfileResponse,
    summary="Individual skill profile and next-step recommendation (§33 / §34)",
    dependencies=[Depends(rate_limit("reports.profile", per_minute=60))],
)
async def get_skill_profile(
    user_id: str, service: EvaluationDep, ctx: CanViewOwnProgress
) -> SkillProfileResponse:
    """Reading someone else's profile additionally requires ``team.review`` (§9.3)."""
    return await service.get_skill_profile(user_id)


@router.post(
    "/team-analytics",
    response_model=TeamAnalyticsResponse,
    summary="Team benchmark, skill matrix and weakness heatmap (§35)",
    dependencies=[Depends(rate_limit("reports.analytics", per_minute=30, cost=2))],
)
async def get_team_analytics(
    filters: AnalyticsFilter, service: EvaluationDep, ctx: CanBenchmark
) -> TeamAnalyticsResponse:
    """POST because the §35 filter set is far too large for a query string."""
    return await service.get_team_analytics(filters)


@router.get(
    "/{report_id}",
    response_model=ReportResponse,
    summary="Read one report (§69 ``GET /api/reports/:id``)",
)
async def get_report(report_id: str, service: ReportDep, ctx: CanRead) -> ReportResponse:
    return await service.get_report(report_id)


@router.post(
    "/{report_id}/export",
    response_model=ReportExportResponse,
    summary="Export a report as PDF / CSV / XLSX (§47)",
    dependencies=[Depends(rate_limit("reports.export", per_minute=12, burst=4))],
)
async def export_report(
    report_id: str,
    payload: ReportExportRequest,
    service: ReportDep,
    ctx: CanExport,
    audit: AuditDep,
) -> ReportExportResponse:
    """Returns a short-lived signed download URL; the API never streams the bytes."""
    export = await service.export_report(report_id, payload)
    await audit(
        AuditAction.REPORT_EXPORT,
        f"report:{report_id}",
        detail={"format": payload.format.value},
    )
    return export
