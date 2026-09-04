"""Persona ORM model (spec §16 / §53).

``hidden`` holds the §16.3 secret brief. It is a normal JSONB column, but the read path
strips it unless the caller holds ``persona:read_hidden`` — see
``Persona.public_view()`` in :mod:`app.domain.persona` and the permission matrix in
:mod:`app.core.deps`.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, IdMixin, TimestampMixin
from app.db.models.mixins import (
    ContentStatusMixin,
    SoftDeleteMixin,
    TenantScopedMixin,
    scope_index,
)


class Persona(
    IdMixin, TimestampMixin, TenantScopedMixin, ContentStatusMixin, SoftDeleteMixin, Base
):
    """§16 persona. ``version`` is pinned by ``TrainingSession.persona_version`` (§54)."""

    __tablename__ = "persona"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "workspace_id",
            "name",
            "version",
            name="uq_persona_scope_name_version",
        ),
        scope_index("persona", "status", "name"),
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    age: Mapped[int | None] = mapped_column(Integer, default=None)
    occupation: Mapped[str | None] = mapped_column(String(200), default=None)
    industry: Mapped[str | None] = mapped_column(String(200), default=None, index=True)
    background: Mapped[str | None] = mapped_column(Text, default=None)
    language: Mapped[str] = mapped_column(String(16), nullable=False, default="zh-TW")
    locale: Mapped[str] = mapped_column(String(16), nullable=False, default="zh-TW")
    traits: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, comment="§16.2 PersonaTraits sliders"
    )
    hidden: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, default=None, comment="§16.3 PersonaHiddenState — coach/admin only"
    )
    voice: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, comment="PersonaVoiceConfig (§22/§71)"
    )
    avatar_url: Mapped[str | None] = mapped_column(Text, default=None)
