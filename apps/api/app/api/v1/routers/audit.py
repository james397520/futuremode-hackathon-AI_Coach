"""``/audit`` — read-only §42 audit log. Admin or reviewer only.

The log is append-only: there is no write, update or delete route here by design.
Rows are produced by :func:`app.core.audit.record_audit` inside the mutating routes.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.v1.platform.settings_store import AuditReader
from app.core.deps import (
    AdminOrReviewer,
    Ctx,
    Permission,
    provide_service,
    require_permission,
)
from app.core.rate_limit import rate_limit
from app.domain.audit import AuditEvent, AuditQuery
from app.domain.common import Page

router = APIRouter(
    prefix="/audit",
    tags=["audit"],
    dependencies=[Depends(rate_limit("audit.read", per_minute=60))],
)

AuditReaderDep = Annotated[AuditReader, Depends(provide_service(AuditReader))]
CanReadAudit = Annotated[Ctx, Depends(require_permission(Permission.AUDIT_READ))]


@router.post(
    "/events",
    response_model=Page[AuditEvent],
    summary="Query the audit log (§42)",
)
async def query_events(
    filters: AuditQuery,
    reader: AuditReaderDep,
    admin: AdminOrReviewer,
    ctx: CanReadAudit,
) -> Page[AuditEvent]:
    """POST because the filter set (action, user, risk, time range) is large.

    Non-admin reviewers are restricted to their own workspace's rows by the reader.
    """
    return await reader.query(filters)


@router.get(
    "/events/{event_id}",
    response_model=AuditEvent,
    summary="Read one audit row",
)
async def get_event(
    event_id: str,
    reader: AuditReaderDep,
    admin: AdminOrReviewer,
    ctx: CanReadAudit,
) -> AuditEvent:
    return await reader.get(event_id)
