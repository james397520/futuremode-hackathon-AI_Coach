"""SQLAlchemy 2.0 declarative base.

Conventions
-----------
* Explicit index/constraint naming so Alembic autogenerate produces stable names.
* ``type_annotation_map`` pins the Postgres types we care about: timezone-aware
  timestamps everywhere (§40.2 retention math must not be ambiguous) and ``JSONB`` for
  metadata blobs.
* Primary keys are ``str`` UUID hex values generated in Python, so a service can build
  an object graph and emit events referencing the ids before the flush.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, MetaData, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING_CONVENTION: dict[str, str] = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

metadata_obj = MetaData(naming_convention=NAMING_CONVENTION)


def new_id() -> str:
    """Application-generated primary key (UUID4 hex, 32 chars)."""
    return uuid.uuid4().hex


class Base(DeclarativeBase):
    """Declarative base for every ORM model."""

    metadata = metadata_obj

    type_annotation_map = {  # noqa: RUF012 - SQLAlchemy reads this as a plain dict
        str: String(255),
        datetime: DateTime(timezone=True),
        dict[str, Any]: JSONB,
        list[str]: JSONB,
        dict[str, float]: JSONB,
    }

    def __repr__(self) -> str:
        identifier = getattr(self, "id", None)
        return f"<{type(self).__name__} id={identifier!r}>"


class IdMixin:
    """32-char UUID hex primary key."""

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)


class TimestampMixin:
    """``created_at`` / ``updated_at`` maintained by the database clock."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
