"""``/integrations`` — connector cards (§43). Admin only.

Credentials never travel through this API: a request may only supply a ``secret_ref``
into the secrets manager, and responses expose ``has_credential`` instead of any secret
material (§73). The OpenAI / ElevenLabs keys themselves live in the API process
environment and are never returned to a browser (§56 / §70 / §71).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.v1.platform.settings_store import PlatformSettingsService
from app.core.deps import (
    AdminOnly,
    AuditDep,
    Ctx,
    Permission,
    provide_service,
    require_permission,
)
from app.core.rate_limit import rate_limit
from app.domain.audit import AuditAction
from app.domain.request_response import (
    IntegrationResponse,
    IntegrationTestResponse,
    IntegrationUpsertRequest,
)

router = APIRouter(prefix="/integrations", tags=["integrations"])

SettingsDep = Annotated[
    PlatformSettingsService, Depends(provide_service(PlatformSettingsService))
]
CanAdmin = Annotated[Ctx, Depends(require_permission(Permission.INTEGRATION_ADMIN))]


@router.get(
    "",
    response_model=list[IntegrationResponse],
    summary="List connectors and their status (§43)",
    dependencies=[Depends(rate_limit("integrations.read", per_minute=60))],
)
async def list_integrations(
    service: SettingsDep, admin: AdminOnly, ctx: CanAdmin
) -> list[IntegrationResponse]:
    return await service.list_integrations()


@router.put(
    "",
    response_model=IntegrationResponse,
    status_code=status.HTTP_200_OK,
    summary="Create or update a connector",
    dependencies=[Depends(rate_limit("integrations.write", per_minute=20))],
)
async def upsert_integration(
    payload: IntegrationUpsertRequest,
    service: SettingsDep,
    admin: AdminOnly,
    ctx: CanAdmin,
    audit: AuditDep,
) -> IntegrationResponse:
    """Rejects raw credentials in ``config`` — use ``secret_ref`` (§73)."""
    integration = await service.upsert_integration(payload)
    await audit(
        AuditAction.INTEGRATION_CHANGE,
        f"integration:{integration.kind.value}",
        detail={
            "operation": "upsert",
            "config_keys": sorted(payload.config),
            "credential_set": payload.secret_ref is not None,
        },
    )
    return integration


@router.post(
    "/{integration_id}/test",
    response_model=IntegrationTestResponse,
    summary="Test connectivity and record the result",
    dependencies=[Depends(rate_limit("integrations.test", per_minute=12, cost=2))],
)
async def test_integration(
    integration_id: str,
    service: SettingsDep,
    admin: AdminOnly,
    ctx: CanAdmin,
    audit: AuditDep,
) -> IntegrationTestResponse:
    """Marks the connector connected/error; the probe itself lives in the service."""
    result = await service.test_integration(integration_id)
    await audit(
        AuditAction.INTEGRATION_CHANGE,
        f"integration:{integration_id}",
        detail={"operation": "test", "status": result.status.value},
    )
    return result


@router.delete(
    "/{integration_id}",
    response_model=IntegrationResponse,
    summary="Disconnect a connector and drop its credential reference",
    dependencies=[Depends(rate_limit("integrations.write", per_minute=20))],
)
async def disconnect_integration(
    integration_id: str,
    service: SettingsDep,
    admin: AdminOnly,
    ctx: CanAdmin,
    audit: AuditDep,
) -> IntegrationResponse:
    integration = await service.disconnect_integration(integration_id)
    await audit(
        AuditAction.INTEGRATION_CHANGE,
        f"integration:{integration_id}",
        detail={"operation": "disconnect"},
    )
    return integration
