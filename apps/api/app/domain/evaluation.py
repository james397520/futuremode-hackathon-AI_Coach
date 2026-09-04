"""Evaluation / Evidence / Compliance models (spec §26 / §27 / §28 / §32).

Mirrors the "Evaluation" section of ``packages/shared/src/entities.ts``.
Scoring without evidence is forbidden (§27): ``SkillScore.evidence`` is required and
``Evaluation`` rejects a payload whose skills carry no evidence at all.
"""

from __future__ import annotations

from pydantic import Field, model_validator

from app.domain.common import ID, Confidence, DomainModel, ISODateTime, Score100
from app.domain.enums import (
    ComplianceFindingType,
    ComplianceRisk,
    ReviewerStatus,
    SkillKey,
)


class EvaluationEvidence(DomainModel):
    """§27 Evidence-based Scoring — a quote plus what a better approach looks like."""

    timestamp_ms: int = Field(ge=0)
    transcript_turn_ids: list[ID] = Field(default_factory=list)
    quote: str
    issue: str | None = None
    better_approach: str | None = None


class SkillScore(DomainModel):
    """One scored dimension.

    ``skill`` is ``SkillKey | str``: custom rubric skills (§28) use a free-form key,
    matching ``skill: SkillKey | string`` in the TypeScript contract.
    """

    skill: SkillKey | str
    score: Score100
    confidence: Confidence
    rubric_note: str | None = None
    evidence: list[EvaluationEvidence] = Field(default_factory=list)
    improvement_suggestion: str | None = None


class HumanOverride(DomainModel):
    """§28 Rubric Calibration — a coach's explicit override of the AI score."""

    reviewer_id: ID
    score: Score100
    note: str | None = None
    at: ISODateTime


class Evaluation(DomainModel):
    """§26 evaluation result for one session."""

    id: ID
    session_id: ID
    rubric_id: ID
    overall_score: Score100
    goal_achieved: bool
    passed: bool
    skills: list[SkillScore] = Field(default_factory=list)
    key_strength: str
    main_improvement: str
    compliance_status: ComplianceRisk
    human_override: HumanOverride | None = None
    created_at: ISODateTime

    @model_validator(mode="after")
    def _require_evidence(self) -> Evaluation:
        """§27: refuse an evaluation that reports scores with zero supporting evidence."""
        if self.skills and not any(skill.evidence for skill in self.skills):
            raise ValueError(
                "Evaluation must carry at least one piece of evidence (spec §27 — "
                "scores without evidence are forbidden)"
            )
        return self


class ComplianceFinding(DomainModel):
    """§32 Compliance Report finding."""

    id: ID
    session_id: ID
    type: ComplianceFindingType
    severity: ComplianceRisk
    timestamp_ms: int = Field(ge=0)
    transcript_turn_id: ID | None = None
    evidence: str
    policy_rule: str | None = None
    explanation: str
    suggested_correction: str | None = None
    reviewer_status: ReviewerStatus
