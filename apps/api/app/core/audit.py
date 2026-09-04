"""Audit trail writer (spec §42 / §41).

Every mutating route calls :func:`record_audit` (usually via the
:class:`AuditRecorder` dependency, which pre-binds the request context). The row is
append-only and carries exactly the §42 columns:

    Time | User | Action | Resource | Workspace | IP / Session | Result | Risk

Content rules
-------------
* ``detail`` may carry **ids, counts and changed field names — never field values**.
  A rubric change records ``{"fields": ["weights", "pass_threshold"]}``, not the
  weights themselves, so the audit log cannot become a side channel for transcript
  content or PII (§40.2 / §49.5). :func:`_sanitise_detail` enforces this by dropping
  any value that is not a primitive of bounded length.
* Denials are audited too (``result="denied"``): an RBAC or tenancy rejection is the
  most interesting row in the table.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Final

import structlog

from app.db.models.platform import AuditEvent
from app.domain.audit import AuditAction
from app.domain.enums import AuditResult, ComplianceRisk

if TYPE_CHECKING:
    from collections.abc import Mapping

    from sqlalchemy.ext.asyncio import AsyncSession

    from app.core.context import RequestContext

logger = structlog.get_logger(__name__)

MAX_DETAIL_KEYS: Final[int] = 20
MAX_DETAIL_VALUE_LENGTH: Final[int] = 120

#: Actions whose default risk is higher than "safe" (§42 risk column).
_ELEVATED_RISK: Final[dict[AuditAction, ComplianceRisk]] = {
    AuditAction.PERMISSION_CHANGE: ComplianceRisk.MEDIUM,
    AuditAction.MODEL_CHANGE: ComplianceRisk.MEDIUM,
    AuditAction.PROMPT_CHANGE: ComplianceRisk.MEDIUM,
    AuditAction.RUBRIC_CHANGE: ComplianceRisk.LOW,
    AuditAction.FILE_DELETE: ComplianceRisk.MEDIUM,
    AuditAction.REPORT_EXPORT: ComplianceRisk.LOW,
    AuditAction.SECURITY_FINDING: ComplianceRisk.HIGH,
    AuditAction.RETENTION_PURGE: ComplianceRisk.HIGH,
    AuditAction.INTEGRATION_CHANGE: ComplianceRisk.MEDIUM,
    AuditAction.RUNTIME_POLICY_CHANGE: ComplianceRisk.MEDIUM,
    AuditAction.EVALUATION_OVERRIDE: ComplianceRisk.LOW,
}


def _sanitise_detail(detail: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """Keep ids/counts/flags; drop anything that could carry content."""
    if not detail:
        return None
    clean: dict[str, Any] = {}
    for key, value in list(detail.items())[:MAX_DETAIL_KEYS]:
        if isinstance(value, bool | int | float):
            clean[key] = value
        elif isinstance(value, str):
            clean[key] = value[:MAX_DETAIL_VALUE_LENGTH]
        elif isinstance(value, list | tuple):
            clean[key] = [
                str(item)[:MAX_DETAIL_VALUE_LENGTH]
                for item in list(value)[:MAX_DETAIL_KEYS]
                if isinstance(item, str | int | float | bool)
            ]
        # Everything else (dicts, objects, bytes) is dropped deliberately.
    return clean or None


async def record_audit(
    db: AsyncSession,
    ctx: RequestContext,
    *,
    action: AuditAction,
    resource: str,
    result: AuditResult = AuditResult.SUCCESS,
    risk: ComplianceRisk | None = None,
    detail: Mapping[str, Any] | None = None,
    flush: bool = True,
) -> AuditEvent:
    """Append one §42 audit row.

    Args:
        db: The request's session. The row participates in the caller's transaction, so
            a rolled-back mutation does not leave a "success" audit row behind.
        ctx: Request context (supplies tenant, workspace, user, ip, session ref).
        action: One of the §42 actions.
        resource: Stable resource reference, e.g. ``"persona:9f2c…"`` or
            ``"knowledge_base:1a2b/document:3c4d"``.
        result: success / denied / error.
        risk: Overrides the per-action default.
        detail: Ids, counts and changed field *names* only.
        flush: Flush immediately so the row exists even if the caller later raises.

    Returns:
        The staged :class:`~app.db.models.platform.AuditEvent`.
    """
    event = AuditEvent(
        tenant_id=ctx.tenant_id,
        workspace_id=ctx.workspace_id,
        at=datetime.now(tz=UTC),
        user_id=ctx.user_id,
        action=action.value,
        resource=resource[:300],
        ip=ctx.ip,
        session_ref=ctx.session_ref or ctx.request_id or None,
        result=result,
        risk=risk or _ELEVATED_RISK.get(action, ComplianceRisk.SAFE),
        detail=_sanitise_detail(detail),
    )
    db.add(event)
    if flush:
        await db.flush()
    logger.info(
        "audit",
        action=action.value,
        resource=event.resource,
        result=result.value,
        risk=event.risk.value,
    )
    return event


class AuditRecorder:
    """Request-scoped convenience wrapper injected into routers.

    ::

        @router.post("/personas")
        async def create_persona(..., audit: AuditDep) -> PersonaResponse:
            persona = await service.create(payload)
            await audit(AuditAction.PERSONA_CHANGE, f"persona:{persona.id}")
    """

    __slots__ = ("ctx", "db")

    def __init__(self, db: AsyncSession, ctx: RequestContext) -> None:
        self.db = db
        self.ctx = ctx

    async def __call__(
        self,
        action: AuditAction,
        resource: str,
        *,
        result: AuditResult = AuditResult.SUCCESS,
        risk: ComplianceRisk | None = None,
        detail: Mapping[str, Any] | None = None,
    ) -> AuditEvent:
        return await record_audit(
            self.db,
            self.ctx,
            action=action,
            resource=resource,
            result=result,
            risk=risk,
            detail=detail,
        )

    async def denied(
        self,
        action: AuditAction,
        resource: str,
        *,
        detail: Mapping[str, Any] | None = None,
    ) -> AuditEvent:
        """Record a refused attempt (§42 ``result=denied``)."""
        return await record_audit(
            self.db,
            self.ctx,
            action=action,
            resource=resource,
            result=AuditResult.DENIED,
            risk=ComplianceRisk.MEDIUM,
            detail=detail,
        )


__all__ = ["AuditRecorder", "record_audit"]
