"""Question Bank models (spec §14 / §15).

Mirrors the "Question Bank" section of ``packages/shared/src/entities.ts``.
AI-generated questions must carry their source model, citations and review record (§15).
"""

from __future__ import annotations

from pydantic import Field, model_validator

from app.domain.common import ID, DomainModel, ISODateTime, TenantScoped
from app.domain.enums import ContentStatus, Difficulty, QuestionType, SkillKey
from app.domain.knowledge import Citation


class Question(TenantScoped):
    """§14 Question entity."""

    title: str
    type: QuestionType
    prompt: str
    knowledge_base_id: ID | None = None
    category: str | None = None
    skill: SkillKey | None = None
    difficulty: Difficulty
    correct_answer: str | None = None
    rubric: str | None = None
    required_keywords: list[str] = Field(default_factory=list)
    forbidden_claims: list[str] = Field(default_factory=list)
    compliance_rules: list[str] = Field(default_factory=list)
    explanation: str | None = None
    tags: list[str] = Field(default_factory=list)
    version: int = Field(ge=1)
    status: ContentStatus
    generated_by_model: str | None = None
    citations: list[Citation] | None = None
    reviewer_id: ID | None = None
    reviewed_at: ISODateTime | None = None

    @model_validator(mode="after")
    def _generated_content_needs_review_trail(self) -> Question:
        """§15 / §38: a published AI-generated question must have been reviewed."""
        if (
            self.generated_by_model
            and self.status == ContentStatus.PUBLISHED
            and (self.reviewer_id is None or self.reviewed_at is None)
        ):
            raise ValueError(
                "AI-generated questions cannot be published without reviewer_id and "
                "reviewed_at (spec §15/§38)"
            )
        return self


class QuestionVersion(DomainModel):
    """§14 immutable snapshot of a question, kept so reports stay reproducible."""

    question_id: ID
    version: int = Field(ge=1)
    created_by: ID
    created_at: ISODateTime
    change_summary: str | None = None
    status: ContentStatus
    snapshot: dict[str, object] = Field(
        default_factory=dict, description="Full Question payload at this version"
    )
