"""Scenario Director — the dynamic scenario engine (spec §4.1, §18, §19.1).

Everything in this module is **deterministic**: the same `DirectorInput` always
produces the same `DirectorDecision`. That is a hard requirement, not a convenience —
§54 demands that a finished session be reproducible from its pinned scenario/persona
versions, and §31 renders a persona-state timeline that must match what actually
happened. No LLM call is made here; the optional narrative colour for an injected
event comes from a locale table (`prompts.scenario.event_text`) and can be replaced by
a model call at the orchestrator level without affecting state.

Documented transitions (spec §4.1):

    學員過度推銷        -> resistance +20, patience -15, 第二層價格異議入列
    正確承接家庭壓力    -> trust +15, hidden need 可揭露, 進入需求探索階段

Difficulty (spec §18):

    consistently succeeds -> escalate objection complexity (and the ladder)
    repeatedly fails      -> keep the core challenge; only in **Training Mode** may a
                             *secondary* difficulty be reduced.
                             **Assessment Mode never auto-lowers difficulty.**
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from enum import StrEnum
from typing import Any, Final

from pydantic import BaseModel, ConfigDict, Field

from app.agents.intent import IntentDecision, IntentLabel, SafetyFlag
from app.agents.patterns import fold, normalize
from app.agents.prompts.scenario import event_text

# Assumption: `app.domain` re-exports the Pydantic mirror of
# packages/shared/src/persona.ts (same field names and enum values). Imported
# from the package root because that is the surface most likely to be stable.
from app.domain import PersonaSimulationState

STAT_MIN: Final = 0
STAT_MAX: Final = 100

DIFFICULTY_LADDER: Final[tuple[str, ...]] = ("easy", "medium", "hard", "expert")

#: Phase order for the §4.1 progression. `ended` is terminal.
PHASE_ORDER: Final[tuple[str, ...]] = (
    "opening",
    "needs_discovery",
    "presentation",
    "objection_handling",
    "closing",
    "ended",
)


def clamp(value: float) -> int:
    """All simulation variables are integers in 0–100 (spec §4.1/§20)."""
    return int(max(STAT_MIN, min(STAT_MAX, round(value))))


class TurnSignal(StrEnum):
    """What the trainee's turn did, from the director's point of view."""

    OVERSELLING = "overselling"
    ACKNOWLEDGED_FAMILY_PRESSURE = "acknowledged_family_pressure"
    EMPATHY = "empathy"
    NEEDS_QUESTION = "needs_question"
    EVIDENCE_PROVIDED = "evidence_provided"
    PRODUCT_EXPLANATION = "product_explanation"
    OBJECTION_ADDRESSED = "objection_addressed"
    OBJECTION_IGNORED = "objection_ignored"
    CLOSING_ATTEMPT = "closing_attempt"
    COMPLIANCE_RISK = "compliance_risk"
    ROLE_ESCAPE = "role_escape"
    OFF_TOPIC = "off_topic"
    EXIT_SIGNAL = "exit_signal"
    AGREEMENT = "agreement"


class ObjectionKind(StrEnum):
    PRICE_FIRST_LAYER = "price_first_layer"
    PRICE_SECOND_LAYER = "price_second_layer"
    SPOUSE_CONSULT = "spouse_consult"
    TRUST_IN_COMPANY = "trust_in_company"
    COMPETITOR_COMPARISON = "competitor_comparison"
    RISK_AVERSION = "risk_aversion"
    LIQUIDITY = "liquidity"
    TIMING = "timing"


class QueuedObjection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: ObjectionKind
    #: 1 = surface objection, 2 = the follow-up the trainee's answer provoked
    layer: int = 1
    #: True for objections the director added as *secondary* difficulty; these are the
    #: only ones a Training-Mode de-escalation is allowed to drop (spec §18).
    secondary: bool = False
    reason: str = ""
    resolved: bool = False


class InjectedEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str
    text: str
    at_turn: int


class DirectorState(BaseModel):
    """Director-owned state that is *not* part of `PersonaSimulationState`.

    `PersonaSimulationState` is the UI contract (§20) and must stay exactly the shape
    published in shared, so the queue/difficulty bookkeeping lives here and is
    persisted next to the session.
    """

    model_config = ConfigDict(extra="forbid")

    turn_index: int = 0
    difficulty: str = "medium"
    base_difficulty: str = "medium"
    objection_queue: list[QueuedObjection] = Field(default_factory=list)
    consecutive_success: int = 0
    consecutive_failure: int = 0
    escalations: int = 0
    secondary_difficulty_reduced: bool = False
    hidden_need_unlocked: bool = False
    exit_intent_signals: int = 0
    exit_intent: bool = False
    injected_events: list[InjectedEvent] = Field(default_factory=list)
    unaddressed_objection_turns: int = 0
    #: overselling detector: consecutive pitch turns with no discovery question
    pitch_streak: int = 0


class DirectorInput(BaseModel):
    """One trainee turn as the director sees it."""

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    state: PersonaSimulationState
    director_state: DirectorState = Field(default_factory=DirectorState)
    trainee_text: str = ""
    intent: IntentDecision | None = None
    mode: str = "training"                       # SessionMode: training | assessment
    locale: str = "zh-TW"
    #: last persona utterance — used to tell whether the trainee *answered* the
    #: objection the customer just raised, and to spot the family-pressure cue
    last_persona_text: str = ""
    citations_count: int = 0
    compliance_severity: str = "safe"
    elapsed_seconds: int = 0
    time_limit_seconds: int | None = None
    max_turns: int | None = None
    #: scenario config
    key_objections: list[str] = Field(default_factory=list)
    #: extra signals supplied by the caller (e.g. from the evaluator's per-turn pass)
    extra_signals: list[TurnSignal] = Field(default_factory=list)


class DirectorDecision(BaseModel):
    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    state: PersonaSimulationState
    director_state: DirectorState
    state_delta: dict[str, Any] = Field(default_factory=dict)
    signals: list[TurnSignal] = Field(default_factory=list)
    phase_changed: bool = False
    difficulty_changed: bool = False
    injected_event: InjectedEvent | None = None
    #: the objection the customer agent should voice this turn (top of the queue)
    objection_directive: QueuedObjection | None = None
    allow_hidden_need_reveal: bool = False
    reasons: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# signal detection
# ---------------------------------------------------------------------------
_PUSHY = tuple(
    re.compile(p)
    for p in (
        r"你一定要", r"你(現在)?(就)?(要|得)(買|辦|簽)", r"機會難得", r"(限時|最後)(優惠|機會)",
        r"大家都(買|辦)", r"(不要|別)再猶豫", r"(現在)?不(買|辦)(就)?(可惜|沒了|來不及)",
        r"我(跟你)?保證", r"相信我就對了", r"你聽我的就好",
        r"you\s*(really\s*)?(have|need)\s*to\s*(buy|sign)", r"limited\s*time",
    )
)
_EMPATHY = tuple(
    re.compile(p)
    for p in (
        r"我(可以)?(理解|了解|懂)", r"辛苦(了|你了)", r"難怪(你會)?", r"聽得出來", r"這確實",
        r"我明白你的", r"換成我(也)?會", r"i\s*(understand|hear\s*you)", r"that\s*makes\s*sense",
    )
)
_FAMILY_CUE = tuple(
    re.compile(p)
    for p in (
        r"家人", r"家裡", r"老公", r"老婆", r"太太", r"先生", r"小孩", r"孩子", r"爸媽",
        r"父母", r"房貸", r"家計", r"養家", r"壓力", r"family", r"kids?", r"mortgage",
    )
)
_QUESTION_CUE = tuple(
    re.compile(p)
    for p in (
        r"請問", r"想(先)?了解",
        # `你目前/你現在` alone is too loose: it fires on hard-sell imperatives like
        # 「你現在就要買」 or 「你現在就簽這裡」, which are the opposite of needs
        # discovery. Require an actual interrogative continuation.
        r"你(目前|現在)(有沒有|有無|是否|會不會|需不需要|最|大概|多少|怎麼|如何)",
        r"你(有沒有|會不會)", r"方便(問|說)",
        r"最(在意|擔心)", r"可以(跟我)?說說", r"怎麼(想|考慮)", r"what|how|why|could you tell",
    )
)
_PITCH_CUE = tuple(
    re.compile(p)
    for p in (
        r"這個(方案|商品|保單)", r"保障(內容|範圍)", r"給付", r"(年|月)繳", r"報酬率?",
        r"宣告利率", r"我們(公司)?(的)?產品", r"this\s*(plan|product)", r"coverage",
    )
)


def detect_signals(payload: DirectorInput) -> list[TurnSignal]:
    """Pure, deterministic signal extraction from one trainee turn."""
    text = normalize(payload.trainee_text)
    signals: set[TurnSignal] = set(payload.extra_signals)
    intent = payload.intent

    has_question = bool(text) and (
        text.endswith(("?", "？")) or any(p.search(text) for p in _QUESTION_CUE)
    )
    is_pitch = any(p.search(text) for p in _PITCH_CUE)
    is_pushy = any(p.search(text) for p in _PUSHY)
    is_empathetic = any(p.search(text) for p in _EMPATHY)
    family_in_context = any(
        p.search(normalize(payload.last_persona_text)) for p in _FAMILY_CUE
    ) or any(p.search(text) for p in _FAMILY_CUE)

    if has_question:
        signals.add(TurnSignal.NEEDS_QUESTION)
    if is_pitch:
        signals.add(TurnSignal.PRODUCT_EXPLANATION)
    if is_empathetic:
        signals.add(TurnSignal.EMPATHY)
    if payload.citations_count > 0:
        signals.add(TurnSignal.EVIDENCE_PROVIDED)
    if payload.compliance_severity in ("high", "critical"):
        signals.add(TurnSignal.COMPLIANCE_RISK)

    # Over-selling: pushy language, OR pitching for a third consecutive turn without
    # ever asking a discovery question, OR trying to close before discovery.
    streak_after_this = payload.director_state.pitch_streak + (
        1 if is_pitch and not has_question else 0
    )
    if is_pushy or streak_after_this >= 3:
        signals.add(TurnSignal.OVERSELLING)

    if intent is not None:
        if intent.label is IntentLabel.CLOSING_ATTEMPT:
            signals.add(TurnSignal.CLOSING_ATTEMPT)
            if payload.state.scenario_phase in ("opening", "needs_discovery"):
                signals.add(TurnSignal.OVERSELLING)
        if intent.label is IntentLabel.AGREEMENT:
            signals.add(TurnSignal.AGREEMENT)
        if intent.label is IntentLabel.OFF_TOPIC:
            signals.add(TurnSignal.OFF_TOPIC)
        if intent.label is IntentLabel.EXIT_INTENT:
            signals.add(TurnSignal.EXIT_SIGNAL)
        if intent.breaks_persona or SafetyFlag.ROLE_ESCAPE in intent.safety_flags:
            signals.add(TurnSignal.ROLE_ESCAPE)
        if intent.label in (IntentLabel.NEEDS_PROBE, IntentLabel.QUESTION):
            signals.add(TurnSignal.NEEDS_QUESTION)
        if intent.label is IntentLabel.EMPATHY_RESPONSE:
            signals.add(TurnSignal.EMPATHY)

    # Correctly acknowledging family pressure: the customer raised it (or the trainee
    # named it) AND the trainee received it empathetically instead of pitching over it.
    if family_in_context and TurnSignal.EMPATHY in signals and not is_pushy:
        signals.add(TurnSignal.ACKNOWLEDGED_FAMILY_PRESSURE)

    # Did the trainee engage the objection the customer just raised?
    pending = [o for o in payload.director_state.objection_queue if not o.resolved]
    if pending:
        if TurnSignal.EVIDENCE_PROVIDED in signals or (
            is_pitch and (is_empathetic or has_question)
        ):
            signals.add(TurnSignal.OBJECTION_ADDRESSED)
        elif TurnSignal.OFF_TOPIC in signals or TurnSignal.OVERSELLING in signals or not text:
            signals.add(TurnSignal.OBJECTION_IGNORED)

    ordered = [s for s in TurnSignal if s in signals]
    return ordered


# ---------------------------------------------------------------------------
# the engine
# ---------------------------------------------------------------------------
#: (trust, interest, resistance, patience) deltas per signal — spec §4.1.
SIGNAL_DELTAS: Final[dict[TurnSignal, dict[str, int]]] = {
    TurnSignal.OVERSELLING: {"resistance": +20, "patience": -15, "trust": -5},
    TurnSignal.ACKNOWLEDGED_FAMILY_PRESSURE: {"trust": +15, "interest": +5, "resistance": -5},
    TurnSignal.EMPATHY: {"trust": +5, "patience": +3},
    TurnSignal.NEEDS_QUESTION: {"interest": +5, "trust": +2},
    TurnSignal.EVIDENCE_PROVIDED: {"trust": +6, "resistance": -5},
    TurnSignal.PRODUCT_EXPLANATION: {"interest": +3},
    TurnSignal.OBJECTION_ADDRESSED: {"resistance": -10, "trust": +5},
    TurnSignal.OBJECTION_IGNORED: {"patience": -10, "resistance": +5, "trust": -3},
    TurnSignal.CLOSING_ATTEMPT: {"interest": +2},
    TurnSignal.COMPLIANCE_RISK: {"trust": -12, "resistance": +10},
    TurnSignal.ROLE_ESCAPE: {"patience": -5},
    TurnSignal.OFF_TOPIC: {"patience": -5, "interest": -3},
    TurnSignal.EXIT_SIGNAL: {"interest": -8, "patience": -5},
    TurnSignal.AGREEMENT: {"trust": +5, "interest": +8, "resistance": -8},
}

#: Objections queued as *secondary* difficulty when the trainee is doing well (§18).
ESCALATION_OBJECTIONS: Final[tuple[ObjectionKind, ...]] = (
    ObjectionKind.COMPETITOR_COMPARISON,
    ObjectionKind.LIQUIDITY,
    ObjectionKind.TIMING,
    ObjectionKind.TRUST_IN_COMPANY,
)

_OBJECTION_ALIASES: Final[dict[str, ObjectionKind]] = {
    "價格": ObjectionKind.PRICE_FIRST_LAYER,
    "保費": ObjectionKind.PRICE_FIRST_LAYER,
    "太貴": ObjectionKind.PRICE_FIRST_LAYER,
    "price": ObjectionKind.PRICE_FIRST_LAYER,
    "配偶": ObjectionKind.SPOUSE_CONSULT,
    "家人": ObjectionKind.SPOUSE_CONSULT,
    "信任": ObjectionKind.TRUST_IN_COMPANY,
    "公司": ObjectionKind.TRUST_IN_COMPANY,
    "比較": ObjectionKind.COMPETITOR_COMPARISON,
    "同業": ObjectionKind.COMPETITOR_COMPARISON,
    "風險": ObjectionKind.RISK_AVERSION,
    "流動性": ObjectionKind.LIQUIDITY,
    "解約": ObjectionKind.LIQUIDITY,
    "時機": ObjectionKind.TIMING,
}

#: trust/resistance thresholds that gate the hidden need (§4.1 "information availability")
HIDDEN_NEED_TRUST_GATE: Final = 55
HIDDEN_NEED_PHASES: Final = ("needs_discovery", "presentation", "objection_handling", "closing")


class ScenarioDirector:
    """Deterministic phase / hidden-variable / difficulty / event-injection engine."""

    def __init__(self, *, locale: str = "zh-TW") -> None:
        self.locale = locale

    # -- public ------------------------------------------------------------
    def seed_objections(self, key_objections: Sequence[str]) -> list[QueuedObjection]:
        """Map scenario `key_objections` (free text, §17) onto the queue."""
        queue: list[QueuedObjection] = []
        seen: set[ObjectionKind] = set()
        for raw in key_objections:
            folded = fold(raw)
            kind = next(
                (v for k, v in _OBJECTION_ALIASES.items() if fold(k) in folded),
                ObjectionKind.RISK_AVERSION,
            )
            if kind in seen:
                continue
            seen.add(kind)
            queue.append(QueuedObjection(kind=kind, layer=1, reason=f"scenario:{raw[:40]}"))
        return queue

    def decide(self, payload: DirectorInput) -> DirectorDecision:
        state = payload.state.model_copy(deep=True)
        director = payload.director_state.model_copy(deep=True)
        before = state.model_dump()
        reasons: list[str] = []

        signals = detect_signals(payload)
        director.turn_index += 1

        # --- 1. hidden variables ------------------------------------------
        totals: dict[str, int] = {"trust": 0, "interest": 0, "resistance": 0, "patience": 0}
        for signal in signals:
            for key, delta in SIGNAL_DELTAS.get(signal, {}).items():
                totals[key] += delta
            if signal in SIGNAL_DELTAS:
                reasons.append(f"signal:{signal}")
        for key, delta in totals.items():
            if delta:
                setattr(state, key, clamp(getattr(state, key) + delta))

        # pitch streak bookkeeping (feeds the over-selling detector next turn)
        if TurnSignal.PRODUCT_EXPLANATION in signals and TurnSignal.NEEDS_QUESTION not in signals:
            director.pitch_streak += 1
        else:
            director.pitch_streak = 0

        # --- 2. objection queue -------------------------------------------
        objection_event: str | None = None
        if TurnSignal.OBJECTION_ADDRESSED in signals:
            for objection in director.objection_queue:
                if not objection.resolved:
                    objection.resolved = True
                    reasons.append(f"objection_resolved:{objection.kind}")
                    break
            director.unaddressed_objection_turns = 0
        elif TurnSignal.OBJECTION_IGNORED in signals:
            director.unaddressed_objection_turns += 1
            reasons.append("objection_ignored")

        if TurnSignal.OVERSELLING in signals:
            # spec §4.1: 學員過度推銷 -> 啟動第二層價格異議
            if self._enqueue(
                director,
                ObjectionKind.PRICE_SECOND_LAYER,
                layer=2,
                reason="overselling",
            ):
                objection_event = "second_layer_price_objection"
                reasons.append("queued:price_second_layer")

        # --- 3. hidden need gating ----------------------------------------
        if TurnSignal.ACKNOWLEDGED_FAMILY_PRESSURE in signals:
            director.hidden_need_unlocked = True
            reasons.append("hidden_need_unlocked")

        allow_reveal = (
            director.hidden_need_unlocked
            and not state.hidden_need_revealed
            and state.trust >= HIDDEN_NEED_TRUST_GATE
            and state.scenario_phase in HIDDEN_NEED_PHASES
        )

        # --- 4. compliance risk -------------------------------------------
        if payload.compliance_severity != "safe":
            state.compliance_risk = payload.compliance_severity
            reasons.append(f"compliance_risk:{payload.compliance_severity}")

        # --- 5. time pressure ---------------------------------------------
        state.time_pressure = self._time_pressure(payload, director)

        # --- 6. exit intent (before the phase machine, which reads it) -----
        if TurnSignal.EXIT_SIGNAL in signals:
            director.exit_intent_signals += 1
        if (
            director.exit_intent_signals >= 2
            or state.patience <= 10
            or (state.resistance >= 90 and state.trust <= 20)
        ):
            director.exit_intent = True
            reasons.append("exit_intent")

        # --- 7. phase progression -----------------------------------------
        new_phase = self._next_phase(state, director, signals)
        phase_changed = new_phase != state.scenario_phase
        if phase_changed:
            state.scenario_phase = new_phase
            reasons.append(f"phase:{new_phase}")

        # --- 8. dynamic difficulty ----------------------------------------
        difficulty_changed = self._adjust_difficulty(payload, director, signals, reasons)

        # --- 9. emotion + intent + goal -----------------------------------
        state.emotion = self._emotion(state, signals)
        if payload.intent is not None:
            state.intent = str(payload.intent.label)
        next_objection = self._top_objection(director)
        state.current_goal = self._goal(state, next_objection)

        # --- 10. event injection ------------------------------------------
        event = self._injected_event(payload, director, state, signals, objection_event)
        if event is not None:
            director.injected_events.append(event)
            reasons.append(f"event:{event.kind}")

        after = state.model_dump()
        delta = {
            key: value
            for key, value in after.items()
            if before.get(key) != value
        }
        return DirectorDecision(
            state=state,
            director_state=director,
            state_delta=delta,
            signals=signals,
            phase_changed=phase_changed,
            difficulty_changed=difficulty_changed,
            injected_event=event,
            objection_directive=next_objection,
            allow_hidden_need_reveal=allow_reveal,
            reasons=reasons,
        )

    def apply_hidden_need_reveal(self, state: PersonaSimulationState) -> PersonaSimulationState:
        """Called after the customer agent actually revealed the hidden need."""
        updated = state.model_copy(deep=True)
        updated.hidden_need_revealed = True
        updated.interest = clamp(updated.interest + 8)
        return updated

    # -- internals ---------------------------------------------------------
    @staticmethod
    def _enqueue(
        director: DirectorState, kind: ObjectionKind, *, layer: int, reason: str,
        secondary: bool = False,
    ) -> bool:
        if any(o.kind is kind and not o.resolved for o in director.objection_queue):
            return False
        director.objection_queue.append(
            QueuedObjection(kind=kind, layer=layer, reason=reason, secondary=secondary)
        )
        return True

    @staticmethod
    def _top_objection(director: DirectorState) -> QueuedObjection | None:
        pending = [o for o in director.objection_queue if not o.resolved]
        if not pending:
            return None
        # deeper layers first: a provoked follow-up outranks a surface objection
        return sorted(pending, key=lambda o: (-o.layer, director.objection_queue.index(o)))[0]

    @staticmethod
    def _next_phase(
        state: PersonaSimulationState, director: DirectorState, signals: Sequence[TurnSignal]
    ) -> str:
        phase = str(state.scenario_phase)
        if phase == "ended":
            return phase
        if director.exit_intent and TurnSignal.AGREEMENT not in signals:
            return "ended"
        if TurnSignal.AGREEMENT in signals and phase in ("closing", "objection_handling"):
            return "ended"

        if phase == "opening":
            if (
                TurnSignal.NEEDS_QUESTION in signals
                or TurnSignal.ACKNOWLEDGED_FAMILY_PRESSURE in signals
            ):
                # spec §4.1: 正確承接家庭壓力 -> 允許進入需求探索階段
                return "needs_discovery"
            return phase
        if phase == "needs_discovery":
            if state.hidden_need_revealed or (
                TurnSignal.PRODUCT_EXPLANATION in signals and state.interest >= 55
            ):
                return "presentation"
            return phase
        if phase == "presentation":
            pending = [o for o in director.objection_queue if not o.resolved]
            if pending or state.resistance >= 55:
                return "objection_handling"
            return phase
        if phase == "objection_handling":
            unresolved = [o for o in director.objection_queue if not o.resolved]
            if not unresolved and state.resistance <= 35 and state.trust >= 60:
                return "closing"
            return phase
        if phase == "closing":
            if TurnSignal.AGREEMENT in signals:
                return "ended"
            return phase
        return phase

    @staticmethod
    def _time_pressure(payload: DirectorInput, director: DirectorState) -> int:
        """0 when there is plenty of room, rising as the budget is consumed (§4.1)."""
        ratios: list[float] = []
        if payload.time_limit_seconds:
            ratios.append(payload.elapsed_seconds / max(payload.time_limit_seconds, 1))
        if payload.max_turns:
            ratios.append(director.turn_index / max(payload.max_turns, 1))
        base = max(ratios) if ratios else 0.0
        bump = 15 if any(e.kind == "time_pressure" for e in director.injected_events) else 0
        if director.difficulty == "expert":
            bump += 10
        return clamp(base * 100 + bump)

    def _adjust_difficulty(
        self,
        payload: DirectorInput,
        director: DirectorState,
        signals: Sequence[TurnSignal],
        reasons: list[str],
    ) -> bool:
        """Spec §18 dynamic difficulty.

        Escalation is allowed in both modes (the spec only forbids *lowering* in
        Assessment Mode). De-escalation touches **secondary** difficulty only, and
        never the pinned `difficulty` value.
        """
        good_turn = bool(
            {
                TurnSignal.OBJECTION_ADDRESSED,
                TurnSignal.ACKNOWLEDGED_FAMILY_PRESSURE,
                TurnSignal.EVIDENCE_PROVIDED,
            }
            & set(signals)
        )
        bad_turn = bool(
            {
                TurnSignal.OVERSELLING,
                TurnSignal.OBJECTION_IGNORED,
                TurnSignal.COMPLIANCE_RISK,
                TurnSignal.OFF_TOPIC,
            }
            & set(signals)
        )
        if good_turn and not bad_turn:
            director.consecutive_success += 1
            director.consecutive_failure = 0
        elif bad_turn:
            director.consecutive_failure += 1
            director.consecutive_success = 0

        changed = False
        if director.consecutive_success >= 2:
            # increase objection complexity first, then the ladder
            index = min(director.escalations, len(ESCALATION_OBJECTIONS) - 1)
            if self._enqueue(
                director,
                ESCALATION_OBJECTIONS[index],
                layer=2,
                reason="difficulty_escalation",
                secondary=True,
            ):
                director.escalations += 1
                reasons.append("difficulty:objection_complexity_up")
                changed = True
            current = DIFFICULTY_LADDER.index(director.difficulty)
            if current < len(DIFFICULTY_LADDER) - 1:
                director.difficulty = DIFFICULTY_LADDER[current + 1]
                reasons.append(f"difficulty:up:{director.difficulty}")
                changed = True
            director.consecutive_success = 0

        if director.consecutive_failure >= 2:
            if payload.mode == "assessment":
                # Spec §18: Assessment Mode 不應自動降低難度. Core challenge stays,
                # and no secondary relief either — the assessment must be comparable.
                reasons.append("difficulty:hold:assessment_mode")
            else:
                dropped = self._drop_secondary(director)
                if dropped or not director.secondary_difficulty_reduced:
                    director.secondary_difficulty_reduced = True
                    reasons.append("difficulty:secondary_reduced:training_mode")
                    changed = True
                director.consecutive_failure = 0
        return changed

    @staticmethod
    def _drop_secondary(director: DirectorState) -> bool:
        for objection in director.objection_queue:
            if objection.secondary and not objection.resolved:
                objection.resolved = True
                return True
        return False

    @staticmethod
    def _emotion(state: PersonaSimulationState, signals: Sequence[TurnSignal]) -> str:
        if TurnSignal.COMPLIANCE_RISK in signals or state.patience <= 20:
            return "frustrated"
        if state.resistance >= 65:
            return "skeptical"
        if state.trust >= 70 and state.interest >= 70:
            return "ready" if state.resistance <= 25 else "interested"
        if state.trust >= 60:
            return "reassured"
        if state.interest >= 55:
            return "interested"
        if TurnSignal.NEEDS_QUESTION in signals:
            return "curious"
        return "neutral"

    @staticmethod
    def _goal(state: PersonaSimulationState, objection: QueuedObjection | None) -> str:
        if objection is not None:
            return {
                ObjectionKind.PRICE_FIRST_LAYER: "understand_monthly_cost",
                ObjectionKind.PRICE_SECOND_LAYER: "justify_monthly_cost_again",
                ObjectionKind.SPOUSE_CONSULT: "defer_to_spouse",
                ObjectionKind.TRUST_IN_COMPANY: "verify_company_reliability",
                ObjectionKind.COMPETITOR_COMPARISON: "compare_with_other_offer",
                ObjectionKind.RISK_AVERSION: "understand_downside_risk",
                ObjectionKind.LIQUIDITY: "check_early_withdrawal",
                ObjectionKind.TIMING: "decide_whether_to_wait",
            }[objection.kind]
        phase_goals = {
            "opening": "figure_out_why_we_are_talking",
            "needs_discovery": "explain_my_situation",
            "presentation": "understand_what_i_get",
            "objection_handling": "resolve_my_doubts",
            "closing": "decide_whether_to_sign",
            "ended": "leave",
        }
        return phase_goals.get(str(state.scenario_phase), "understand_monthly_cost")

    def _injected_event(
        self,
        payload: DirectorInput,
        director: DirectorState,
        state: PersonaSimulationState,
        signals: Sequence[TurnSignal],
        objection_event: str | None,
    ) -> InjectedEvent | None:
        """At most one event per turn, priority-ordered so behaviour is predictable."""
        # Exit intent outranks a queued objection: the customer is walking away and the
        # phase is already `ended`, so raising a further price objection would contradict
        # the state the trainee is being shown. The queue is preserved on the director and
        # simply never fires for this session.
        if director.exit_intent:
            kind: str | None = "exit_intent"
        else:
            kind = objection_event
        if kind is None:
            if TurnSignal.COMPLIANCE_RISK in signals:
                kind = "compliance_probe"
            elif (
                director.hidden_need_unlocked
                and not state.hidden_need_revealed
                and state.trust >= HIDDEN_NEED_TRUST_GATE
            ):
                kind = "hidden_need_hint"
            elif (
                director.difficulty in ("hard", "expert")
                and state.time_pressure is not None
                and state.time_pressure >= 70
                and not any(e.kind == "time_pressure" for e in director.injected_events)
            ):
                kind = "time_pressure"
            elif director.difficulty == "expert" and director.turn_index % 4 == 0:
                kind = "spouse_interrupt"
            elif TurnSignal.ACKNOWLEDGED_FAMILY_PRESSURE in signals:
                kind = "trust_gained"
        if kind is None:
            return None
        return InjectedEvent(
            kind=kind, text=event_text(kind, payload.locale), at_turn=director.turn_index
        )


__all__ = [
    "DIFFICULTY_LADDER",
    "ESCALATION_OBJECTIONS",
    "HIDDEN_NEED_TRUST_GATE",
    "PHASE_ORDER",
    "SIGNAL_DELTAS",
    "DirectorDecision",
    "DirectorInput",
    "DirectorState",
    "InjectedEvent",
    "ObjectionKind",
    "QueuedObjection",
    "ScenarioDirector",
    "TurnSignal",
    "clamp",
    "detect_signals",
]
