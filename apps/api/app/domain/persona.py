"""Persona entity + simulation state (spec §16 / §20 / §67).

Mirrors ``packages/shared/src/persona.ts`` and the ``Persona`` /
``PersonaVoiceConfig`` interfaces in ``entities.ts``.

``PersonaHiddenState`` is the persona's secret brief (§16.3). It must never be
serialised for a trainee: routers strip it via ``Persona.public_view()`` unless the
caller holds ``persona:read_hidden`` (see ``app.core.deps``).
"""

from __future__ import annotations

from pydantic import Field

from app.domain.common import ID, DomainModel, Score100, TenantScoped
from app.domain.enums import (
    ComplianceRisk,
    ContentStatus,
    PersonaEmotion,
    ScenarioPhase,
    VoiceProvider,
)


class PersonaSimulationState(DomainModel):
    """0–100 simulation variables driving the Persona State Card (§20).

    The UI is forbidden from inferring these values; it renders this payload verbatim.
    """

    scenario_phase: ScenarioPhase
    emotion: PersonaEmotion
    trust: Score100
    interest: Score100
    resistance: Score100
    patience: Score100
    intent: str
    current_goal: str
    budget: float | None = None
    hidden_need_revealed: bool
    compliance_risk: ComplianceRisk
    time_pressure: Score100 | None = None


class PersonaSimulationStateDelta(DomainModel):
    """``Partial<PersonaSimulationState>`` — per-turn delta for the §31 timeline."""

    scenario_phase: ScenarioPhase | None = None
    emotion: PersonaEmotion | None = None
    trust: Score100 | None = None
    interest: Score100 | None = None
    resistance: Score100 | None = None
    patience: Score100 | None = None
    intent: str | None = None
    current_goal: str | None = None
    budget: float | None = None
    hidden_need_revealed: bool | None = None
    compliance_risk: ComplianceRisk | None = None
    time_pressure: Score100 | None = None


class PersonaTraits(DomainModel):
    """Persona Builder sliders (§16.2)."""

    trust: Score100
    patience: Score100
    price_sensitivity: Score100
    risk_aversion: Score100
    product_knowledge: Score100
    resistance: Score100
    openness: Score100


class PersonaHiddenState(DomainModel):
    """Persona hidden configuration (§16.3) — never exposed to unauthorised roles."""

    primary_goal: str
    hidden_need: str
    main_concern: str
    budget: float | None = None
    trigger_points: list[str] = Field(default_factory=list)
    objections: list[str] = Field(default_factory=list)
    forbidden_knowledge: list[str] = Field(default_factory=list)
    opening_attitude: str
    exit_condition: str
    success_condition: str


class PersonaVoiceConfig(DomainModel):
    """Voice binding for the persona (§22 / §71)."""

    provider: VoiceProvider
    voice_id: str | None = None
    language: str
    speed: float = Field(ge=0.25, le=4.0)
    stability: float | None = Field(default=None, ge=0.0, le=1.0)
    emotion_style: str | None = None


class Persona(TenantScoped):
    """§16 Persona Builder entity."""

    name: str
    version: int = Field(ge=1)
    status: ContentStatus
    age: int | None = Field(default=None, ge=0, le=120)
    occupation: str | None = None
    industry: str | None = None
    background: str | None = None
    language: str
    locale: str
    traits: PersonaTraits
    hidden: PersonaHiddenState | None = None
    voice: PersonaVoiceConfig
    avatar_url: str | None = None

    def public_view(self) -> Persona:
        """Copy with ``hidden`` removed (§16.3) — what a trainee is allowed to see."""
        return self.model_copy(update={"hidden": None})


class PersonaStateEvent(DomainModel):
    """One persisted persona-state transition, powering replay (§30 / §31)."""

    id: ID
    session_id: ID
    timestamp_ms: int = Field(ge=0)
    turn_id: ID | None = None
    state: PersonaSimulationState
