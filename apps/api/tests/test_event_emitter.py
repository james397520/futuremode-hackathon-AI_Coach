"""§55 / §68 — seq monotonicity, replay from seq, and event ordering.

The event stream is the realtime contract with the web client's reducer: a duplicate
or out-of-order `seq` desynchronises the whole session UI, and a lost event that
replay cannot recover shows the trainee a stale persona state. These tests run against
the in-process path (no Redis), which is the fallback every deployment shares.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from app.ws.events import (
    AGENT_NAMES,
    EventEmitter,
    EventEmitterRegistry,
    EventType,
    serialise,
)


@pytest.fixture
def emitter() -> EventEmitter:
    return EventEmitter("ses1", buffer_size=8, tenant_id="t1", workspace_id="w1")


# ---------------------------------------------------------------------------
# sequencing
# ---------------------------------------------------------------------------
async def test_seq_starts_at_one_and_increments(emitter):
    first = await emitter.session_started("ready", "2026-01-01T00:00:00Z")
    second = await emitter.agent_thinking("customer")
    third = await emitter.persona_state_updated({"trust": 50})
    assert [first["seq"], second["seq"], third["seq"]] == [1, 2, 3]
    assert emitter.last_seq == 3


async def test_seq_is_monotonic_under_concurrent_emitters(emitter):
    """Independent agent legs emit concurrently; `seq` must still be a total order."""
    await asyncio.gather(
        *[emitter.agent_thinking(name) for name in AGENT_NAMES],
        emitter.score_updated("empathy", 70, 0.8),
        emitter.compliance_warning({"type": "false_promise"}),
    )
    seqs = [event["seq"] for event in emitter.buffered()]
    assert seqs == sorted(seqs)
    assert len(set(seqs)) == len(seqs)
    assert seqs == list(range(1, len(seqs) + 1))


async def test_every_event_carries_the_session_id_and_a_timestamp(emitter):
    event = await emitter.speech_partial("trainee", "這個保費")
    assert event["session_id"] == "ses1"
    assert event["at_ms"] > 0
    assert event["type"] == EventType.SPEECH_PARTIAL


async def test_emitted_events_are_json_serialisable(emitter):
    await emitter.knowledge_citation("t1", [{"chunk_id": "c1", "similarity": 0.42}])
    await emitter.coach_insight({"kind": "hint", "title": "先同理"})
    for event in emitter.buffered():
        json.dumps(event, ensure_ascii=False)


# ---------------------------------------------------------------------------
# replay (gap recovery on reconnect)
# ---------------------------------------------------------------------------
async def test_replay_since_returns_only_newer_events_in_order(emitter):
    for index in range(5):
        await emitter.speech_partial("trainee", f"chunk-{index}")
    replayed = await emitter.replay_since(2)
    assert [event["seq"] for event in replayed] == [3, 4, 5]
    assert [event["text"] for event in replayed] == ["chunk-2", "chunk-3", "chunk-4"]


async def test_replay_from_zero_returns_everything_buffered(emitter):
    await emitter.session_started("ready", "now")
    await emitter.agent_thinking("knowledge")
    replayed = await emitter.replay_since(0)
    assert len(replayed) == 2
    assert [event["seq"] for event in replayed] == [1, 2]


async def test_replay_from_the_head_returns_nothing(emitter):
    await emitter.session_started("ready", "now")
    assert await emitter.replay_since(emitter.last_seq) == []


async def test_has_gap_is_false_while_the_buffer_still_covers_the_cursor(emitter):
    for index in range(4):
        await emitter.speech_partial("trainee", str(index))
    assert emitter.has_gap(2) is False
    assert await emitter.replay_since(2)


async def test_has_gap_is_true_once_the_buffer_has_rolled_past_the_cursor(emitter):
    # buffer_size is 8; emit 12 so seq 1–4 have been evicted
    for index in range(12):
        await emitter.speech_partial("trainee", str(index))
    assert emitter.has_gap(1) is True
    replayed = await emitter.replay_since(1)
    assert min(event["seq"] for event in replayed) > 1


async def test_buffer_is_bounded(emitter):
    for index in range(50):
        await emitter.speech_partial("trainee", str(index))
    assert len(emitter.buffered()) == 8
    assert emitter.last_seq == 50


# ---------------------------------------------------------------------------
# ordering of the turn's events (§55 timing)
# ---------------------------------------------------------------------------
async def test_turn_event_order_is_preserved(emitter):
    await emitter.speech_final({"id": "tt1", "speaker": "trainee", "text": "太貴了"})
    await emitter.agent_thinking("scenario_director")
    await emitter.persona_state_updated({"trust": 40, "resistance": 70})
    await emitter.agent_thinking("customer")
    await emitter.agent_response_partial("pt1", "我")
    await emitter.agent_response_partial("pt1", "比較想先知道")
    await emitter.agent_response_final({"id": "pt1", "speaker": "persona"})

    types = [event["type"] for event in emitter.buffered()]
    assert types == [
        EventType.SPEECH_FINAL,
        EventType.AGENT_THINKING,
        EventType.PERSONA_STATE_UPDATED,
        EventType.AGENT_THINKING,
        EventType.AGENT_RESPONSE_PARTIAL,
        EventType.AGENT_RESPONSE_PARTIAL,
        EventType.AGENT_RESPONSE_FINAL,
    ]
    # persona.state.updated must precede the persona's own tokens (§20/§68)
    state_index = types.index(EventType.PERSONA_STATE_UPDATED)
    first_token = types.index(EventType.AGENT_RESPONSE_PARTIAL)
    assert state_index < first_token


async def test_partial_deltas_keep_their_order(emitter):
    deltas = ["我", "比較", "想先知道", "一個月要多少錢"]
    for delta in deltas:
        await emitter.agent_response_partial("pt1", delta)
    assert [
        event["delta"]
        for event in emitter.buffered()
        if event["type"] == EventType.AGENT_RESPONSE_PARTIAL
    ] == deltas


async def test_unknown_agent_name_is_rejected(emitter):
    """The `agent.thinking` indicator must only ever name a §19 agent."""
    with pytest.raises(ValueError, match="unknown agent name"):
        await emitter.agent_thinking("marketing_bot")


# ---------------------------------------------------------------------------
# subscription
# ---------------------------------------------------------------------------
async def test_subscriber_receives_live_events(emitter):
    received: list[dict] = []

    async def consume() -> None:
        async for event in emitter.subscribe(include_remote=False):
            received.append(event)
            if len(received) == 2:
                return

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.05)  # let the subscriber register before emitting
    await emitter.agent_thinking("coach")
    await emitter.score_updated("empathy", 74, 0.8)
    await asyncio.wait_for(task, timeout=3)
    assert [event["type"] for event in received] == [
        EventType.AGENT_THINKING,
        EventType.SCORE_UPDATED,
    ]
    assert [event["seq"] for event in received] == [1, 2]


async def test_close_releases_subscribers(emitter):
    received: list[dict] = []

    async def consume() -> None:
        async for event in emitter.subscribe(include_remote=False):
            received.append(event)

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.05)  # let the subscriber register before emitting
    await emitter.agent_thinking("coach")
    await emitter.close()
    await asyncio.wait_for(task, timeout=3)
    assert task.done()


# ---------------------------------------------------------------------------
# serialisation
# ---------------------------------------------------------------------------
def test_serialise_accepts_a_mapping():
    assert serialise({"type": "session.paused"})["type"] == "session.paused"


def test_serialise_accepts_a_pydantic_model():
    from pydantic import BaseModel

    class Event(BaseModel):
        type: str = "session.paused"
        detail: dict[str, int] = {}

    assert serialise(Event(detail={"a": 1}))["detail"] == {"a": 1}


def test_serialise_requires_a_type():
    with pytest.raises(ValueError, match="missing 'type'"):
        serialise({"seq": 1})


def test_serialise_flattens_nested_models():
    from pydantic import BaseModel

    class Inner(BaseModel):
        trust: int = 42

    payload = serialise({"type": "persona.state.updated", "state": Inner()})
    assert payload["state"] == {"trust": 42}


# ---------------------------------------------------------------------------
# registry: one emitter per session, shared by the gateway and the orchestrator
# ---------------------------------------------------------------------------
async def test_registry_returns_the_same_emitter_for_a_session():
    registry = EventEmitterRegistry()
    first = await registry.get("ses1", tenant_id="t1", workspace_id="w1")
    second = await registry.get("ses1")
    assert first is second
    assert "ses1" in registry.active_sessions()


async def test_registry_isolates_sessions():
    registry = EventEmitterRegistry()
    one = await registry.get("ses1", tenant_id="t1", workspace_id="w1")
    two = await registry.get("ses2", tenant_id="t1", workspace_id="w1")
    await one.agent_thinking("coach")
    assert two.last_seq == 0
    assert one.last_seq == 1


async def test_registry_drop_closes_the_emitter():
    registry = EventEmitterRegistry()
    emitter = await registry.get("ses1", tenant_id="t1", workspace_id="w1")
    await emitter.agent_thinking("coach")
    await registry.drop("ses1")
    assert "ses1" not in registry.active_sessions()
    fresh = await registry.get("ses1")
    assert fresh is not emitter
