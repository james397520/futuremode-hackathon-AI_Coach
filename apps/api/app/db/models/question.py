"""Question / QuestionVersion ORM models (spec §14 / §15 / §53)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
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
from app.domain.enums import ContentStatus, Difficulty, QuestionType, SkillKey


class Question(
    IdMixin, TimestampMixin, TenantScopedMixin, ContentStatusMixin, SoftDeleteMixin, Base
):
    """§14 question. AI-generated rows must carry ``generated_by_model`` + citations (§15)."""

    __tablename__ = "question"
    __table_args__ = (
        scope_index("question", "status", "skill", "difficulty"),
        scope_index("question", "knowledge_base_id"),
    )

    title: Mapped[str] = mapped_column(String(300), nullable=False)
    type: Mapped[QuestionType] = mapped_column(
        enum_column(QuestionType, name="question_type"), nullable=False
    )
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    knowledge_base_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("knowledge_base.id", ondelete="SET NULL"), default=None
    )
    category: Mapped[str | None] = mapped_column(String(200), default=None)
    skill: Mapped[SkillKey | None] = mapped_column(
        enum_column(SkillKey, name="skill_key"), default=None
    )
    difficulty: Mapped[Difficulty] = mapped_column(
        enum_column(Difficulty, name="difficulty"), nullable=False, default=Difficulty.MEDIUM
    )
    correct_answer: Mapped[str | None] = mapped_column(Text, default=None)
    rubric: Mapped[str | None] = mapped_column(Text, default=None)
    required_keywords: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    forbidden_claims: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    compliance_rules: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    explanation: Mapped[str | None] = mapped_column(Text, default=None)
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    generated_by_model: Mapped[str | None] = mapped_column(String(120), default=None)
    citations: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSONB, default=None, comment="§12.5 Citation[] backing an AI-generated question"
    )

    versions: Mapped[list[QuestionVersion]] = relationship(
        back_populates="question", cascade="all, delete-orphan", lazy="raise"
    )


class QuestionVersion(IdMixin, TimestampMixin, TenantScopedMixin, Base):
    """Immutable snapshot so an answered question can always be re-rendered."""

    __tablename__ = "question_version"
    __table_args__ = (
        UniqueConstraint("question_id", "version", name="uq_question_version_question_version"),
        scope_index("question_version", "question_id"),
    )

    question_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("question.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by: Mapped[str] = mapped_column(String(32), nullable=False)
    change_summary: Mapped[str | None] = mapped_column(Text, default=None)
    status: Mapped[ContentStatus] = mapped_column(
        enum_column(ContentStatus, name="question_version_status"), nullable=False
    )
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    reviewed_at_snapshot: Mapped[datetime | None] = mapped_column(default=None)

    question: Mapped[Question] = relationship(back_populates="versions", lazy="raise")
