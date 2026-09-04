"""Scenario / ScenarioVersion / Rubric / Assignment ORM models (§17 / §26 / §36 / §53)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin
from app.db.models.mixins import (
    ContentStatusMixin,
    SoftDeleteMixin,
    TenantScopedMixin,
    enum_column,
    scope_index,
)
from app.domain.enums import ContentStatus, Difficulty, SessionMode


class Scenario(
    IdMixin, TimestampMixin, TenantScopedMixin, ContentStatusMixin, SoftDeleteMixin, Base
):
    """§17 scenario (9-step wizard). ``version`` is pinned onto every session (§54)."""

    __tablename__ = "scenario"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "workspace_id", "name", "version", name="uq_scenario_scope_name_version"
        ),
        scope_index("scenario", "status", "difficulty"),
        scope_index("scenario", "persona_id"),
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    description: Mapped[str | None] = mapped_column(Text, default=None)
    industry: Mapped[str | None] = mapped_column(String(200), default=None, index=True)
    training_type: Mapped[str | None] = mapped_column(String(200), default=None)
    persona_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("persona.id", ondelete="RESTRICT"), nullable=False
    )
    knowledge_base_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    difficulty: Mapped[Difficulty] = mapped_column(
        enum_column(Difficulty, name="scenario_difficulty"),
        nullable=False,
        default=Difficulty.MEDIUM,
    )
    mode: Mapped[SessionMode] = mapped_column(
        enum_column(SessionMode, name="scenario_mode"), nullable=False, default=SessionMode.TRAINING
    )
    opening_context: Mapped[str] = mapped_column(Text, nullable=False)
    learning_objectives: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    required_knowledge: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    required_talking_points: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    key_objections: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    restricted_topics: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    success_condition: Mapped[str] = mapped_column(Text, nullable=False)
    failure_condition: Mapped[str] = mapped_column(Text, nullable=False)
    time_limit_seconds: Mapped[int | None] = mapped_column(Integer, default=None)
    max_turns: Mapped[int | None] = mapped_column(Integer, default=None)
    minimum_score: Mapped[float | None] = mapped_column(Numeric(5, 2), default=None)
    rubric_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("rubric.id", ondelete="SET NULL"), default=None
    )

    versions: Mapped[list[ScenarioVersion]] = relationship(
        back_populates="scenario", cascade="all, delete-orphan", lazy="raise"
    )


class ScenarioVersion(IdMixin, TimestampMixin, TenantScopedMixin, Base):
    """Immutable scenario snapshot resolved by ``TrainingSession.scenario_version`` (§54).

    A report generated months later re-reads this row, not the live scenario, so editing
    a scenario can never retroactively change a completed session's report.
    """

    __tablename__ = "scenario_version"
    __table_args__ = (
        UniqueConstraint("scenario_id", "version", name="uq_scenario_version_scenario_version"),
        scope_index("scenario_version", "scenario_id"),
    )

    scenario_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("scenario.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by: Mapped[str] = mapped_column(String(32), nullable=False)
    change_summary: Mapped[str | None] = mapped_column(Text, default=None)
    status: Mapped[ContentStatus] = mapped_column(
        enum_column(ContentStatus, name="scenario_version_status"), nullable=False
    )
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    #: Persona version bundled with this scenario version, so the pair is reproducible.
    persona_version: Mapped[int | None] = mapped_column(Integer, default=None)

    scenario: Mapped[Scenario] = relationship(back_populates="versions", lazy="raise")


class Rubric(
    IdMixin, TimestampMixin, TenantScopedMixin, ContentStatusMixin, SoftDeleteMixin, Base
):
    """§26 / §28 rubric. ``weights`` maps ``SkillKey`` -> weight."""

    __tablename__ = "rubric"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "workspace_id", "name", "version", name="uq_rubric_scope_name_version"
        ),
        scope_index("rubric", "status"),
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    weights: Mapped[dict[str, float]] = mapped_column(JSONB, nullable=False, default=dict)
    pass_threshold: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=80)
    custom_skills: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, default=None)
    required_evidence: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    forbidden_behaviors: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)


class Assignment(IdMixin, TimestampMixin, TenantScopedMixin, SoftDeleteMixin, Base):
    """§36 training assignment."""

    __tablename__ = "assignment"
    __table_args__ = (
        scope_index("assignment", "scenario_id", "deadline"),
        scope_index("assignment", "deadline"),
    )

    scenario_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("scenario.id", ondelete="CASCADE"), nullable=False
    )
    assignee_user_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    assignee_team_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    deadline: Mapped[datetime | None] = mapped_column(default=None)
    max_attempts: Mapped[int | None] = mapped_column(Integer, default=None)
    minimum_score: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False, default=80)
    mandatory: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    prerequisite_assignment_id: Mapped[str | None] = mapped_column(String(32), default=None)
    mode: Mapped[SessionMode] = mapped_column(
        enum_column(SessionMode, name="assignment_mode"),
        nullable=False,
        default=SessionMode.TRAINING,
    )
    created_by: Mapped[str | None] = mapped_column(String(32), default=None)
