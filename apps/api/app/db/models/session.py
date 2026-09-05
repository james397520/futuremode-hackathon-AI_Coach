"""TrainingSession / TranscriptTurn / PersonaStateEvent / CoachInsight (§23–§31 / §53 / §54).

Reproducibility (§54)
---------------------
``scenario_version`` and ``persona_version`` are **pinned at creation** and are
``NOT NULL``. Report generation resolves ``scenario_version`` -> ``scenario_version``
snapshot row rather than reading the live scenario, so editing content after a session
cannot change that session's report.

Retention (§40.2)
-----------------
Transcript turns are the most sensitive rows in the system: they carry verbatim learner
speech. They are soft-deleted and carry ``retention_expires_at`` so the retention worker
can purge them (together with the audio object in S3) on schedule. Their text is never
logged (see the redaction processor in :mod:`app.core.logging`).

The ORM primary key is ``id``; the wire field in ``entities.ts`` is ``session_id``.
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
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin
from app.db.models.mixins import SoftDeleteMixin, TenantScopedMixin, enum_column, scope_index
from app.domain.enums import (
    CoachInsightKind,
    ComputeBackend,
    SessionMode,
    SessionState,
    SpeakerKind,
)


class TrainingSession(IdMixin, TimestampMixin, TenantScopedMixin, SoftDeleteMixin, Base):
    """§54 core session record."""

    __tablename__ = "training_session"
    __table_args__ = (
        # §35 analytics: per-user history, per-scenario history, live/at-risk filters.
        scope_index("training_session", "user_id", "started_at"),
        scope_index("training_session", "scenario_id", "started_at"),
        scope_index("training_session", "status"),
        scope_index("training_session", "assignment_id"),
        Index(
            "ix_training_session_scope_mode_ended",
            "tenant_id",
            "workspace_id",
            "mode",
            "ended_at",
        ),
    )

    user_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("app_user.id", ondelete="RESTRICT"), nullable=False
    )
    scenario_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("scenario.id", ondelete="RESTRICT"), nullable=False
    )
    scenario_version: Mapped[int] = mapped_column(
        Integer, nullable=False, comment="§54 version pinning — do not update after creation"
    )
    persona_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("persona.id", ondelete="RESTRICT"), nullable=False
    )
    persona_version: Mapped[int] = mapped_column(
        Integer, nullable=False, comment="§54 version pinning — do not update after creation"
    )
    assignment_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("assignment.id", ondelete="SET NULL"), default=None
    )
    rubric_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("rubric.id", ondelete="SET NULL"), default=None
    )
    rubric_version: Mapped[int | None] = mapped_column(Integer, default=None)
    mode: Mapped[SessionMode] = mapped_column(
        enum_column(SessionMode, name="session_mode"), nullable=False
    )
    status: Mapped[SessionState] = mapped_column(
        enum_column(SessionState, name="session_state"),
        nullable=False,
        default=SessionState.IDLE,
    )
    started_at: Mapped[datetime] = mapped_column(nullable=False, index=True)
    ended_at: Mapped[datetime | None] = mapped_column(default=None)
    runtime: Mapped[ComputeBackend] = mapped_column(
        enum_column(ComputeBackend, name="compute_backend"),
        nullable=False,
        default=ComputeBackend.SERVER,
    )
    voice_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    score_live_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    turn_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: Last emitted streaming ``seq`` — lets a reconnecting client resume the gap (§68).
    last_event_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    #: Current persona simulation state (denormalised for fast reconnect).
    persona_state: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=None)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    turns: Mapped[list[TranscriptTurn]] = relationship(
        back_populates="session", cascade="all, delete-orphan", lazy="raise"
    )


class TranscriptTurn(IdMixin, TimestampMixin, TenantScopedMixin, SoftDeleteMixin, Base):
    """§25 one conversation turn. Verbatim learner content — see retention note above."""

    __tablename__ = "transcript_turn"
    __table_args__ = (
        scope_index("transcript_turn", "session_id", "timestamp_ms"),
        Index("ix_transcript_turn_session_seq", "session_id", "seq"),
    )

    session_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("training_session.id", ondelete="CASCADE"), nullable=False
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    speaker: Mapped[SpeakerKind] = mapped_column(
        enum_column(SpeakerKind, name="speaker_kind"), nullable=False
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    timestamp_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    audio_url: Mapped[str | None] = mapped_column(
        Text, default=None, comment="Signed, short-lived object-storage URL (§40.2)"
    )
    intent: Mapped[str | None] = mapped_column(String(120), default=None)
    citations: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, default=None)
    state_delta: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=None)
    score_event: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=None)
    #: Token accounting for §49.5 observability (counts only, never content).
    token_usage: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=None)

    session: Mapped[TrainingSession] = relationship(back_populates="turns", lazy="raise")


class PersonaStateEvent(IdMixin, TimestampMixin, TenantScopedMixin, SoftDeleteMixin, Base):
    """§31 persona/emotion timeline point, replayed by §30 Conversation Replay."""

    __tablename__ = "persona_state_event"
    __table_args__ = (scope_index("persona_state_event", "session_id", "timestamp_ms"),)

    session_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("training_session.id", ondelete="CASCADE"), nullable=False
    )
    turn_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("transcript_turn.id", ondelete="SET NULL"), default=None
    )
    timestamp_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    state: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, comment="Full PersonaSimulationState snapshot"
    )
    trust: Mapped[float | None] = mapped_column(
        Numeric(5, 2), default=None, comment="Denormalised for the §31 sparkline query"
    )
    compliance_risk: Mapped[str | None] = mapped_column(String(16), default=None)


class CoachInsight(IdMixin, TimestampMixin, TenantScopedMixin, SoftDeleteMixin, Base):
    """§23 AI Coach card.

    ``allowed_in_assessment`` is enforced on the read path as well as on emission: an
    assessment-mode session must never surface a hint or next-strategy insight (§8.4).
    """

    __tablename__ = "coach_insight"
    __table_args__ = (
        scope_index("coach_insight", "session_id", "timestamp_ms"),
        Index("ix_coach_insight_session_kind", "session_id", "kind"),
    )

    session_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("training_session.id", ondelete="CASCADE"), nullable=False
    )
    timestamp_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    kind: Mapped[CoachInsightKind] = mapped_column(
        enum_column(CoachInsightKind, name="coach_insight_kind"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    allowed_in_assessment: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
