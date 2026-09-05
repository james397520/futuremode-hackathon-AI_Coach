"""Session event bus — the §45 WebSocket control channel.

ADR-008 splits the two channels: **WebRTC carries media, WebSocket carries state
and runtime events**. This module is the producer side of the second one.

The design constraint that shapes it: an event subscriber must never be able to
slow down the render loop. A browser tab that is throttled in the background, or
an admin panel on a bad network, would otherwise apply backpressure straight
into the frame clock and turn a UI problem into an A/V drift problem (§17). So
each subscriber gets its own **bounded** queue and a slow one loses its oldest
events, loudly (``dropped`` climbs on its handle), rather than blocking the
publisher. Publishing is therefore always non-blocking and never raises.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from enum import StrEnum
from time import time
from typing import TYPE_CHECKING, Any, Final

from app.core.logging import get_logger

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

logger = get_logger(__name__)

#: Events buffered per subscriber before the oldest is discarded.
DEFAULT_QUEUE_SIZE: Final[int] = 256


class EventName(StrEnum):
    """The §45 event vocabulary, complete and verbatim."""

    READY = "avatar.ready"
    LOADING = "avatar.loading"
    STATE_CHANGED = "avatar.state.changed"
    EXPRESSION_TRANSITION = "avatar.expression.transition"
    AUDIO_BUFFERING = "avatar.audio.buffering"
    SPEAKING_STARTED = "avatar.speaking.started"
    SPEAKING_ENDED = "avatar.speaking.ended"
    INTERRUPTED = "avatar.interrupted"
    FRAME_DROP = "avatar.frame.drop"
    RUNTIME_DEGRADED = "avatar.runtime.degraded"
    ERROR = "avatar.error"


@dataclass(frozen=True, slots=True)
class AvatarEvent:
    """One control-channel event.

    ``data`` is JSON-serialisable and carries no media and no dialogue — the
    admin panel needs to know *that* the avatar is speaking, never *what* it
    said. :mod:`app.core.logging` enforces the same rule on the log side.
    """

    name: EventName
    session_id: str
    #: Unix seconds. The browser uses it to order events against media PTS.
    at: float = field(default_factory=time)
    data: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        return {
            "event": self.name.value,
            "session_id": self.session_id,
            "at": round(self.at, 4),
            "data": self.data,
        }


@dataclass(slots=True)
class Subscription:
    """One subscriber's view of the bus."""

    queue: asyncio.Queue[AvatarEvent]
    #: Events discarded because this subscriber could not keep up.
    dropped: int = 0
    closed: bool = False

    async def __aiter__(self) -> AsyncIterator[AvatarEvent]:  # pragma: no cover - thin
        while not self.closed:
            yield await self.queue.get()


class EventBus:
    """Fan-out of :class:`AvatarEvent` to zero or more subscribers.

    Not thread-safe by design: everything in this service runs on one event
    loop, and a second loop would mean a second frame clock.
    """

    def __init__(self, *, queue_size: int = DEFAULT_QUEUE_SIZE) -> None:
        self._queue_size = queue_size
        self._subscribers: list[Subscription] = []
        #: Replayed to a late subscriber so a browser that connects after
        #: `avatar.ready` still learns the runtime is up. Bounded and tiny.
        self._sticky: dict[EventName, AvatarEvent] = {}

    # -- subscription ------------------------------------------------------

    def subscribe(self, *, replay: bool = True) -> Subscription:
        """Register a subscriber. Call :meth:`unsubscribe` when done."""
        sub = Subscription(queue=asyncio.Queue(maxsize=self._queue_size))
        self._subscribers.append(sub)
        if replay:
            for event in self._sticky.values():
                self._offer(sub, event)
        return sub

    def unsubscribe(self, sub: Subscription) -> None:
        sub.closed = True
        if sub in self._subscribers:
            self._subscribers.remove(sub)

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    # -- publishing --------------------------------------------------------

    def publish(
        self,
        name: EventName,
        session_id: str,
        /,
        **data: Any,
    ) -> AvatarEvent:
        """Fan an event out. Never blocks, never raises, never awaits."""
        event = AvatarEvent(name=name, session_id=session_id, data=dict(data))
        if name in _STICKY_EVENTS:
            self._sticky[name] = event
        for sub in self._subscribers:
            self._offer(sub, event)
        return event

    def _offer(self, sub: Subscription, event: AvatarEvent) -> None:
        try:
            sub.queue.put_nowait(event)
        except asyncio.QueueFull:
            # Drop the oldest, keep the newest: an expression transition from
            # four seconds ago is worthless, the current one is not.
            try:
                sub.queue.get_nowait()
            except asyncio.QueueEmpty:  # pragma: no cover - racy only in theory
                pass
            sub.dropped += 1
            try:
                sub.queue.put_nowait(event)
            except asyncio.QueueFull:  # pragma: no cover
                pass

    async def aclose(self) -> None:
        """Detach every subscriber. Idempotent."""
        for sub in list(self._subscribers):
            self.unsubscribe(sub)
        self._sticky.clear()


#: Events whose *latest* value is replayed to a late subscriber. Deliberately
#: excludes transient ones (frame drops, transitions) — replaying those would
#: make a freshly-opened admin panel show a history that is no longer true.
_STICKY_EVENTS: Final[frozenset[EventName]] = frozenset(
    {
        EventName.READY,
        EventName.STATE_CHANGED,
        EventName.RUNTIME_DEGRADED,
    }
)


__all__ = [
    "DEFAULT_QUEUE_SIZE",
    "AvatarEvent",
    "EventBus",
    "EventName",
    "Subscription",
]
