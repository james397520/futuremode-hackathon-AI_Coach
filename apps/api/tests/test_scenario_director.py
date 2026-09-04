"""§4.1 / §18 — the documented transitions, clamping, and Assessment-Mode difficulty.

These are the behaviours the spec states in prose, pinned as executable facts:

    學員過度推銷      -> resistance +20, patience -15, 第二層價格異議入列
    正確承接家庭壓力  -> trust +15, hidden need 可揭露, 進入需求探索階段
    Assessment Mode   -> 不應自動降低難度
"""

from __future__ import annotations

import pytest

from app.agents.intent import IntentDecision, IntentLabel
from app.agents.scenario_director import (
    DIFFICULTY_LADDER,
    DirectorInput,
    DirectorState,
    ObjectionKind,
    QueuedObjection,
    ScenarioDirector,
    TurnSignal,
    clamp,
    detect_signals,
)


@pytest.fixture
def director() -> ScenarioDirector:
    return ScenarioDirector(locale="zh-TW")


def _input(persona_state, **kwargs) -> DirectorInput:
    return DirectorInput(state=persona_state, **kwargs)


# ---------------------------------------------------------------------------
# documented transition 1: over-selling
# ---------------------------------------------------------------------------
def test_overselling_raises_resistance_and_queues_second_layer_price_objection(
    director, persona_state
):
    before_resistance = persona_state.resistance
    before_patience = persona_state.patience

    decision = director.decide(
        _input(
            persona_state,
            trainee_text="你一定要現在辦，機會難得，這個方案大家都買，相信我就對了。",
        )
    )

    assert TurnSignal.OVERSELLING in decision.signals
    assert decision.state.resistance == clamp(before_resistance + 20 - 0)
    assert decision.state.patience == clamp(before_patience - 15)
    queued = [o.kind for o in decision.director_state.objection_queue if not o.resolved]
    assert ObjectionKind.PRICE_SECOND_LAYER in queued
    assert decision.injected_event is not None
    assert decision.injected_event.kind == "second_layer_price_objection"
    assert decision.objection_directive is not None
    assert decision.objection_directive.layer == 2


def test_overselling_delta_is_exactly_the_documented_amount(director, persona_state):
    """No other signal should be co-firing on this input, so the deltas are clean."""
    state = persona_state.model_copy(update={"trust": 50, "resistance": 30, "patience": 80})
    decision = director.decide(
        _input(state, trainee_text="你現在就要買，不要再猶豫，限時優惠。")
    )
    assert TurnSignal.OVERSELLING in decision.signals
    assert decision.state.resistance == 50   # 30 + 20
    assert decision.state.patience == 65     # 80 - 15
    assert decision.state.trust == 45        # 50 - 5


# ---------------------------------------------------------------------------
# documented transition 2: acknowledging family pressure
# ---------------------------------------------------------------------------
def test_acknowledging_family_pressure_builds_trust_and_opens_needs_discovery(
    director, persona_state
):
    state = persona_state.model_copy(update={"trust": 40, "scenario_phase": "opening"})
    decision = director.decide(
        _input(
            state,
            trainee_text="我理解，家裡有房貸又要顧小孩，壓力確實不小。",
            last_persona_text="我最近其實壓力滿大的，家裡開銷都靠我。",
        )
    )

    assert TurnSignal.ACKNOWLEDGED_FAMILY_PRESSURE in decision.signals
    # trust +15 from the acknowledgement, +5 from the empathy signal that co-fires
    assert decision.state.trust == 60
    assert decision.director_state.hidden_need_unlocked is True
    assert decision.state.scenario_phase == "needs_discovery"
    assert decision.phase_changed is True


def test_hidden_need_reveal_is_gated_on_trust_even_once_unlocked(director, persona_state):
    low_trust = persona_state.model_copy(
        update={"trust": 20, "scenario_phase": "needs_discovery"}
    )
    unlocked = DirectorState(hidden_need_unlocked=True)
    decision = director.decide(
        _input(low_trust, director_state=unlocked, trainee_text="請問你目前的規劃是什麼？")
    )
    assert decision.allow_hidden_need_reveal is False

    high_trust = persona_state.model_copy(
        update={"trust": 70, "scenario_phase": "needs_discovery"}
    )
    decision = director.decide(
        _input(high_trust, director_state=unlocked, trainee_text="請問你目前的規劃是什麼？")
    )
    assert decision.allow_hidden_need_reveal is True


def test_apply_hidden_need_reveal_sets_the_flag(director, persona_state):
    revealed = director.apply_hidden_need_reveal(persona_state)
    assert revealed.hidden_need_revealed is True
    assert revealed.interest == clamp(persona_state.interest + 8)


# ---------------------------------------------------------------------------
# clamping
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("value", "expected"), [(-40, 0), (0, 0), (55, 55), (100, 100), (140, 100)]
)
def test_clamp_is_bounded_0_100(value, expected):
    assert clamp(value) == expected


def test_state_never_leaves_0_100_after_repeated_bad_turns(director, persona_state):
    state = persona_state.model_copy(update={"resistance": 95, "patience": 5})
    director_state = DirectorState()
    for _ in range(5):
        decision = director.decide(
            _input(
                state,
                director_state=director_state,
                trainee_text="你一定要現在買，保證會賺，機會難得。",
                compliance_severity="critical",
            )
        )
        state = decision.state
        director_state = decision.director_state
        for attribute in ("trust", "interest", "resistance", "patience"):
            assert 0 <= getattr(state, attribute) <= 100
        assert state.time_pressure is None or 0 <= state.time_pressure <= 100


# ---------------------------------------------------------------------------
# §18 dynamic difficulty
# ---------------------------------------------------------------------------
def test_repeated_success_escalates_difficulty_and_objection_complexity(
    director, persona_state
):
    state = persona_state.model_copy(update={"trust": 60})
    director_state = DirectorState(
        difficulty="medium",
        base_difficulty="medium",
        objection_queue=[QueuedObjection(kind=ObjectionKind.PRICE_FIRST_LAYER)],
    )
    for _ in range(2):
        decision = director.decide(
            _input(
                state,
                director_state=director_state,
                trainee_text="我理解你的顧慮，依照條款這部分是這樣計算的，你最在意哪一塊？",
                citations_count=2,
            )
        )
        state = decision.state
        director_state = decision.director_state

    assert director_state.difficulty == "hard"
    assert director_state.escalations >= 1
    assert any(o.secondary for o in director_state.objection_queue)


def test_assessment_mode_never_auto_lowers_difficulty(director, persona_state):
    """spec §18: Assessment Mode 不應自動降低難度."""
    state = persona_state
    director_state = DirectorState(
        difficulty="hard",
        base_difficulty="hard",
        objection_queue=[
            QueuedObjection(kind=ObjectionKind.PRICE_FIRST_LAYER),
            QueuedObjection(kind=ObjectionKind.COMPETITOR_COMPARISON, secondary=True),
        ],
    )
    for _ in range(4):
        decision = director.decide(
            _input(
                state,
                director_state=director_state,
                trainee_text="你一定要買，保證獲利。",
                mode="assessment",
                compliance_severity="critical",
            )
        )
        state = decision.state
        director_state = decision.director_state

    assert director_state.difficulty == "hard"
    assert director_state.secondary_difficulty_reduced is False
    # the secondary objection is still standing — no relief was granted
    assert any(
        o.secondary and not o.resolved for o in director_state.objection_queue
    )


def test_training_mode_may_reduce_secondary_difficulty_only(director, persona_state):
    state = persona_state
    director_state = DirectorState(
        difficulty="hard",
        base_difficulty="hard",
        objection_queue=[
            QueuedObjection(kind=ObjectionKind.PRICE_FIRST_LAYER),
            QueuedObjection(kind=ObjectionKind.COMPETITOR_COMPARISON, secondary=True),
        ],
    )
    for _ in range(2):
        decision = director.decide(
            _input(
                state,
                director_state=director_state,
                trainee_text="你一定要買，機會難得。",
                mode="training",
            )
        )
        state = decision.state
        director_state = decision.director_state

    assert director_state.secondary_difficulty_reduced is True
    # the *core* difficulty is untouched
    assert director_state.difficulty == "hard"
    assert director_state.base_difficulty == "hard"
    # the primary objection survives; only the secondary one was cleared
    primary = next(
        o for o in director_state.objection_queue if o.kind is ObjectionKind.PRICE_FIRST_LAYER
    )
    assert primary.resolved is False
    secondary = next(o for o in director_state.objection_queue if o.secondary)
    assert secondary.resolved is True


def test_difficulty_ladder_never_goes_below_the_entry_level(director, persona_state):
    director_state = DirectorState(difficulty="easy", base_difficulty="easy")
    decision = director.decide(
        _input(persona_state, director_state=director_state, trainee_text="嗯。")
    )
    assert decision.director_state.difficulty in DIFFICULTY_LADDER
    assert DIFFICULTY_LADDER.index(decision.director_state.difficulty) >= 0


# ---------------------------------------------------------------------------
# objection queue, exit intent, phases
# ---------------------------------------------------------------------------
def test_addressing_an_objection_resolves_the_top_of_the_queue(director, persona_state):
    director_state = DirectorState(
        objection_queue=[QueuedObjection(kind=ObjectionKind.PRICE_FIRST_LAYER)]
    )
    decision = director.decide(
        _input(
            persona_state,
            director_state=director_state,
            trainee_text="我理解，這個方案一個月是三千五，依條款第三條給付如下，你覺得如何？",
            citations_count=1,
        )
    )
    assert TurnSignal.OBJECTION_ADDRESSED in decision.signals
    assert decision.director_state.objection_queue[0].resolved is True
    assert decision.state.resistance < persona_state.resistance


def test_ignoring_an_objection_costs_patience(director, persona_state):
    director_state = DirectorState(
        objection_queue=[QueuedObjection(kind=ObjectionKind.PRICE_FIRST_LAYER)]
    )
    decision = director.decide(
        _input(
            persona_state,
            director_state=director_state,
            trainee_text="對了，你覺得明天股市會漲嗎？",
            intent=IntentDecision(label=IntentLabel.OFF_TOPIC),
        )
    )
    assert TurnSignal.OBJECTION_IGNORED in decision.signals
    assert decision.state.patience < persona_state.patience
    assert decision.director_state.unaddressed_objection_turns == 1


def test_exit_intent_ends_the_session_and_injects_the_event(director, persona_state):
    state = persona_state.model_copy(update={"patience": 8})
    decision = director.decide(_input(state, trainee_text="所以你要買嗎？"))
    assert decision.director_state.exit_intent is True
    assert decision.state.scenario_phase == "ended"
    assert decision.injected_event is not None
    assert decision.injected_event.kind == "exit_intent"


def test_time_pressure_tracks_the_turn_and_time_budget(director, persona_state):
    decision = director.decide(
        _input(
            persona_state,
            trainee_text="請問你目前的規劃？",
            elapsed_seconds=450,
            time_limit_seconds=600,
        )
    )
    assert decision.state.time_pressure is not None
    assert 70 <= decision.state.time_pressure <= 80


def test_state_delta_reports_only_changed_fields(director, persona_state):
    decision = director.decide(
        _input(persona_state, trainee_text="我理解你的顧慮，請問你最在意哪一部分？")
    )
    assert "trust" in decision.state_delta
    assert set(decision.state_delta) <= set(persona_state.model_dump())
    for key, value in decision.state_delta.items():
        assert getattr(decision.state, key) == value


def test_decide_is_deterministic(director, persona_state):
    payload = _input(
        persona_state,
        trainee_text="我理解，家裡壓力確實大。",
        last_persona_text="我最近壓力滿大的。",
    )
    first = director.decide(payload)
    second = director.decide(payload)
    assert first.state.model_dump() == second.state.model_dump()
    assert first.signals == second.signals
    assert first.reasons == second.reasons


def test_seed_objections_maps_scenario_text_onto_the_queue(director):
    queue = director.seed_objections(["價格太高", "需要跟家人討論", "對你們公司不熟"])
    kinds = [o.kind for o in queue]
    assert ObjectionKind.PRICE_FIRST_LAYER in kinds
    assert ObjectionKind.SPOUSE_CONSULT in kinds
    assert ObjectionKind.TRUST_IN_COMPANY in kinds


def test_detect_signals_is_pure(persona_state):
    payload = DirectorInput(state=persona_state, trainee_text="請問你目前的保障規劃？")
    assert detect_signals(payload) == detect_signals(payload)
    assert TurnSignal.NEEDS_QUESTION in detect_signals(payload)
