"""Platform settings: integrations, client runtime policy, audit reads (§42 / §43 / §61).

Secret handling: :class:`PlatformSettingsService` stores only a ``secret_ref`` pointing
at the secrets manager and never returns it to a caller (§73). Provider keys themselves
live in the process environment and are read exclusively by the agents/RAG layer
(§56 / §70 / §71).
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import httpx
from sqlalchemy import func, select

from app.core.config import get_settings
from app.core.errors import NotFoundError, ValidationFailedError
from app.core.tenancy import ScopedRepository, allow_cross_tenant, scope_from_context
from app.db.models.platform import AuditEvent, Integration, RuntimePolicy
from app.domain.audit import AuditEvent as AuditEventModel
from app.domain.audit import AuditQuery
from app.domain.common import Page, PageParams
from app.domain.enums import (
    AuditResult,
    ComplianceRisk,
    ComputeBackend,
    IntegrationKind,
    IntegrationStatus,
)
from app.domain.request_response import (
    IntegrationResponse,
    IntegrationTestResponse,
    IntegrationUpsertRequest,
    RuntimeCapabilityReport,
    RuntimePolicyResponse,
    RuntimePolicyUpdateRequest,
)
from app.domain.runtime import RuntimePolicy as RuntimePolicyModel

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.core.context import RequestContext

#: Config keys that must never be accepted through the integrations API — a raw
#: provider credential belongs in the secrets manager, not in a JSONB column.
_FORBIDDEN_CONFIG_KEYS: frozenset[str] = frozenset(
    {"api_key", "apikey", "secret", "password", "token", "private_key", "client_secret"}
)


class PlatformSettingsService:
    """Integrations (§43) and the client runtime policy (§44 / §61)."""

    __slots__ = ("ctx", "db")

    def __init__(self, db: AsyncSession, ctx: RequestContext) -> None:
        self.db = db
        self.ctx = ctx

    @property
    def repo(self) -> ScopedRepository:
        return ScopedRepository(self.db, scope_from_context(self.ctx))

    # ---- integrations ---------------------------------------------------
    async def list_integrations(self) -> list[IntegrationResponse]:
        rows = await self.repo.list(
            Integration, order_by=[Integration.kind], limit=200, offset=0
        )
        return [self._integration_response(row) for row in rows]

    async def upsert_integration(
        self, payload: IntegrationUpsertRequest
    ) -> IntegrationResponse:
        offending = sorted(
            key for key in payload.config if key.lower() in _FORBIDDEN_CONFIG_KEYS
        )
        if offending:
            raise ValidationFailedError(
                "Credentials must be stored in the secrets manager and referenced by "
                "secret_ref; remove: " + ", ".join(offending) + "."
            )
        scope = scope_from_context(self.ctx)
        existing = await self.db.execute(
            self.repo.select(Integration).where(Integration.kind == payload.kind)
        )
        integration = existing.scalars().first()
        if integration is None:
            integration = Integration(
                tenant_id=scope.tenant_id,
                workspace_id=scope.workspace_id,
                kind=payload.kind,
                display_name=payload.display_name or payload.kind.value,
                config=dict(payload.config),
                secret_ref=payload.secret_ref,
                status=IntegrationStatus.NOT_CONNECTED,
            )
            self.db.add(integration)
        else:
            if payload.display_name is not None:
                integration.display_name = payload.display_name
            integration.config = dict(payload.config)
            if payload.secret_ref is not None:
                integration.secret_ref = payload.secret_ref
        integration.updated_by = self.ctx.user_id
        await self.db.flush()
        return self._integration_response(integration)

    async def mark_integration_status(
        self,
        integration_id: str,
        *,
        status: IntegrationStatus,
        error: str | None = None,
        synced: bool = False,
    ) -> IntegrationResponse:
        integration = await self.repo.require(Integration, integration_id)
        integration.status = status
        integration.last_error = error
        if synced:
            integration.last_sync_at = datetime.now(tz=UTC)
        await self.db.flush()
        return self._integration_response(integration)

    async def test_integration(self, integration_id: str) -> IntegrationTestResponse:
        """Probe a connector and persist the outcome (§43 "Test").

        The probe is deliberately narrow: reachability of the configured endpoint, or
        presence of a credential for providers whose calls belong to the agents layer
        (§70 / §71). This endpoint never sends a provider key anywhere.
        """
        integration = await self.repo.require(Integration, integration_id)
        settings = get_settings()
        started = time.perf_counter()
        target: str | None = None
        message: str | None = None

        if integration.kind is IntegrationKind.QDRANT:
            target = f"{settings.qdrant_url.rstrip('/')}/readyz"
        elif integration.kind is IntegrationKind.OBJECT_STORAGE:
            target = settings.s3_endpoint
        elif integration.kind is IntegrationKind.OPENAI:
            ok = settings.openai_api_key is not None
            message = None if ok else "OPENAI_API_KEY is not configured on the API."
            return await self._record_test(integration, ok, None, message)
        elif integration.kind is IntegrationKind.ELEVENLABS:
            ok = settings.elevenlabs_api_key is not None
            message = None if ok else "ELEVENLABS_API_KEY is not configured on the API."
            return await self._record_test(integration, ok, None, message)
        else:
            target = (integration.config or {}).get("url")
            if not target:
                return await self._record_test(
                    integration, False, None, "這個連接器沒有設定 url。"
                )

        try:
            async with httpx.AsyncClient(timeout=5.0, follow_redirects=False) as client:
                response = await client.get(target)
            # Any HTTP answer proves reachability; auth-level failures are reported.
            ok = response.status_code < 500
            if not ok:
                message = f"端點回應 HTTP {response.status_code}。"
        except (httpx.HTTPError, OSError):
            ok = False
            message = "API 無法連線到這個端點。"
        latency_ms = (time.perf_counter() - started) * 1000
        return await self._record_test(integration, ok, latency_ms, message)

    async def _record_test(
        self,
        integration: Integration,
        ok: bool,
        latency_ms: float | None,
        message: str | None,
    ) -> IntegrationTestResponse:
        integration.status = (
            IntegrationStatus.CONNECTED if ok else IntegrationStatus.ERROR
        )
        integration.last_error = None if ok else message
        if ok:
            integration.last_sync_at = datetime.now(tz=UTC)
        await self.db.flush()
        return IntegrationTestResponse(
            status=integration.status, latency_ms=latency_ms, message=message
        )

    async def disconnect_integration(self, integration_id: str) -> IntegrationResponse:
        integration = await self.repo.require(Integration, integration_id)
        integration.status = IntegrationStatus.NOT_CONNECTED
        integration.secret_ref = None
        integration.last_error = None
        integration.updated_by = self.ctx.user_id
        await self.db.flush()
        return self._integration_response(integration)

    @staticmethod
    def _integration_response(integration: Integration) -> IntegrationResponse:
        return IntegrationResponse(
            id=integration.id,
            kind=integration.kind,
            display_name=integration.display_name,
            status=integration.status,
            config={key: str(value) for key, value in (integration.config or {}).items()},
            has_credential=bool(integration.secret_ref),
            last_sync_at=integration.last_sync_at,
            last_error=integration.last_error,
            updated_at=integration.updated_at,
        )

    # ---- runtime policy -------------------------------------------------
    async def _policy_row(self) -> RuntimePolicy | None:
        result = await self.db.execute(self.repo.select(RuntimePolicy))
        return result.scalars().first()

    async def get_policy(self) -> RuntimePolicyModel:
        """Workspace policy, falling back to the environment defaults (§61)."""
        row = await self._policy_row()
        settings = get_settings()
        if row is None:
            return RuntimePolicyModel(
                webgpu=settings.webgpu_mode,
                allow_local_model_cache=settings.allow_local_model_cache,
                allow_sensitive_data_cache=settings.allow_sensitive_data_cache,
                clear_on_logout=settings.clear_on_logout,
            )
        return RuntimePolicyModel(
            webgpu=row.webgpu,
            allow_local_model_cache=row.allow_local_model_cache,
            allow_sensitive_data_cache=row.allow_sensitive_data_cache,
            clear_on_logout=row.clear_on_logout,
        )

    async def update_policy(
        self, payload: RuntimePolicyUpdateRequest
    ) -> RuntimePolicyModel:
        scope = scope_from_context(self.ctx)
        row = await self._policy_row()
        if row is None:
            current = await self.get_policy()
            row = RuntimePolicy(
                tenant_id=scope.tenant_id,
                workspace_id=scope.workspace_id,
                webgpu=current.webgpu,
                allow_local_model_cache=current.allow_local_model_cache,
                allow_sensitive_data_cache=current.allow_sensitive_data_cache,
                clear_on_logout=current.clear_on_logout,
            )
            self.db.add(row)
        if payload.webgpu is not None:
            row.webgpu = payload.webgpu
        if payload.allow_local_model_cache is not None:
            row.allow_local_model_cache = payload.allow_local_model_cache
        if payload.allow_sensitive_data_cache is not None:
            row.allow_sensitive_data_cache = payload.allow_sensitive_data_cache
        if payload.clear_on_logout is not None:
            row.clear_on_logout = payload.clear_on_logout
        row.updated_by = self.ctx.user_id
        await self.db.flush()
        return await self.get_policy()

    async def advise_runtime(
        self, report: RuntimeCapabilityReport | None = None
    ) -> RuntimePolicyResponse:
        """Combine the policy with the client's capability report (§59 / §62).

        The server is always authoritative: local execution is *advice*, and every task
        listed here also has a server implementation, so a client that cannot run
        anything locally loses acceleration, not functionality (§51).
        """
        policy = await self.get_policy()
        capability = report.capability if report else None
        reason: str | None = None
        backend = ComputeBackend.SERVER
        if policy.webgpu == "off":
            reason = "工作區政策已停用本機加速（§61）。"
        elif capability is None:
            reason = "沒有裝置能力回報，改用伺服器推論。"
        elif capability.webgpu and policy.webgpu in ("auto", "on"):
            backend = ComputeBackend.WEBGPU
        elif capability.wasm_simd:
            backend = ComputeBackend.WASM
            reason = "WebGPU 無法使用，改用 WASM；練習不受影響（§94）。"
        else:
            reason = "這台裝置無法執行本機模型，改用伺服器加速。"

        local_tasks: list[str] = []
        if backend is not ComputeBackend.SERVER and policy.allow_local_model_cache:
            local_tasks = [
                "embedding",
                "intent_classification",
                "reranking",
                "safety_precheck",
            ]
        return RuntimePolicyResponse(
            policy=policy,
            recommended_backend=backend,
            local_tasks_enabled=local_tasks,
            reason=reason,
        )


class AuditReader:
    """Read-only §42 audit access for admins and reviewers.

    ``audit_event`` has a nullable ``workspace_id`` (tenant-level actions have no
    workspace), so it sits outside the automatic query guard. Every read here therefore
    pins ``tenant_id`` explicitly and, for non-admins, the caller's workspace.
    """

    __slots__ = ("ctx", "db")

    def __init__(self, db: AsyncSession, ctx: RequestContext) -> None:
        self.db = db
        self.ctx = ctx

    async def query(self, filters: AuditQuery) -> Page[AuditEventModel]:
        criteria = [AuditEvent.tenant_id == self.ctx.tenant_id]
        if not self.ctx.is_admin and self.ctx.workspace_id:
            criteria.append(AuditEvent.workspace_id == self.ctx.workspace_id)
        if filters.action is not None:
            criteria.append(AuditEvent.action == filters.action.value)
        if filters.user_id is not None:
            criteria.append(AuditEvent.user_id == filters.user_id)
        if filters.resource is not None:
            criteria.append(AuditEvent.resource.ilike(f"{filters.resource}%"))
        if filters.result is not None:
            criteria.append(AuditEvent.result == filters.result)
        if filters.risk is not None:
            criteria.append(AuditEvent.risk == filters.risk)
        if filters.since is not None:
            criteria.append(AuditEvent.at >= filters.since)
        if filters.until is not None:
            criteria.append(AuditEvent.at <= filters.until)

        total_result = await self.db.execute(
            allow_cross_tenant(
                select(func.count()).select_from(AuditEvent).where(*criteria),
                reason="audit_event has a nullable workspace_id; tenant is pinned above",
            )
        )
        rows_result = await self.db.execute(
            allow_cross_tenant(
                select(AuditEvent)
                .where(*criteria)
                .order_by(AuditEvent.at.desc())
                .limit(filters.limit)
                .offset(filters.offset),
                reason="audit_event has a nullable workspace_id; tenant is pinned above",
            )
        )
        params = PageParams(limit=filters.limit, offset=filters.offset)
        items = [self._to_model(row) for row in rows_result.scalars().all()]
        return Page.of(items, total=int(total_result.scalar_one()), params=params)

    async def get(self, event_id: str) -> AuditEventModel:
        result = await self.db.execute(
            allow_cross_tenant(
                select(AuditEvent).where(
                    AuditEvent.id == event_id,
                    AuditEvent.tenant_id == self.ctx.tenant_id,
                ),
                reason="audit_event has a nullable workspace_id; tenant is pinned above",
            )
        )
        row = result.scalars().first()
        if row is None:
            raise NotFoundError.of("audit event", event_id)
        return self._to_model(row)

    @staticmethod
    def _to_model(row: AuditEvent) -> AuditEventModel:
        return AuditEventModel(
            id=row.id,
            tenant_id=row.tenant_id,
            workspace_id=row.workspace_id,
            at=row.at,
            user_id=row.user_id,
            action=row.action,
            resource=row.resource,
            ip=row.ip,
            session_ref=row.session_ref,
            result=AuditResult(row.result),
            risk=ComplianceRisk(row.risk),
        )
