"""`EventEmitter` — the §55/§68 streaming contract, fan-out and gap recovery.

Guarantees
----------
* **Monotonic `seq` per session.** Sequence numbers come from a single counter per
  session. With Redis that counter is `INCR` on `ws:session:{id}:seq`, so two API
  replicas emitting for the same session still produce a strictly increasing,
  gap-free sequence. Without Redis (tests, single-process dev) an in-process counter
  guarded by a lock does the same job. `seq` starts at 1.
* **Fan-out across replicas.** Every event is published to the Redis channel
  `ws:session:{id}:events`. A socket attached to any replica subscribes to that
  channel, so a reconnect that lands on a different pod still receives live events.
* **Bounded replay buffer.** The last `buffer_size` events are kept in a Redis list
  (`ws:session:{id}:log`, `RPUSH` + `LTRIM`) and mirrored in a local deque, so
  `replay_since(seq)` can fill a gap after `connection.reconnecting` without
  replaying an entire session.
* **Ordering.** `emit()` holds a lock across "allocate seq -> buffer -> publish", so
  events cannot be interleaved out of order by concurrent agent legs.

Serialisation accepts either a Pydantic model from the `app.domain.events` union or a
plain mapping; both end up as one JSON object with `type`, `seq`, `session_id`,
`at_ms` plus the event's own fields.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from collections import deque
from collections.abc import AsyncIterator, Iterable, Mapping, Sequence
from typing import Any, Final, Protocol, runtime_checkable

import structlog

log = structlog.get_logger(__name__)

DEFAULT_BUFFER_SIZE: Final = 256
CHANNEL_PREFIX: Final = "ws:session:"


class EventType:
    """String constants for `StreamingEvent['type']` (packages/shared)."""

    SESSION_STARTED = "session.started"
    SESSION_PAUSED = "session.paused"
    SESSION_RESUMED = "session.resumed"
    SESSION_COMPLETED = "session.completed"
    SPEECH_STARTED = "speech.started"
    SPEECH_PARTIAL = "speech.partial"
    SPEECH_FINAL = "speech.final"
    AGENT_THINKING = "agent.thinking"
    AGENT_RESPONSE_PARTIAL = "agent.response.partial"
    AGENT_RESPONSE_FINAL = "agent.response.final"
    PERSONA_STATE_UPDATED = "persona.state.updated"
    COACH_INSIGHT = "coach.insight"
    KNOWLEDGE_CITATION = "knowledge.citation"
    SCORE_UPDATED = "score.updated"
    COMPLIANCE_WARNING = "compliance.warning"
    RUNTIME_FALLBACK = "runtime.fallback"
    CONNECTION_RECONNECTING = "connection.reconnecting"
    SESSION_ERROR = "session.error"


#: `AGENT_NAMES` from packages/shared/src/events.ts
AGENT_NAMES: Final[tuple[str, ...]] = (
    "orchestrator",
    "scenario_director",
    "customer",
    "coach",
    "knowledge",
    "evaluator",
    "compliance",
)


@runtime_checkable
class RedisLike(Protocol):
    """The slice of `redis.asyncio.Redis` this module uses."""

    async def incr(self, name: str) -> int: ...
    async def rpush(self, name: str, *values: Any) -> int: ...
    async def ltrim(self, name: str, start: int, end: int) -> Any: ...
    async def lrange(self, name: str, start: int, end: int) -> list[Any]: ...
    async def expire(self, name: str, seconds: int) -> Any: ...
    async def publish(self, channel: str, message: Any) -> Any: ...
    def pubsub(self) -> Any: ...


def now_ms() -> int:
    return int(time.time() * 1000)


def serialise(event: Any) -> dict[str, Any]:
    """Normalise a domain event model or mapping into a JSON-safe dict."""
    if isinstance(event, Mapping):
        payload = dict(event)
    else:
        dumper = getattr(event, "model_dump", None)
        if callable(dumper):
            payload = dict(dumper(mode="json"))
        else:  # dataclass-ish fallback
            payload = {
                key: getattr(event, key)
                for key in dir(event)
                if not key.startswith("_") and not callable(getattr(event, key))
            }
    if "type" not in payload:
        raise ValueError("streaming event is missing 'type'")
    return _jsonable(payload)


def _jsonable(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_jsonable(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    dumper = getattr(value, "model_dump", None)
    if callable(dumper):
        return _jsonable(dumper(mode="json"))
    return str(value)


class EventEmitter:
    """Per-session emitter. One instance per live session, shared by all agent legs."""

    def __init__(
        self,
        session_id: str,
        *,
        redis: RedisLike | None = None,
        buffer_size: int = DEFAULT_BUFFER_SIZE,
        ttl_seconds: int = 6 * 60 * 60,
        tenant_id: str = "",
        workspace_id: str = "",
    ) -> None:
        self.session_id = session_id
        self.tenant_id = tenant_id
        self.workspace_id = workspace_id
        self._redis = redis
        self._buffer: deque[dict[str, Any]] = deque(maxlen=buffer_size)
        self._buffer_size = buffer_size
        self._ttl = ttl_seconds
        self._lock = asyncio.Lock()
        self._seq = 0
        self._local_subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._closed = False

    # -- keys --------------------------------------------------------------
    @property
    def channel(self) -> str:
        return f"{CHANNEL_PREFIX}{self.session_id}:events"

    @property
    def seq_key(self) -> str:
        return f"{CHANNEL_PREFIX}{self.session_id}:seq"

    @property
    def log_key(self) -> str:
        return f"{CHANNEL_PREFIX}{self.session_id}:log"

    # -- core --------------------------------------------------------------
    @property
    def last_seq(self) -> int:
        return self._seq

    async def _next_seq(self) -> int:
        if self._redis is not None:
            try:
                value = int(await self._redis.incr(self.seq_key))
                await self._redis.expire(self.seq_key, self._ttl)
                # keep the local view monotonic even if another replica moved ahead
                self._seq = max(self._seq, value)
                return value
            except Exception as exc:  # noqa: BLE001 - Redis outage must not kill a session
                log.warning("events.seq_redis_failed", error=repr(exc))
        self._seq += 1
        return self._seq

    async def emit(self, event: Any) -> dict[str, Any]:
        """Stamp, buffer, fan out. Returns the serialised event."""
        payload = serialise(event)
        async with self._lock:
            seq = await self._next_seq()
            payload["seq"] = seq
            payload.setdefault("session_id", self.session_id)
            payload.setdefault("at_ms", now_ms())
            self._buffer.append(payload)
            await self._persist(payload)
            self._deliver_local(payload)
            await self._publish(payload)
        return payload

    async def _persist(self, payload: Mapping[str, Any]) -> None:
        if self._redis is None:
            return
        try:
            await self._redis.rpush(self.log_key, json.dumps(payload, ensure_ascii=False))
            await self._redis.ltrim(self.log_key, -self._buffer_size, -1)
            await self._redis.expire(self.log_key, self._ttl)
        except Exception as exc:  # noqa: BLE001
            log.warning("events.persist_failed", error=repr(exc))

    async def _publish(self, payload: Mapping[str, Any]) -> None:
        if self._redis is None:
            return
        try:
            await self._redis.publish(self.channel, json.dumps(payload, ensure_ascii=False))
        except Exception as exc:  # noqa: BLE001
            log.warning("events.publish_failed", error=repr(exc))

    def _deliver_local(self, payload: Mapping[str, Any]) -> None:
        for queue in list(self._local_subscribers):
            try:
                queue.put_nowait(dict(payload))
            except asyncio.QueueFull:  # pragma: no cover - unbounded queues by default
                log.warning("events.subscriber_backpressure", session=self.session_id)

    # -- replay ------------------------------------------------------------
    def buffered(self) -> list[dict[str, Any]]:
        return list(self._buffer)

    async def replay_since(self, after_seq: int) -> list[dict[str, Any]]:
        """Events with `seq > after_seq`, oldest first (gap recovery on reconnect).

        Prefers the Redis log so a reconnect served by a *different* replica can still
        fill the gap; falls back to the local ring buffer.
        """
        entries: list[dict[str, Any]] = []
        if self._redis is not None:
            try:
                raw = await self._redis.lrange(self.log_key, 0, -1)
                for item in raw:
                    text = item.decode() if isinstance(item, (bytes, bytearray)) else str(item)
                    with contextlib.suppress(json.JSONDecodeError):
                        entries.append(json.loads(text))
            except Exception as exc:  # noqa: BLE001
                log.warning("events.replay_redis_failed", error=repr(exc))
        if not entries:
            entries = list(self._buffer)
        filtered = [e for e in entries if int(e.get("seq", 0)) > after_seq]
        filtered.sort(key=lambda e: int(e.get("seq", 0)))
        return filtered

    def has_gap(self, after_seq: int) -> bool:
        """True when the oldest buffered event is newer than the client's cursor."""
        entries = list(self._buffer)
        if not entries:
            return after_seq < self._seq
        oldest = min(int(e.get("seq", 0)) for e in entries)
        return after_seq + 1 < oldest

    # -- subscription ------------------------------------------------------
    async def subscribe(self, *, include_remote: bool = True) -> AsyncIterator[dict[str, Any]]:
        """Yield events for this session until the emitter closes.

        Local emissions arrive directly; remote ones (other replicas) arrive through
        Redis pub/sub. Duplicate suppression is by `seq`.
        """
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._local_subscribers.add(queue)
        pubsub: Any = None
        pump: asyncio.Task[None] | None = None
        seen: set[int] = set()
        try:
            if include_remote and self._redis is not None:
                try:
                    pubsub = self._redis.pubsub()
                    await pubsub.subscribe(self.channel)
                    pump = asyncio.create_task(self._pump_remote(pubsub, queue))
                except Exception as exc:  # noqa: BLE001
                    log.warning("events.subscribe_remote_failed", error=repr(exc))
                    pubsub = None
            while not self._closed:
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=1.0)
                except TimeoutError:
                    continue
                seq = int(payload.get("seq", 0))
                if seq and seq in seen:
                    continue
                if seq:
                    seen.add(seq)
                    if len(seen) > self._buffer_size * 4:
                        seen = {s for s in seen if s > seq - self._buffer_size * 2}
                yield payload
        finally:
            self._local_subscribers.discard(queue)
            if pump is not None:
                pump.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await pump
            if pubsub is not None:
                with contextlib.suppress(Exception):
                    await pubsub.unsubscribe(self.channel)
                with contextlib.suppress(Exception):
                    await pubsub.close()

    async def _pump_remote(self, pubsub: Any, queue: asyncio.Queue[dict[str, Any]]) -> None:
        try:
            async for message in pubsub.listen():
                if not isinstance(message, Mapping) or message.get("type") != "message":
                    continue
                data = message.get("data")
                text = data.decode() if isinstance(data, (bytes, bytearray)) else str(data)
                try:
                    queue.put_nowait(json.loads(text))
                except json.JSONDecodeError:
                    continue
        except asyncio.CancelledError:  # pragma: no cover
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("events.remote_pump_failed", error=repr(exc))

    async def close(self) -> None:
        self._closed = True
        # wake every subscriber so their `wait_for` loop exits promptly
        self._deliver_local({"type": "__close__", "seq": 0, "session_id": self.session_id})

    # -- typed helpers (spec §55 / §68) ------------------------------------
    async def session_started(self, state: str, server_time: str) -> dict[str, Any]:
        return await self.emit(
            {"type": EventType.SESSION_STARTED, "state": state, "server_time": server_time}
        )

    async def session_paused(self) -> dict[str, Any]:
        return await self.emit({"type": EventType.SESSION_PAUSED})

    async def session_resumed(self) -> dict[str, Any]:
        return await self.emit({"type": EventType.SESSION_RESUMED})

    async def session_completed(self, evaluation_id: str | None = None) -> dict[str, Any]:
        return await self.emit(
            {"type": EventType.SESSION_COMPLETED, "evaluation_id": evaluation_id}
        )

    async def speech_started(self, speaker: str) -> dict[str, Any]:
        return await self.emit({"type": EventType.SPEECH_STARTED, "speaker": speaker})

    async def speech_partial(self, speaker: str, text: str) -> dict[str, Any]:
        return await self.emit(
            {"type": EventType.SPEECH_PARTIAL, "speaker": speaker, "text": text}
        )

    async def speech_final(self, turn: Any) -> dict[str, Any]:
        return await self.emit({"type": EventType.SPEECH_FINAL, "turn": _jsonable(turn)})

    async def agent_thinking(self, agent: str) -> dict[str, Any]:
        if agent not in AGENT_NAMES:
            raise ValueError(f"unknown agent name for streaming event: {agent}")
        return await self.emit({"type": EventType.AGENT_THINKING, "agent": agent})

    async def agent_response_partial(self, turn_id: str, delta: str) -> dict[str, Any]:
        return await self.emit(
            {"type": EventType.AGENT_RESPONSE_PARTIAL, "turn_id": turn_id, "delta": delta}
        )

    async def agent_response_final(self, turn: Any) -> dict[str, Any]:
        return await self.emit(
            {"type": EventType.AGENT_RESPONSE_FINAL, "turn": _jsonable(turn)}
        )

    async def persona_state_updated(self, state: Any) -> dict[str, Any]:
        return await self.emit(
            {"type": EventType.PERSONA_STATE_UPDATED, "state": _jsonable(state)}
        )

    async def coach_insight(self, insight: Any) -> dict[str, Any]:
        return await self.emit({"type": EventType.COACH_INSIGHT, "insight": _jsonable(insight)})

    async def knowledge_citation(
        self, turn_id: str, citations: Iterable[Any]
    ) -> dict[str, Any]:
        return await self.emit(
            {
                "type": EventType.KNOWLEDGE_CITATION,
                "turn_id": turn_id,
                "citations": [_jsonable(c) for c in citations],
            }
        )

    async def score_updated(self, skill: str, score: int, confidence: float) -> dict[str, Any]:
        return await self.emit(
            {
                "type": EventType.SCORE_UPDATED,
                "skill": skill,
                "score": score,
                "confidence": confidence,
            }
        )

    async def compliance_warning(self, finding: Any) -> dict[str, Any]:
        return await self.emit(
            {"type": EventType.COMPLIANCE_WARNING, "finding": _jsonable(finding)}
        )

    async def runtime_fallback(self, from_state: str, to: str, reason: str) -> dict[str, Any]:
        return await self.emit(
            {"type": EventType.RUNTIME_FALLBACK, "from": from_state, "to": to, "reason": reason}
        )

    async def connection_reconnecting(self, attempt: int) -> dict[str, Any]:
        return await self.emit(
            {"type": EventType.CONNECTION_RECONNECTING, "attempt": attempt}
        )

    async def session_error(
        self, code: str, message: str, *, recoverable: bool = True
    ) -> dict[str, Any]:
        return await self.emit(
            {
                "type": EventType.SESSION_ERROR,
                "code": code,
                "message": message,
                "recoverable": recoverable,
            }
        )


class EventEmitterRegistry:
    """Process-local registry so the gateway and the orchestrator share one emitter."""

    def __init__(self, *, redis: RedisLike | None = None) -> None:
        self._redis = redis
        self._emitters: dict[str, EventEmitter] = {}
        self._lock = asyncio.Lock()

    async def get(
        self, session_id: str, *, tenant_id: str = "", workspace_id: str = ""
    ) -> EventEmitter:
        async with self._lock:
            emitter = self._emitters.get(session_id)
            if emitter is None:
                emitter = EventEmitter(
                    session_id,
                    redis=self._redis,
                    tenant_id=tenant_id,
                    workspace_id=workspace_id,
                )
                self._emitters[session_id] = emitter
            return emitter

    async def drop(self, session_id: str) -> None:
        async with self._lock:
            emitter = self._emitters.pop(session_id, None)
        if emitter is not None:
            await emitter.close()

    def active_sessions(self) -> Sequence[str]:
        return tuple(self._emitters)


__all__ = [
    "AGENT_NAMES",
    "CHANNEL_PREFIX",
    "DEFAULT_BUFFER_SIZE",
    "EventEmitter",
    "EventEmitterRegistry",
    "EventType",
    "RedisLike",
    "now_ms",
    "serialise",
]
