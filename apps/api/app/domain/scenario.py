"""Scenario / Rubric / Assignment models (spec §17 / §26 / §36).

Mirrors ``Scenario``, ``Rubric`` and ``Assignment`` in
``packages/shared-types/src/entities.ts``.
"""

from __future__ import annotations

from pydantic import Field

from app.domain.common import ID, DomainModel, ISODateTime, Score100, TenantScoped
from app.domain.enums import ContentStatus, Difficulty, SessionMode, SkillKey


class Scenario(TenantScoped):
    """§17 Scenario Builder entity (9-step wizard output)."""

    name: str
    version: int = Field(ge=1)
    status: ContentStatus
    description: str | None = None
    industry: str | None = None
    training_type: str | None = None
    persona_id: ID
    knowledge_base_ids: list[ID] = Field(default_factory=list)
    difficulty: Difficulty
    mode: SessionMode
    opening_context: str
    learning_objectives: list[str] = Field(default_factory=list)
    required_knowledge: list[str] = Field(default_factory=list)
    required_talking_points: list[str] = Field(default_factory=list)
    key_objections: list[str] = Field(default_factory=list)
    restricted_topics: list[str] = Field(default_factory=list)
    success_condition: str
    failure_condition: str
    time_limit_seconds: int | None = Field(default=None, ge=0)
    max_turns: int | None = Field(default=None, ge=1)
    minimum_score: Score100 | None = None
    rubric_id: ID | None = None


class ScenarioVersion(DomainModel):
    """Immutable scenario snapshot pinned by ``TrainingSession.scenario_version`` (§54)."""

    scenario_id: ID
    version: int = Field(ge=1)
    created_by: ID
    created_at: ISODateTime
    change_summary: str | None = None
    status: ContentStatus
    snapshot: dict[str, object] = Field(
        default_factory=dict, description="Full Scenario payload at this version"
    )


class CustomSkill(DomainModel):
    """``Rubric.custom_skills[]`` entry."""

    key: str
    label: str
    weight: float = Field(ge=0)


class Rubric(TenantScoped):
    """§26 / §28 scoring rubric."""

    name: str
    version: int = Field(ge=1)
    status: ContentStatus
    weights: dict[SkillKey, float]
    pass_threshold: Score100
    custom_skills: list[CustomSkill] | None = None
    required_evidence: list[str] = Field(default_factory=list)
    forbidden_behaviors: list[str] = Field(default_factory=list)


class Assignment(TenantScoped):
    """§36 Training Assignment."""

    scenario_id: ID
    assignee_user_ids: list[ID] = Field(default_factory=list)
    assignee_team_ids: list[ID] = Field(default_factory=list)
    deadline: ISODateTime | None = None
    max_attempts: int | None = Field(default=None, ge=1)
    minimum_score: Score100
    mandatory: bool
    prerequisite_assignment_id: ID | None = None
    mode: SessionMode
