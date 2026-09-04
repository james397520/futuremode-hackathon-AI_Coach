"""Organization / Workspace / Team / User / role assignment (spec §10 / §53 / §74).

Hierarchy: ``Organization -> Workspace -> Department -> Team -> User``.

``Organization.id`` *is* the ``tenant_id`` used everywhere else; ``organization`` and
``workspace`` therefore do not carry a ``workspace_id`` and sit outside the
tenant-query guard on purpose (a caller must be able to list the workspaces of its own
tenant before selecting one).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, Column, ForeignKey, Index, String, Table, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin
from app.db.models.mixins import (
    SoftDeleteMixin,
    TenantScopedMixin,
    enum_column,
    scope_index,
)
from app.domain.enums import Role, WorkspaceKind

#: Many-to-many between users and teams (``User.team_ids`` in the contract).
user_team = Table(
    "user_team",
    Base.metadata,
    Column("user_id", String(32), ForeignKey("app_user.id", ondelete="CASCADE"), primary_key=True),
    Column("team_id", String(32), ForeignKey("team.id", ondelete="CASCADE"), primary_key=True),
    Index("ix_user_team_team_id", "team_id"),
)


class Organization(IdMixin, TimestampMixin, Base):
    """Top of the §74 hierarchy. Its id is the ``tenant_id`` of everything below."""

    __tablename__ = "organization"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    workspaces: Mapped[list[Workspace]] = relationship(
        back_populates="organization", cascade="all, delete-orphan", lazy="raise"
    )


class Workspace(IdMixin, TimestampMixin, SoftDeleteMixin, Base):
    """``Workspace extends Omit<TenantScoped, 'workspace_id'>`` (entities.ts)."""

    __tablename__ = "workspace"
    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_workspace_tenant_slug"),
        Index("ix_workspace_tenant_id", "tenant_id"),
    )

    tenant_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    kind: Mapped[WorkspaceKind] = mapped_column(
        enum_column(WorkspaceKind, name="workspace_kind"),
        nullable=False,
        default=WorkspaceKind.B2B,
    )

    organization: Mapped[Organization] = relationship(
        back_populates="workspaces", lazy="raise"
    )


class Team(IdMixin, TimestampMixin, TenantScopedMixin, SoftDeleteMixin, Base):
    """§10 team, optionally grouped under a department name."""

    __tablename__ = "team"
    __table_args__ = (scope_index("team", "name"),)

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    department: Mapped[str | None] = mapped_column(String(200), default=None, index=True)


class User(IdMixin, TimestampMixin, TenantScopedMixin, SoftDeleteMixin, Base):
    """§9 principal.

    ``email`` and ``display_name`` are PII: they are never written to a log line (the
    redaction processor in :mod:`app.core.logging` strips both keys) and are only
    returned to callers holding ``user:read``.
    """

    __tablename__ = "app_user"
    __table_args__ = (
        UniqueConstraint("tenant_id", "email", name="uq_app_user_tenant_email"),
        scope_index("app_user", "email"),
    )

    email: Mapped[str] = mapped_column(String(320), nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(200), default=None)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    locale: Mapped[str] = mapped_column(String(16), nullable=False, default="zh-TW")
    external_subject: Mapped[str | None] = mapped_column(
        String(255), default=None, index=True, comment="SSO/OIDC subject when federated (§43)"
    )
    last_login_at: Mapped[datetime | None] = mapped_column(default=None)

    teams: Mapped[list[Team]] = relationship(secondary=user_team, lazy="raise")
    role_assignments: Mapped[list[RoleAssignment]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="raise"
    )


class RoleAssignment(IdMixin, TimestampMixin, TenantScopedMixin, Base):
    """§53 ``Role`` — a role granted to a user *within one workspace*.

    Roles are workspace-scoped so the same person can be a coach in one workspace and a
    trainee in another; the access token embeds only the roles of the selected
    workspace (see :mod:`app.core.security`).
    """

    __tablename__ = "role_assignment"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "workspace_id",
            "user_id",
            "role",
            name="uq_role_assignment_scope_user_role",
        ),
        scope_index("role_assignment", "user_id"),
    )

    user_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("app_user.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[Role] = mapped_column(enum_column(Role, name="rbac_role"), nullable=False)
    granted_by: Mapped[str | None] = mapped_column(String(32), default=None)

    user: Mapped[User] = relationship(back_populates="role_assignments", lazy="raise")
