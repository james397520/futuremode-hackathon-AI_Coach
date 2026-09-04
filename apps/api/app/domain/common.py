"""Shared model base, ID aliases and pagination envelopes.

``ID`` / ``ISODateTime`` mirror the aliases in ``packages/shared-types/src/entities.ts``.
``TenantScoped`` mirrors the ``TenantScoped`` interface exactly: every sensitive entity
carries ``tenant_id`` + ``workspace_id`` (§10 / §74).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

#: ``export type ID = string`` (entities.ts). UUIDv4 strings in practice.
ID = str
#: ``export type ISODateTime = string``; serialised by pydantic as RFC 3339.
ISODateTime = datetime

#: 0–100 simulation / score scale used across §20, §26 and §35.
Score100 = Annotated[float, Field(ge=0, le=100)]
#: 0–1 model confidence (§27).
Confidence = Annotated[float, Field(ge=0, le=1)]


class DomainModel(BaseModel):
    """Base for every domain model.

    ``extra="forbid"`` is deliberate: an unexpected field means the TypeScript contract
    and the Python mirror have drifted, and we want that to fail loudly in tests rather
    than silently drop data.
    """

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
        str_strip_whitespace=True,
        validate_assignment=True,
        use_enum_values=False,
        ser_json_timedelta="iso8601",
    )


class TenantScoped(DomainModel):
    """Common fields of every tenant-scoped entity (§10).

    Mirrors::

        interface TenantScoped {
          id: ID; tenant_id: ID; workspace_id: ID;
          created_at: ISODateTime; updated_at: ISODateTime;
        }
    """

    id: ID
    tenant_id: ID
    workspace_id: ID
    created_at: ISODateTime
    updated_at: ISODateTime


class OrganizationScoped(DomainModel):
    """``Omit<TenantScoped, 'workspace_id'>`` — used by ``Workspace``."""

    id: ID
    tenant_id: ID
    created_at: ISODateTime
    updated_at: ISODateTime


# ---------------------------------------------------------------------------
# Pagination (API-only; no TypeScript counterpart)
# ---------------------------------------------------------------------------

ItemT = TypeVar("ItemT")


class PageParams(DomainModel):
    """Offset pagination parameters shared by every list endpoint."""

    limit: int = Field(default=50, ge=1, le=200)
    offset: int = Field(default=0, ge=0)


class Page(DomainModel, Generic[ItemT]):
    """Uniform list envelope: ``{items, total, limit, offset}``."""

    items: list[ItemT]
    total: int = Field(ge=0)
    limit: int = Field(ge=1, le=200)
    offset: int = Field(ge=0)

    @property
    def has_more(self) -> bool:
        return self.offset + len(self.items) < self.total

    @classmethod
    def of(
        cls, items: list[ItemT], *, total: int, params: PageParams
    ) -> Page[ItemT]:
        return cls(items=items, total=total, limit=params.limit, offset=params.offset)


class Acknowledgement(DomainModel):
    """Minimal body for endpoints whose only useful answer is "done"."""

    ok: bool = True
    id: ID | None = None
