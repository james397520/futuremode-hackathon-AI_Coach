"""Evaluation / EvaluationEvidence / ComplianceFinding / Report (§26–§32 / §47 / §53).

``Evaluation`` and its children carry ``tenant_id`` + ``workspace_id`` even though the
TypeScript ``Evaluation`` interface does not: the wire shape stays as specified, while
the rows sit under the §74 query guard like everything else. Analytics (§35) queries
these tables directly, so they must be scoped and indexed for it.

Evidence is a **table**, not a JSON blob, because §27 requires evidence to be
reviewable and queryable (the §39 Explainable Evidence panel filters by turn).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin
from app.db.models.mixins import SoftDeleteMixin, TenantScopedMixin, enum_column, scope_index
from app.domain.enums import (
    ComplianceFindingType,
    ComplianceRisk,
    ReportKind,
    ReviewerStatus,
)


class Evaluation(IdMixin, TimestampMixin, TenantScopedMixin, SoftDeleteMixin, Base):
    """§26 evaluation of one session."""

    __tablename__ = "evaluation"
    __table_args__ = (
        UniqueConstraint("session_id", name="uq_evaluation_session"),
        # §35: team averages, pass rates and skill matrices scan by scope + time.
        scope_index("evaluation", "created_at"),
        scope_index("evaluation", "user_id", "created_at"),
        scope_index("evaluation", "scenario_id", "created_at"),
        Index("ix_evaluation_scope_passed", "tenant_id", "workspace_id", "passed"),
    )

    session_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("training_session.id", ondelete="CASCADE"), nullable=False
    )
    #: Denormalised from the session so §35 aggregates avoid a join.
    user_id: Mapped[str] = mapped_column(String(32), nullable=False)
    scenario_id: Mapped[str] = mapped_column(String(32), nullable=False)
    rubric_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("rubric.id", ondelete="RESTRICT"), nullable=False
    )
    rubric_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    overall_score: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    goal_achieved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    skills: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list, comment="SkillScore[] without evidence bodies"
    )
    key_strength: Mapped[str] = mapped_column(Text, nullable=False)
    main_improvement: Mapped[str] = mapped_column(Text, nullable=False)
    compliance_status: Mapped[ComplianceRisk] = mapped_column(
        enum_column(ComplianceRisk, name="evaluation_compliance_risk"),
        nullable=False,
        default=ComplianceRisk.SAFE,
    )
    human_override: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, default=None, comment="§28 Rubric Calibration override"
    )
    evaluator_model: Mapped[str | None] = mapped_column(String(120), default=None)

    evidence: Mapped[list[EvaluationEvidence]] = relationship(
        back_populates="evaluation", cascade="all, delete-orphan", lazy="raise"
    )


class EvaluationEvidence(IdMixin, TimestampMixin, TenantScopedMixin, SoftDeleteMixin, Base):
    """§27 one quoted piece of evidence backing a skill score."""

    __tablename__ = "evaluation_evidence"
    __table_args__ = (
        scope_index("evaluation_evidence", "evaluation_id", "skill"),
        Index("ix_evaluation_evidence_evaluation", "evaluation_id", "timestamp_ms"),
    )

    evaluation_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("evaluation.id", ondelete="CASCADE"), nullable=False
    )
    skill: Mapped[str] = mapped_column(
        String(64), nullable=False, comment="SkillKey or a rubric custom-skill key (§28)"
    )
    timestamp_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    transcript_turn_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    quote: Mapped[str] = mapped_column(Text, nullable=False)
    issue: Mapped[str | None] = mapped_column(Text, default=None)
    better_approach: Mapped[str | None] = mapped_column(Text, default=None)

    evaluation: Mapped[Evaluation] = relationship(back_populates="evidence", lazy="raise")


class ComplianceFinding(IdMixin, TimestampMixin, TenantScopedMixin, SoftDeleteMixin, Base):
    """§32 compliance finding, triaged by the reviewer role (§9.5)."""

    __tablename__ = "compliance_finding"
    __table_args__ = (
        # §41 Security & Audit and §35 risk filters: open critical findings first.
        scope_index("compliance_finding", "severity", "reviewer_status"),
        scope_index("compliance_finding", "session_id"),
        scope_index("compliance_finding", "created_at"),
    )

    session_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("training_session.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[ComplianceFindingType] = mapped_column(
        enum_column(ComplianceFindingType, name="compliance_finding_type"), nullable=False
    )
    severity: Mapped[ComplianceRisk] = mapped_column(
        enum_column(ComplianceRisk, name="finding_severity"), nullable=False
    )
    timestamp_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    transcript_turn_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("transcript_turn.id", ondelete="SET NULL"), default=None
    )
    evidence: Mapped[str] = mapped_column(Text, nullable=False)
    policy_rule: Mapped[str | None] = mapped_column(String(300), default=None)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    suggested_correction: Mapped[str | None] = mapped_column(Text, default=None)
    reviewer_status: Mapped[ReviewerStatus] = mapped_column(
        enum_column(ReviewerStatus, name="finding_reviewer_status"),
        nullable=False,
        default=ReviewerStatus.OPEN,
    )
    reviewed_by: Mapped[str | None] = mapped_column(String(32), default=None)
    reviewed_at: Mapped[datetime | None] = mapped_column(default=None)
    reviewer_note: Mapped[str | None] = mapped_column(Text, default=None)


class Report(IdMixin, TimestampMixin, TenantScopedMixin, SoftDeleteMixin, Base):
    """§47 generated report. ``payload`` is the rendered aggregate at generation time."""

    __tablename__ = "report"
    __table_args__ = (
        scope_index("report", "kind", "created_at"),
        scope_index("report", "user_id"),
        scope_index("report", "team_id"),
    )

    kind: Mapped[ReportKind] = mapped_column(
        enum_column(ReportKind, name="report_kind"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    requested_by: Mapped[str] = mapped_column(String(32), nullable=False)
    period_start: Mapped[datetime | None] = mapped_column(default=None)
    period_end: Mapped[datetime | None] = mapped_column(default=None)
    session_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("training_session.id", ondelete="SET NULL"), default=None
    )
    user_id: Mapped[str | None] = mapped_column(String(32), default=None)
    team_id: Mapped[str | None] = mapped_column(String(32), default=None)
    scenario_id: Mapped[str | None] = mapped_column(String(32), default=None)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    #: Object-storage key of the last export; served via a short-lived signed URL.
    export_key: Mapped[str | None] = mapped_column(String(500), default=None)
