"""§54 / §92 — illegal state transitions are rejected, and versions are pinned.

Version pinning is the one that silently breaks reports: if a session reads the *live*
scenario row at evaluation time, editing a scenario retroactively changes past reports
(「避免訓練完成後設定被改掉導致報告不可重現」, §54). The tests below mutate the
content rows after session creation and assert the session still sees the snapshot it
started with.
"""

from __future__ import annotations

import pytest

from app.services.exceptions import (
    NotFoundError,
    PermissionDeniedError,
    StateTransitionError,
    ValidationFailedError,
)
from app.services.session_service import (
    LIVE_STATES,
    SESSION_TRANSITIONS,
    TERMINAL_STATES,
    CreateSessionRequest,
    PinnedSnapshot,
    SessionService,
    assert_transition,
    can_transition,
)
from app.ws.events import EventEmitterRegistry


@pytest.fixture
def seeded(repo):
    repo.seed(
        "Persona",
        {
            "id": "per1",
            "name": "陳先生",
            "version": 3,
            "status": "published",
            "locale": "zh-TW",
            "traits": {"trust": 35, "patience": 55, "resistance": 65, "openness": 40},
            "hidden": {
                "primary_goal": "understand_monthly_cost",
                "hidden_need": "擔心失業後繳不出保費",
                "forbidden_knowledge": ["內部佣金結構"],
                "budget": 3000,
            },
            "voice": {"provider": "none", "language": "zh-TW", "speed": 1.0},
        },
    )
    repo.seed(
        "Scenario",
        {
            "id": "scn1",
            "name": "車貸客戶初談",
            "version": 7,
            "status": "published",
            "persona_id": "per1",
            "knowledge_base_ids": ["kb1"],
            "difficulty": "hard",
            "mode": "training",
            "opening_context": "客戶剛看完車貸方案",
            "learning_objectives": ["建立信任", "完成需求探索"],
            "key_objections": ["價格太高", "需要跟家人討論"],
            "restricted_topics": ["虛擬貨幣"],
            "success_condition": "客戶同意進入下一步",
            "rubric_id": "rub1",
            "max_turns": 20,
            "time_limit_seconds": 900,
        },
    )
    return repo


@pytest.fixture
def service(seeded, ctx) -> SessionService:
    return SessionService(
        None, ctx, repo=seeded, emitters=EventEmitterRegistry()
    )


# ---------------------------------------------------------------------------
# the state machine (§92)
# ---------------------------------------------------------------------------
def test_transition_table_covers_every_state():
    from app.domain import PersonaSimulationState  # noqa: F401 - stub availability

    expected = {
        "idle",
        "connecting",
        "ready",
        "listening",
        "transcribing",
        "processing",
        "persona_speaking",
        "paused",
        "reconnecting",
        "completed",
        "error",
    }
    assert set(SESSION_TRANSITIONS) == expected


def test_completed_is_terminal():
    assert SESSION_TRANSITIONS["completed"] == frozenset()
    assert "completed" in TERMINAL_STATES


@pytest.mark.parametrize(
    ("current", "requested"),
    [
        ("idle", "connecting"),
        ("connecting", "ready"),
        ("ready", "listening"),
        ("listening", "transcribing"),
        ("transcribing", "processing"),
        ("processing", "persona_speaking"),
        ("persona_speaking", "ready"),
        ("ready", "paused"),
        ("paused", "ready"),
        ("ready", "completed"),
        ("error", "reconnecting"),
    ],
)
def test_legal_transitions_are_allowed(current, requested):
    assert can_transition(current, requested) is True
    assert_transition(current, requested)


@pytest.mark.parametrize(
    ("current", "requested"),
    [
        ("idle", "ready"),
        ("idle", "processing"),
        ("connecting", "persona_speaking"),
        ("completed", "ready"),
        ("completed", "listening"),
        ("completed", "processing"),
        ("paused", "listening"),
        ("transcribing", "persona_speaking"),
        ("ready", "idle"),
    ],
)
def test_illegal_transitions_are_rejected(current, requested):
    assert can_transition(current, requested) is False
    with pytest.raises(StateTransitionError) as excinfo:
        assert_transition(current, requested)
    assert excinfo.value.current == current
    assert excinfo.value.requested == requested


def test_self_transition_is_a_no_op():
    assert_transition("ready", "ready")


async def test_service_rejects_an_illegal_transition(service):
    view = await service.create(CreateSessionRequest(scenario_id="scn1"))
    assert view.status == "connecting"
    with pytest.raises(StateTransitionError):
        await service.transition(view.session_id, "persona_speaking")


async def test_a_completed_session_cannot_be_reopened(service):
    view = await service.create(CreateSessionRequest(scenario_id="scn1"))
    await service.mark_ready(view.session_id)
    await service.end(view.session_id)
    with pytest.raises(StateTransitionError):
        await service.transition(view.session_id, "ready")


async def test_ending_twice_is_idempotent(service):
    view = await service.create(CreateSessionRequest(scenario_id="scn1"))
    await service.mark_ready(view.session_id)
    first = await service.end(view.session_id)
    second = await service.end(view.session_id)
    assert first.status == second.status == "completed"
    assert second.ended_at


async def test_message_is_rejected_when_the_session_is_not_live(service):
    view = await service.create(CreateSessionRequest(scenario_id="scn1"))
    assert view.status not in LIVE_STATES
    with pytest.raises(StateTransitionError):
        await service.handle_message(view.session_id, "你好")


async def test_empty_message_is_rejected(service):
    view = await service.create(CreateSessionRequest(scenario_id="scn1"))
    await service.mark_ready(view.session_id)
    with pytest.raises(ValidationFailedError):
        await service.handle_message(view.session_id, "   ")


async def test_assessment_mode_cannot_be_paused_by_a_trainee(service):
    view = await service.create(
        CreateSessionRequest(scenario_id="scn1", mode="assessment")
    )
    await service.mark_ready(view.session_id)
    with pytest.raises(PermissionDeniedError):
        await service.pause(view.session_id)


async def test_training_mode_can_be_paused_and_resumed(service):
    view = await service.create(CreateSessionRequest(scenario_id="scn1"))
    await service.mark_ready(view.session_id)
    paused = await service.pause(view.session_id)
    assert paused.status == "paused"
    resumed = await service.resume(view.session_id)
    assert resumed.status == "ready"


async def test_resume_requires_a_paused_session(service):
    view = await service.create(CreateSessionRequest(scenario_id="scn1"))
    await service.mark_ready(view.session_id)
    with pytest.raises(StateTransitionError):
        await service.resume(view.session_id)


# ---------------------------------------------------------------------------
# version pinning (§54)
# ---------------------------------------------------------------------------
async def test_create_pins_the_scenario_and_persona_versions(service):
    view = await service.create(CreateSessionRequest(scenario_id="scn1"))
    assert view.scenario_version == 7
    assert view.persona_version == 3
    assert view.mode == "training"


async def test_pinned_snapshot_survives_a_later_content_edit(service, seeded):
    view = await service.create(CreateSessionRequest(scenario_id="scn1"))

    # a coach edits the published content afterwards
    seeded.table("Scenario")["scn1"]["version"] = 8
    seeded.table("Scenario")["scn1"]["opening_context"] = "完全不同的開場"
    seeded.table("Scenario")["scn1"]["key_objections"] = ["改掉了"]
    seeded.table("Persona")["per1"]["version"] = 4
    seeded.table("Persona")["per1"]["hidden"] = {"hidden_need": "改掉了"}

    replay = await service.replay(view.session_id)
    assert replay.session.scenario_version == 7
    assert replay.session.persona_version == 3
    assert replay.pinned.scenario_version == 7
    assert replay.pinned.persona_version == 3
    assert replay.pinned.scenario["opening_context"] == "客戶剛看完車貸方案"
    assert replay.pinned.scenario["key_objections"] == ["價格太高", "需要跟家人討論"]
    assert replay.pinned.persona_hidden["hidden_need"] == "擔心失業後繳不出保費"


async def test_pinned_snapshot_captures_the_knowledge_bases_and_rubric(service):
    view = await service.create(CreateSessionRequest(scenario_id="scn1"))
    row = await service.repo.get("TrainingSession", view.session_id)
    pinned = PinnedSnapshot.model_validate(row["pinned_snapshot"])
    assert pinned.knowledge_base_ids == ["kb1"]
    assert pinned.rubric_id == "rub1"
    assert pinned.scenario["restricted_topics"] == ["虛擬貨幣"]
    assert pinned.pinned_at


async def test_initial_persona_state_is_seeded_from_the_pinned_traits(service):
    view = await service.create(CreateSessionRequest(scenario_id="scn1"))
    row = await service.repo.get("TrainingSession", view.session_id)
    pinned = PinnedSnapshot.model_validate(row["pinned_snapshot"])
    state = service.initial_persona_state(pinned)
    assert state.trust == 35
    assert state.patience == 55
    assert state.resistance == 65
    assert state.scenario_phase == "opening"
    assert state.hidden_need_revealed is False
    assert state.budget == 3000
    assert state.current_goal == "understand_monthly_cost"


async def test_objection_queue_is_seeded_from_the_pinned_scenario(service):
    view = await service.create(CreateSessionRequest(scenario_id="scn1"))
    runtime = service._runtime[view.session_id]  # noqa: SLF001 - asserting internal seed
    kinds = {str(o.kind) for o in runtime.director_state.objection_queue}
    assert "price_first_layer" in kinds
    assert "spouse_consult" in kinds
    assert runtime.director_state.difficulty == "hard"


# ---------------------------------------------------------------------------
# guards
# ---------------------------------------------------------------------------
async def test_unknown_scenario_is_a_404(service):
    with pytest.raises(NotFoundError):
        await service.create(CreateSessionRequest(scenario_id="nope"))


async def test_unpublished_scenario_is_refused_for_a_trainee(service, seeded):
    seeded.table("Scenario")["scn1"]["status"] = "draft"
    with pytest.raises(PermissionDeniedError):
        await service.create(CreateSessionRequest(scenario_id="scn1"))


async def test_a_coach_may_run_an_unpublished_scenario(seeded, coach_ctx):
    seeded.table("Scenario")["scn1"]["status"] = "review_required"
    service = SessionService(None, coach_ctx, repo=seeded, emitters=EventEmitterRegistry())
    view = await service.create(CreateSessionRequest(scenario_id="scn1"))
    assert view.scenario_version == 7


async def test_unknown_mode_is_rejected(service):
    with pytest.raises(ValidationFailedError):
        await service.create(CreateSessionRequest(scenario_id="scn1", mode="quiz"))


async def test_another_users_session_is_not_readable_by_a_trainee(seeded, ctx):
    seeded.seed(
        "TrainingSession",
        {
            "id": "ses_other",
            "session_id": "ses_other",
            "user_id": "u_someone_else",
            "scenario_id": "scn1",
            "scenario_version": 7,
            "persona_id": "per1",
            "persona_version": 3,
            "mode": "training",
            "status": "ready",
            "started_at": "2026-01-01T00:00:00+00:00",
            "pinned_snapshot": {},
        },
    )
    service = SessionService(None, ctx, repo=seeded, emitters=EventEmitterRegistry())
    with pytest.raises(PermissionDeniedError):
        await service.get("ses_other")


async def test_score_live_is_forced_off_in_assessment_mode(service):
    view = await service.create(
        CreateSessionRequest(
            scenario_id="scn1", mode="assessment", score_live_enabled=True
        )
    )
    assert view.score_live_enabled is False


async def test_replay_payload_shape(service):
    view = await service.create(CreateSessionRequest(scenario_id="scn1"))
    replay = await service.replay(view.session_id)
    assert replay.transcript == []
    assert replay.state_timeline == []
    assert replay.coach_insights == []
    assert replay.compliance_findings == []
    assert replay.citations == []
    assert replay.session.session_id == view.session_id
