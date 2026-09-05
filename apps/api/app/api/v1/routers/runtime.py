"""``/runtime`` — client runtime policy and telemetry (§44 / §49.5 / §59 / §61 / §62).

Policy (§61): the browser asks what it is allowed to do — ``webgpu`` auto/on/off, local
model cache, sensitive-data cache, clear-on-logout — and combines the answer with its
own capability probe. WebGPU is only an acceleration layer: every task listed in
``local_tasks_enabled`` also has a server implementation, so a device that supports
nothing local loses speed, not function (§51 / §62).

Telemetry (§49.5): timings and backend identifiers only. ``RuntimeTelemetry`` forbids
extra fields, so an attempt to post transcript text or a user identifier is rejected as
a validation error rather than silently stored.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.v1.platform.settings_store import PlatformSettingsService
from app.core.deps import (
    AdminOnly,
    AuditDep,
    Ctx,
    Permission,
    provide_service,
    require_permission,
)
from app.core.logging import get_logger
from app.core.rate_limit import rate_limit
from app.domain.audit import AuditAction
from app.domain.common import Acknowledgement
from app.domain.request_response import (
    RuntimeCapabilityReport,
    RuntimePolicyResponse,
    RuntimePolicyUpdateRequest,
    RuntimeTelemetryRequest,
)
from app.domain.runtime import RuntimePolicy

router = APIRouter(prefix="/runtime", tags=["runtime"])

logger = get_logger(__name__)

SettingsDep = Annotated[
    PlatformSettingsService, Depends(provide_service(PlatformSettingsService))
]
CanRead = Annotated[Ctx, Depends(require_permission(Permission.RUNTIME_READ))]
CanReportTelemetry = Annotated[
    Ctx, Depends(require_permission(Permission.RUNTIME_TELEMETRY_WRITE))
]
CanWritePolicy = Annotated[Ctx, Depends(require_permission(Permission.RUNTIME_POLICY_WRITE))]


@router.get(
    "/policy",
    response_model=RuntimePolicy,
    summary="Effective client runtime policy for this workspace (§61)",
    dependencies=[Depends(rate_limit("runtime.read", per_minute=120))],
)
async def get_policy(service: SettingsDep, ctx: CanRead) -> RuntimePolicy:
    """Workspace policy, falling back to the deployment defaults."""
    return await service.get_policy()


@router.post(
    "/capability",
    response_model=RuntimePolicyResponse,
    summary="Report device capability and get a backend recommendation (§59 / §62)",
    dependencies=[Depends(rate_limit("runtime.capability", per_minute=60))],
)
async def report_capability(
    payload: RuntimeCapabilityReport, service: SettingsDep, ctx: CanRead
) -> RuntimePolicyResponse:
    """Advisory only — the server remains authoritative for every task (§51)."""
    return await service.advise_runtime(payload)


@router.patch(
    "/policy",
    response_model=RuntimePolicy,
    summary="Change the workspace runtime policy (admin, §61)",
    dependencies=[Depends(rate_limit("runtime.policy", per_minute=20))],
)
async def update_policy(
    payload: RuntimePolicyUpdateRequest,
    service: SettingsDep,
    admin: AdminOnly,
    ctx: CanWritePolicy,
    audit: AuditDep,
) -> RuntimePolicy:
    policy = await service.update_policy(payload)
    await audit(
        AuditAction.RUNTIME_POLICY_CHANGE,
        "runtime_policy:workspace",
        detail={"fields": sorted(payload.model_dump(exclude_none=True))},
    )
    return policy


@router.post(
    "/telemetry",
    response_model=Acknowledgement,
    summary="Submit runtime telemetry with no sensitive content (§49.5)",
    dependencies=[Depends(rate_limit("runtime.telemetry", per_minute=120, burst=30))],
)
async def submit_telemetry(
    payload: RuntimeTelemetryRequest, ctx: CanReportTelemetry
) -> Acknowledgement:
    """Emit the metrics as a structured log line.

    Only enumerated, bounded fields are forwarded — backend, model id, timings and a
    short machine-readable fallback reason. There is no free-text field to carry
    conversation content, and no audit row: telemetry is metrics, not an action.
    """
    telemetry = payload.telemetry
    logger.info(
        "runtime_telemetry",
        backend=telemetry.backend.value,
        model=telemetry.model_id,
        load_ms=telemetry.load_ms,
        latency_ms=telemetry.last_inference_ms,
        worker_alive=telemetry.worker_alive,
        fallback_reason=telemetry.fallback_reason,
        session_id=payload.session_id,
    )
    return Acknowledgement(ok=True, id=payload.session_id)
