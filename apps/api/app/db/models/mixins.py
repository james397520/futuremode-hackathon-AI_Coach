"""Reusable column mixins and small helpers shared by every ORM model.

``TenantScopedMixin`` is the physical half of the §74 isolation invariant: the guard in
:mod:`app.core.tenancy` recognises a table as tenant-scoped purely by the presence of
both ``tenant_id`` and ``workspace_id``, so adding this mixin is what puts a table under
the guard. Both columns are ``NOT NULL`` and indexed, and every model additionally
declares a composite ``(tenant_id, workspace_id, …)`` index for its hot query path.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import TypeVar

from sqlalchemy import Enum as SaEnum
from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.domain.enums import ContentStatus

EnumT = TypeVar("EnumT", bound=StrEnum)


def enum_column(enum_cls: type[EnumT], *, name: str) -> SaEnum:
    """VARCHAR + CHECK constraint storing the *literal* contract values.

    Native PG enums are avoided deliberately: adding a value to the TypeScript union
    must not require an ``ALTER TYPE`` that locks the table.
    """
    return SaEnum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=64,
        values_callable=lambda enum: [member.value for member in enum],
    )


def scope_index(table: str, *columns: str, unique: bool = False) -> Index:
    """Composite index rooted at the tenancy columns.

    Every analytics query in §35 filters by tenant + workspace first, so leading with
    those columns keeps one index useful for both isolation and reporting.
    """
    suffix = "_".join(columns) if columns else "scope"
    prefix = "uq" if unique else "ix"
    return Index(
        f"{prefix}_{table}_scope_{suffix}",
        "tenant_id",
        "workspace_id",
        *columns,
        unique=unique,
    )


class TenantScopedMixin:
    """``tenant_id`` + ``workspace_id`` on every sensitive table (§10 / §74)."""

    tenant_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("organization.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    workspace_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("workspace.id", ondelete="RESTRICT"), nullable=False, index=True
    )


class SoftDeleteMixin:
    """Soft delete + retention (§40.2 data retention / data deletion).

    Rows are never hard-deleted by the API: ``deleted_at`` hides them and
    ``retention_expires_at`` tells the retention worker when the row (and any object
    storage / Qdrant payload it owns) may be purged for real.
    """

    deleted_at: Mapped[datetime | None] = mapped_column(default=None, index=True)
    deleted_by: Mapped[str | None] = mapped_column(String(32), default=None)
    retention_expires_at: Mapped[datetime | None] = mapped_column(default=None, index=True)

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


class ContentStatusMixin:
    """§38 content approval workflow columns."""

    status: Mapped[ContentStatus] = mapped_column(
        enum_column(ContentStatus, name="content_status"),
        nullable=False,
        default=ContentStatus.DRAFT,
        index=True,
    )
    reviewer_id: Mapped[str | None] = mapped_column(String(32), default=None)
    reviewed_at: Mapped[datetime | None] = mapped_column(default=None)
    published_at: Mapped[datetime | None] = mapped_column(default=None)
