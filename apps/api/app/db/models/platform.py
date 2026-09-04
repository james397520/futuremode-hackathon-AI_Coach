"""AuditEvent / Integration / RuntimePolicy — platform-level tables (§42 / §43 / §44 / §61).

``audit_event`` is append-only: no service updates or deletes a row. It carries
``workspace_id`` as *nullable* because tenant-level actions (SSO change, role change at
org level) have no workspace, matching ``AuditEvent`` in ``entities.ts``. Because
``workspace_id`` is nullable this table is intentionally *outside* the tenant query
guard — audit reads go through :mod:`app.core.audit`, which always constrains
``tenant_id`` and requires the admin/reviewer permission.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, IdMixin, TimestampMixin
from app.db.models.mixins import TenantScopedMixin, enum_column, scope_index
from app.domain.enums import (
    AuditResult,
    ComplianceRisk,
    IntegrationKind,
    IntegrationStatus,
    WebGpuMode,
)


class AuditEvent(IdMixin, Base):
    """§42 audit row. Append-only; never mutated, never soft-deleted."""

    __tablename__ = "audit_event"
    __table_args__ = (
        Index("ix_audit_event_tenant_at", "tenant_id", "at"),
        Index("ix_audit_event_tenant_action_at", "tenant_id", "action", "at"),
        Index("ix_audit_event_tenant_user_at", "tenant_id", "user_id", "at"),
        Index("ix_audit_event_tenant_risk_at", "tenant_id", "risk", "at"),
    )

    tenant_id: Mapped[str] = mapped_column(String(32), nullable=False)
    workspace_id: Mapped[str | None] = mapped_column(String(32), default=None)
    at: Mapped[datetime] = mapped_column(nullable=False)
    user_id: Mapped[str | None] = mapped_column(String(32), default=None)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    resource: Mapped[str] = mapped_column(String(300), nullable=False)
    ip: Mapped[str | None] = mapped_column(String(64), default=None)
    session_ref: Mapped[str | None] = mapped_column(String(64), default=None)
    result: Mapped[AuditResult] = mapped_column(
        enum_column(AuditResult, name="audit_result"), nullable=False
    )
    risk: Mapped[ComplianceRisk] = mapped_column(
        enum_column(ComplianceRisk, name="audit_risk"),
        nullable=False,
        default=ComplianceRisk.SAFE,
    )
    #: Small, non-sensitive detail bag (ids, counts, changed field names — never values).
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=None)


class Integration(IdMixin, TimestampMixin, TenantScopedMixin, Base):
    """§43 connector card.

    Credentials are **not** stored here in the clear: ``secret_ref`` points at the
    secrets manager entry (§73 "secrets manager"). ``config`` holds non-secret settings
    only, and no read path ever returns ``secret_ref`` to a browser.
    """

    __tablename__ = "integration"
    __table_args__ = (
        UniqueConstraint("tenant_id", "workspace_id", "kind", name="uq_integration_scope_kind"),
        scope_index("integration", "status"),
    )

    kind: Mapped[IntegrationKind] = mapped_column(
        enum_column(IntegrationKind, name="integration_kind"), nullable=False
    )
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[IntegrationStatus] = mapped_column(
        enum_column(IntegrationStatus, name="integration_status"),
        nullable=False,
        default=IntegrationStatus.NOT_CONNECTED,
    )
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    secret_ref: Mapped[str | None] = mapped_column(String(300), default=None)
    last_sync_at: Mapped[datetime | None] = mapped_column(default=None)
    last_error: Mapped[str | None] = mapped_column(Text, default=None)
    updated_by: Mapped[str | None] = mapped_column(String(32), default=None)


class RuntimePolicy(IdMixin, TimestampMixin, TenantScopedMixin, Base):
    """§61 enterprise client-runtime policy, one row per workspace."""

    __tablename__ = "runtime_policy"
    __table_args__ = (
        UniqueConstraint("tenant_id", "workspace_id", name="uq_runtime_policy_scope"),
    )

    webgpu: Mapped[WebGpuMode] = mapped_column(
        enum_column(WebGpuMode, name="webgpu_mode"), nullable=False, default=WebGpuMode.AUTO
    )
    allow_local_model_cache: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )
    allow_sensitive_data_cache: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    clear_on_logout: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_by: Mapped[str | None] = mapped_column(String(32), default=None)
