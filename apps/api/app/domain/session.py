"""TrainingSession / TranscriptTurn / CoachInsight (spec §23 / §25 / §54).

Mirrors the "Session" section of ``packages/shared-types/src/entities.ts``.

``scenario_version`` and ``persona_version`` are *pinned* at session creation so a
report stays reproducible after the underlying content is edited (§54).
"""

from __future__ import annotations

from pydantic import Field

from app.domain.common import ID, DomainModel, ISODateTime, Score100
from app.domain.enums import (
    CoachInsightKind,
    ComputeBackend,
    SessionMode,
    SessionState,
    SkillKey,
    SpeakerKind,
)
from app.domain.knowledge import Citation
from app.domain.persona import PersonaSimulationStateDelta


class ScoreEvent(DomainModel):
    """``TranscriptTurn.score_event`` — live score nudge attributed to one turn."""

    skill: SkillKey
    delta: float


class TranscriptTurn(DomainModel):
    """§25 one conversation turn."""

    id: ID
    session_id: ID
    speaker: SpeakerKind
    text: str
    timestamp_ms: int = Field(ge=0)
    audio_url: str | None = None
    intent: str | None = None
    citations: list[Citation] | None = None
    state_delta: PersonaSimulationStateDelta | None = None
    score_event: ScoreEvent | None = None


class CoachInsight(DomainModel):
    """§23 AI Coach Card payload.

    ``allowed_in_assessment`` is authoritative: hint / next_strategy insights must not
    be delivered in Assessment Mode (§8.4 / §24).
    """

    id: ID
    session_id: ID
    timestamp_ms: int = Field(ge=0)
    kind: CoachInsightKind
    title: str
    body: str
    allowed_in_assessment: bool


class TrainingSession(DomainModel):
    """§54 core session record."""

    session_id: ID
    tenant_id: ID
    workspace_id: ID
    user_id: ID
    scenario_id: ID
    scenario_version: int = Field(ge=1, description="version pinning (§54)")
    persona_id: ID
    persona_version: int = Field(ge=1, description="version pinning (§54)")
    mode: SessionMode
    status: SessionState
    started_at: ISODateTime
    ended_at: ISODateTime | None = None
    runtime: ComputeBackend
    voice_enabled: bool
    score_live_enabled: bool
    turn_count: int = Field(ge=0)


class LiveScore(DomainModel):
    """§26 running per-skill score surfaced while a session is live."""

    skill: SkillKey
    score: Score100
    confidence: float = Field(ge=0, le=1)
