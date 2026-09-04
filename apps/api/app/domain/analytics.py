"""Analytics models (spec §33 / §34 / §35 / §47).

``SkillProfile`` and ``Recommendation`` mirror
``packages/shared-types/src/entities.ts`` exactly. The remaining models are API-only
aggregates backing the Manager / Team Analytics page (§35); they have no TypeScript
counterpart yet, so they are additive and must not change the two mirrored shapes.
"""

from __future__ import annotations

from pydantic import Field

from app.domain.common import ID, DomainModel, ISODateTime, Score100
from app.domain.enums import ComplianceRisk, Difficulty, ExportFormat, ReportKind, SkillKey


class SkillProfile(DomainModel):
    """§34 individual growth profile."""

    user_id: ID
    overall_score: Score100
    skills: dict[SkillKey, float]
    weakest_skill: SkillKey
    strongest_skill: SkillKey
    monthly_improvement: float
    completed_sessions: int = Field(ge=0)
    compliance_trend: list[float] = Field(default_factory=list)
    days_to_readiness: int | None = Field(default=None, ge=0)


class KnowledgeMaterialSuggestion(DomainModel):
    """``Recommendation.knowledge_material[]`` entry."""

    document_id: ID
    reason: str


class Recommendation(DomainModel):
    """§33 closed-loop adaptive learning recommendation."""

    next_scenario_id: ID | None = None
    retry_scenario_id: ID | None = None
    knowledge_material: list[KnowledgeMaterialSuggestion] = Field(default_factory=list)
    question_set_ids: list[ID] = Field(default_factory=list)
    weak_skills: list[SkillKey] = Field(default_factory=list)
    suggested_difficulty: Difficulty


# ---------------------------------------------------------------------------
# §35 Manager / Team Analytics (API-only aggregates)
# ---------------------------------------------------------------------------


class AnalyticsFilter(DomainModel):
    """§35 filter set: team / user / role / scenario / date / skill / score / risk."""

    team_ids: list[ID] = Field(default_factory=list)
    user_ids: list[ID] = Field(default_factory=list)
    scenario_ids: list[ID] = Field(default_factory=list)
    skills: list[SkillKey] = Field(default_factory=list)
    since: ISODateTime | None = None
    until: ISODateTime | None = None
    min_score: Score100 | None = None
    max_score: Score100 | None = None
    min_risk: ComplianceRisk | None = None


class SkillMatrixCell(DomainModel):
    """One user x skill cell of the §35 skill matrix / weakness heatmap."""

    user_id: ID
    skill: SkillKey
    score: Score100
    sample_size: int = Field(ge=0)


class TeamMemberSummary(DomainModel):
    """Row of the §35 team table."""

    user_id: ID
    display_name: str
    team_ids: list[ID] = Field(default_factory=list)
    overall_score: Score100
    completed_sessions: int = Field(ge=0)
    pass_rate: float = Field(ge=0, le=1)
    highest_risk: ComplianceRisk
    readiness_days: int | None = Field(default=None, ge=0)


class TeamAnalytics(DomainModel):
    """§35 aggregate served to managers and admins."""

    team_average: Score100
    pass_rate: float = Field(ge=0, le=1)
    training_completion: float = Field(ge=0, le=1)
    compliance_risk: ComplianceRisk
    skill_matrix: list[SkillMatrixCell] = Field(default_factory=list)
    weakness_heatmap: dict[SkillKey, float] = Field(default_factory=dict)
    high_potential_user_ids: list[ID] = Field(default_factory=list)
    low_readiness_user_ids: list[ID] = Field(default_factory=list)
    knowledge_gap_document_ids: list[ID] = Field(default_factory=list)
    improvement_trend: list[float] = Field(default_factory=list)
    members: list[TeamMemberSummary] = Field(default_factory=list)


class Report(DomainModel):
    """§47 generated report record."""

    id: ID
    tenant_id: ID
    workspace_id: ID
    kind: ReportKind
    title: str
    requested_by: ID
    created_at: ISODateTime
    period_start: ISODateTime | None = None
    period_end: ISODateTime | None = None
    session_id: ID | None = None
    user_id: ID | None = None
    team_id: ID | None = None
    scenario_id: ID | None = None
    payload: dict[str, object] = Field(default_factory=dict)


class ReportExport(DomainModel):
    """Signed download handle for an exported report (§47)."""

    report_id: ID
    format: ExportFormat
    download_url: str
    expires_at: ISODateTime
