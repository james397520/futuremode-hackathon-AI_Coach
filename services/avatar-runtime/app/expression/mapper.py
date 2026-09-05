"""Persona simulation state → expression (§13, §8, §46).

§13 sketches the mapping as a five-line ``if`` ladder over a toy dict. The real
upstream contract is ``packages/shared/src/persona.ts``'s
``PersonaSimulationState``::

    scenario_phase  emotion   trust   interest   resistance   patience
    intent          current_goal      budget     hidden_need_revealed
    compliance_risk time_pressure

so this module reads *those* fields. §13 itself says as much — "實際產品應同時看
emotion / resistance / trust / interest / current intent / scenario phase".

Structure
---------
The ladder is expressed as an ordered list of :class:`ExpressionRule`, each
carrying **bands** rather than single thresholds. A band knows both the value at
which a state is entered and the value at which it is left, which is what makes
§12's hysteresis possible without a second copy of the mapping logic living in
the controller. :func:`map_persona_state` evaluates the rules with no history —
that is §13's pure function, and the boundary tests pin it — while
:class:`~app.expression.controller.ExpressionController` evaluates the same
rules *with* history.

ADR-002: the LLM never writes model parameters. It writes these scalars, and
this file decides what a face does about them.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Final, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.expression.presets import ExpressionName, ExpressionState, Gaze, preset


class ScenarioPhase(StrEnum):
    """Mirrors ``ScenarioPhase`` in packages/shared/src/persona.ts."""

    OPENING = "opening"
    NEEDS_DISCOVERY = "needs_discovery"
    PRESENTATION = "presentation"
    OBJECTION_HANDLING = "objection_handling"
    CLOSING = "closing"
    ENDED = "ended"


class PersonaEmotion(StrEnum):
    """Mirrors ``PersonaEmotion`` in packages/shared/src/persona.ts."""

    NEUTRAL = "neutral"
    CURIOUS = "curious"
    SKEPTICAL = "skeptical"
    FRUSTRATED = "frustrated"
    INTERESTED = "interested"
    REASSURED = "reassured"
    READY = "ready"


class ComplianceRisk(StrEnum):
    """Mirrors ``ComplianceRisk`` in packages/shared/src/persona.ts."""

    SAFE = "safe"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


#: Categorical risk → a 0–100 scalar so it can share the band machinery.
_RISK_SCALE: Final[dict[ComplianceRisk, float]] = {
    ComplianceRisk.SAFE: 0.0,
    ComplianceRisk.LOW: 25.0,
    ComplianceRisk.MEDIUM: 50.0,
    ComplianceRisk.HIGH: 75.0,
    ComplianceRisk.CRITICAL: 100.0,
}


class PersonaSnapshot(BaseModel):
    """One ``POST /sessions/{id}/state`` payload (§43).

    Every ``PersonaSimulationState`` field is accepted, plus the four §8
    runtime hints (``speaking``, ``listening``, ``gaze``, ``energy``) that
    describe the *turn*, not the persona. Unknown fields are ignored rather
    than rejected: the Scenario Director owns that schema and will add to it,
    and an avatar that 422s on a new persona field would take the training
    session down with it (ADR-009).
    """

    model_config = ConfigDict(extra="ignore", frozen=True)

    # --- PersonaSimulationState ---
    scenario_phase: ScenarioPhase = ScenarioPhase.OPENING
    emotion: PersonaEmotion = PersonaEmotion.NEUTRAL
    trust: float = Field(default=50.0, ge=0.0, le=100.0)
    interest: float = Field(default=50.0, ge=0.0, le=100.0)
    resistance: float = Field(default=50.0, ge=0.0, le=100.0)
    patience: float = Field(default=50.0, ge=0.0, le=100.0)
    intent: str = ""
    current_goal: str = ""
    budget: float | None = None
    hidden_need_revealed: bool = False
    compliance_risk: ComplianceRisk = ComplianceRisk.SAFE
    time_pressure: float | None = Field(default=None, ge=0.0, le=100.0)
    # --- §8 turn hints ---
    emotion_intensity: float | None = Field(default=None, ge=0.0, le=1.0)
    speaking: bool = False
    listening: bool = True
    gaze: Gaze | None = None
    energy: float | None = Field(default=None, ge=0.0, le=1.0)


@dataclass(frozen=True, slots=True)
class PersonaMetrics:
    """The derived scalars the rules actually read.

    Two derivations happen here rather than in the rules, so the thresholds in
    :data:`RULES` stay literally comparable to §13's numbers:

    ``interest``
        gains a bonus once the hidden need is revealed. A customer who has just
        admitted what they actually want is measurably more engaged than the
        same interest score before the reveal, and the face should show it.

    ``patience``
        is reduced by ``time_pressure``. "I have five minutes" and "I am
        relaxed" produce very different faces at identical patience scores.
    """

    trust: float
    interest: float
    resistance: float
    patience: float
    risk: float
    listening: bool
    speaking: bool
    emotion: PersonaEmotion
    phase: ScenarioPhase

    @classmethod
    def of(cls, state: PersonaSnapshot) -> PersonaMetrics:
        interest = state.interest + (8.0 if state.hidden_need_revealed else 0.0)
        patience = state.patience - 0.25 * (state.time_pressure or 0.0)
        return cls(
            trust=state.trust,
            interest=max(0.0, min(100.0, interest)),
            resistance=state.resistance,
            patience=max(0.0, min(100.0, patience)),
            risk=_RISK_SCALE[state.compliance_risk],
            listening=state.listening,
            speaking=state.speaking,
            emotion=state.emotion,
            phase=state.scenario_phase,
        )

    def value(self, metric: str) -> float:
        return float(getattr(self, metric))


Mode = Literal["above", "below"]


@dataclass(frozen=True, slots=True)
class Band:
    """A threshold with separate enter and exit values (§12).

    ``mode="above"``: entered at ``value >= enter``, held while ``value > exit``.
    ``mode="below"``: entered at ``value <= enter``, held while ``value < exit``.

    The gap between ``enter`` and ``exit`` is the whole point. §12's worked
    example is skeptical: enter at resistance 65, leave only at 52. A persona
    hovering at 64.9/65.1 — which is exactly what an LLM-driven scalar does —
    changes expression once, not thirty times a minute.
    """

    metric: str
    enter: float
    exit: float
    mode: Mode = "above"

    def __post_init__(self) -> None:
        if self.mode == "above" and self.exit >= self.enter:
            msg = f"'above' band {self.metric} needs exit < enter, got {self.exit} >= {self.enter}"
            raise ValueError(msg)
        if self.mode == "below" and self.exit <= self.enter:
            msg = f"'below' band {self.metric} needs exit > enter, got {self.exit} <= {self.enter}"
            raise ValueError(msg)

    def entered(self, metrics: PersonaMetrics) -> bool:
        value = metrics.value(self.metric)
        return value >= self.enter if self.mode == "above" else value <= self.enter

    def held(self, metrics: PersonaMetrics) -> bool:
        value = metrics.value(self.metric)
        return value > self.exit if self.mode == "above" else value < self.exit

    def depth(self, metrics: PersonaMetrics) -> float:
        """0 at the enter threshold, 1 when the metric is fully saturated.

        Drives intensity: entering ``frustrated`` at resistance 68 and sitting
        at resistance 99 should not look identical.
        """
        value = metrics.value(self.metric)
        if self.mode == "above":
            span = max(1e-6, 100.0 - self.enter)
            return max(0.0, min(1.0, (value - self.enter) / span))
        span = max(1e-6, self.enter)
        return max(0.0, min(1.0, (self.enter - value) / span))


@dataclass(frozen=True, slots=True)
class EmotionBand:
    """A band satisfied by the upstream semantic ``emotion`` label.

    The Scenario Director already smooths this label across turns, so it needs
    no hysteresis of its own — but it must be able to *hold* a state on its
    own, otherwise an explicitly ``skeptical`` persona whose numbers are all
    mid-range would render as neutral and contradict the Persona State Card
    the trainee is looking at (§20 of the product spec: the card and the face
    are driven by the same state).
    """

    emotion: PersonaEmotion

    def entered(self, metrics: PersonaMetrics) -> bool:
        return metrics.emotion is self.emotion

    def held(self, metrics: PersonaMetrics) -> bool:
        return metrics.emotion is self.emotion

    def depth(self, _metrics: PersonaMetrics) -> float:
        return 0.5


AnyBand = Band | EmotionBand


@dataclass(frozen=True, slots=True)
class ExpressionRule:
    """One rung of the §13 ladder.

    ``priority`` is ascending-urgency-first: 0 outranks 1. A rule is *entered*
    when its bands say so, and *held* while they still say so — the two are
    different questions and that difference is the hysteresis.
    """

    state: ExpressionName
    priority: int
    bands: tuple[AnyBand, ...] = ()
    #: ``any`` = one band suffices to enter, and any one band holds the state.
    combine: Literal["any", "all"] = "any"
    #: Only selectable while the persona is listening (§14 idle behaviour).
    requires_listening: bool = False
    #: Never selected in these phases.
    excluded_phases: tuple[ScenarioPhase, ...] = ()
    #: Base rule: always entered. Exactly one rule must have this.
    always: bool = False

    def _phase_ok(self, metrics: PersonaMetrics) -> bool:
        return metrics.phase not in self.excluded_phases

    def entered(self, metrics: PersonaMetrics) -> bool:
        if not self._phase_ok(metrics):
            return False
        if self.requires_listening and not metrics.listening:
            return False
        if self.always:
            return True
        checks = [band.entered(metrics) for band in self.bands]
        return any(checks) if self.combine == "any" else all(checks)

    def held(self, metrics: PersonaMetrics) -> bool:
        if not self._phase_ok(metrics):
            return False
        if self.requires_listening and not metrics.listening:
            return False
        if self.always:
            return True
        checks = [band.held(metrics) for band in self.bands]
        return any(checks) if self.combine == "any" else all(checks)

    def depth(self, metrics: PersonaMetrics) -> float:
        if not self.bands:
            return 0.0
        return max(band.depth(metrics) for band in self.bands)


# ---------------------------------------------------------------------------
# The ladder
# ---------------------------------------------------------------------------

#: §13's order, with §12's enter/exit bands attached to every rung.
#:
#: The exit values are chosen so that no two adjacent rungs can trade the
#: expression back and forth: ``frustrated`` leaves at resistance 55, which is
#: still inside ``skeptical``'s hold band (>52), so the face steps *down* one
#: rung instead of falling to neutral and immediately climbing back.
RULES: Final[tuple[ExpressionRule, ...]] = (
    ExpressionRule(
        state=ExpressionName.ANGRY,
        priority=0,
        bands=(Band("resistance", enter=85.0, exit=72.0),),
    ),
    ExpressionRule(
        state=ExpressionName.FRUSTRATED,
        priority=1,
        bands=(
            Band("resistance", enter=68.0, exit=55.0),
            Band("patience", enter=20.0, exit=35.0, mode="below"),
            EmotionBand(PersonaEmotion.FRUSTRATED),
        ),
    ),
    ExpressionRule(
        state=ExpressionName.SKEPTICAL,
        priority=2,
        bands=(
            # §12's worked example, verbatim.
            Band("resistance", enter=65.0, exit=52.0),
            # §13's `trust < 45`, given an exit band so it cannot flicker.
            Band("trust", enter=45.0, exit=58.0, mode="below"),
            EmotionBand(PersonaEmotion.SKEPTICAL),
        ),
    ),
    ExpressionRule(
        state=ExpressionName.CONCERNED,
        priority=3,
        bands=(Band("risk", enter=70.0, exit=45.0),),
    ),
    ExpressionRule(
        state=ExpressionName.INTERESTED,
        priority=4,
        bands=(
            Band("interest", enter=72.0, exit=60.0),
            EmotionBand(PersonaEmotion.INTERESTED),
            EmotionBand(PersonaEmotion.CURIOUS),
        ),
        excluded_phases=(ScenarioPhase.ENDED,),
    ),
    ExpressionRule(
        state=ExpressionName.READY,
        priority=5,
        bands=(EmotionBand(PersonaEmotion.READY),),
        excluded_phases=(ScenarioPhase.OPENING, ScenarioPhase.ENDED),
    ),
    ExpressionRule(
        state=ExpressionName.SATISFIED,
        priority=6,
        bands=(EmotionBand(PersonaEmotion.REASSURED),),
    ),
    ExpressionRule(
        state=ExpressionName.LISTENING,
        priority=7,
        requires_listening=True,
        always=False,
        bands=(),
        combine="all",  # empty `all` is True → entered whenever listening
    ),
    ExpressionRule(state=ExpressionName.NEUTRAL, priority=8, always=True),
)

RULE_BY_STATE: Final[dict[ExpressionName, ExpressionRule]] = {r.state: r for r in RULES}


def map_persona_state(state: PersonaSnapshot | dict[str, Any]) -> ExpressionName:
    """§13, without history: the expression a fresh persona state maps to.

    This is the function the boundary tests pin. The controller does not call
    it — it evaluates the same :data:`RULES` with memory — but the two agree
    exactly whenever there is no previous state to be sticky about.
    """
    snapshot = state if isinstance(state, PersonaSnapshot) else PersonaSnapshot.model_validate(state)
    metrics = PersonaMetrics.of(snapshot)
    for rule in RULES:  # RULES is already priority-ordered
        if rule.entered(metrics):
            return rule.state
    return ExpressionName.NEUTRAL  # pragma: no cover - the base rule is `always`


def expression_intensity(
    state: PersonaSnapshot,
    expression: ExpressionName,
) -> float:
    """How hard to push the curated template.

    Precedence: an explicit ``emotion_intensity`` from the Scenario Director
    wins (§8/§43 send it, and it is the one signal that knows about narrative
    beats the scalars cannot express). Otherwise intensity is the preset's own
    value pushed toward 1.0 by how far past its enter threshold the driving
    metric sits, then nudged by ``energy`` (§8) and the scenario phase.
    """
    base = preset(expression).intensity
    if state.emotion_intensity is not None:
        value = state.emotion_intensity
    else:
        metrics = PersonaMetrics.of(state)
        rule = RULE_BY_STATE.get(expression)
        depth = rule.depth(metrics) if rule else 0.0
        value = base + (1.0 - base) * depth * 0.6
    if state.energy is not None:
        # ±10% around the computed value; energy 0.5 is neutral.
        value *= 0.9 + 0.2 * state.energy
    if state.scenario_phase is ScenarioPhase.OBJECTION_HANDLING:
        value *= 1.05
    elif state.scenario_phase is ScenarioPhase.ENDED:
        value *= 0.8
    return max(0.0, min(1.0, value))


def resolve_gaze(state: PersonaSnapshot, expression: ExpressionName) -> Gaze:
    """§70's three directions, chosen from the persona state.

    An explicit ``gaze`` from upstream always wins; otherwise a resistant or
    disengaged customer looks away, a low-patience one looks down, and everyone
    else looks at the trainee.
    """
    if state.gaze is not None:
        return state.gaze
    if expression is ExpressionName.DISENGAGED or state.resistance >= 80.0:
        return Gaze.SLIGHTLY_AWAY
    if state.patience <= 20.0 or expression is ExpressionName.THINKING:
        return Gaze.DOWN
    return Gaze.USER


def target_expression_state(
    state: PersonaSnapshot,
    expression: ExpressionName,
) -> ExpressionState:
    """The fully-resolved §9 :class:`ExpressionState` for a persona snapshot."""
    return preset(expression).scaled(expression_intensity(state, expression)).with_gaze(
        resolve_gaze(state, expression)
    )


__all__ = [
    "RULES",
    "RULE_BY_STATE",
    "Band",
    "ComplianceRisk",
    "EmotionBand",
    "ExpressionRule",
    "PersonaEmotion",
    "PersonaMetrics",
    "PersonaSnapshot",
    "ScenarioPhase",
    "expression_intensity",
    "map_persona_state",
    "resolve_gaze",
    "target_expression_state",
]
