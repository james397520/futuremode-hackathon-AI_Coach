"""Frame scheduling (§49, §17).

``FrameScheduler`` from §49 is one idea: emit frame *slots* at the target rate,
and when generation falls behind, skip slots instead of queueing them.

Two distinct jobs live here:

* :class:`FrameClock` — the monotonic frame-slot generator. It answers "what
  time is it in frames?" and "how long until the next slot?", using
  ``time.monotonic`` (never ``time.time``: a NTP step mid-session must not make
  the avatar freeze or sprint).
* :class:`FrameQueue` — the bounded hand-off between the renderer and the
  transport. Full queue ⇒ drop the **oldest** frame. Dropping the newest would
  keep showing stale mouth shapes while fresh audio plays, which is the worst
  possible failure for lip sync.

The A/V drift decision itself lives in :mod:`app.core.audio_clock`, because
audio is the master clock (ADR-007) and this module must not have an opinion
about it.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from time import monotonic
from typing import TYPE_CHECKING, Generic, TypeVar

from app.core.config import DEFAULT_FPS

if TYPE_CHECKING:
    from collections.abc import Iterator

T = TypeVar("T")


@dataclass(slots=True)
class FrameSlot:
    """One scheduled frame."""

    index: int
    #: Presentation timestamp in seconds, ``index / fps`` (§17).
    pts_s: float
    #: Monotonic deadline by which this frame should have been produced.
    deadline_s: float
    #: Slots skipped between the previous emitted slot and this one.
    skipped: int = 0


class FrameClock:
    """Monotonic frame-slot source at a fixed fps.

    ``fps`` can be changed at runtime — §65 degrades 25→20fps under memory
    pressure on Mac — and the clock rebases so the PTS sequence stays monotonic
    across the change rather than jumping backwards.
    """

    __slots__ = ("_index", "_pts_base_s", "_started_s", "fps")

    def __init__(self, fps: int = DEFAULT_FPS) -> None:
        self._validate(fps)
        self.fps = fps
        self._started_s = monotonic()
        self._index = 0
        self._pts_base_s = 0.0

    @staticmethod
    def _validate(fps: int) -> None:
        if fps <= 0 or fps > 240:
            msg = f"fps must be in 1..240, got {fps}"
            raise ValueError(msg)

    @property
    def frame_period_s(self) -> float:
        return 1.0 / float(self.fps)

    @property
    def index(self) -> int:
        return self._index

    @property
    def pts_s(self) -> float:
        return self._pts_base_s + self._index * self.frame_period_s

    def set_fps(self, fps: int) -> None:
        """Change the rate without breaking PTS monotonicity (§65 degrade)."""
        self._validate(fps)
        if fps == self.fps:
            return
        # Freeze the PTS reached so far, then restart the index at the new rate.
        self._pts_base_s = self.pts_s
        self._started_s = monotonic()
        self._index = 0
        self.fps = fps

    def next_pts(self) -> float:
        """§49 — advance one slot and return its PTS."""
        self._index += 1
        return self.pts_s

    def deadline_for(self, index: int) -> float:
        return self._started_s + index * self.frame_period_s

    def slot(self) -> FrameSlot:
        """The current slot, without advancing."""
        return FrameSlot(
            index=self._index,
            pts_s=self.pts_s,
            deadline_s=self.deadline_for(self._index),
        )

    def behind_by(self) -> int:
        """How many whole frame slots wall-clock is ahead of the emitted index.

        Positive means the renderer is late and slots should be skipped rather
        than emitted back-to-back (§49).
        """
        elapsed = monotonic() - self._started_s
        due = int(elapsed / self.frame_period_s)
        return max(0, due - self._index)

    async def tick(self, *, catch_up: bool = True) -> FrameSlot:
        """Await the next slot.

        With ``catch_up`` (the default) a renderer that fell behind does **not**
        get a burst of back-to-back slots; the index jumps to the slot that is
        due now and the skipped count is reported so the caller can emit
        ``avatar.frame.drop``. That is §49's "drop late frames, keep audio
        realtime" expressed at the scheduler level.
        """
        self._index += 1
        skipped = 0
        if catch_up:
            behind = self.behind_by()
            if behind > 0:
                skipped = behind
                self._index += behind
        wait = self.deadline_for(self._index) - monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        slot = self.slot()
        slot.skipped = skipped
        return slot

    def slots(self, count: int) -> Iterator[FrameSlot]:
        """Synchronous slot sequence, for benchmarks and tests."""
        for _ in range(count):
            self._index += 1
            yield self.slot()

    def reset(self) -> None:
        self._started_s = monotonic()
        self._index = 0
        self._pts_base_s = 0.0


class FrameQueue(Generic[T]):
    """Bounded renderer→transport hand-off that drops the oldest on overflow.

    §49 in one object: never let a slow consumer turn into seconds of latency.
    :attr:`dropped` is what ``frame_drop_total{reason="queue_full"}`` counts.
    """

    __slots__ = ("_queue", "dropped")

    def __init__(self, maxsize: int = 8) -> None:
        if maxsize < 1:
            msg = f"maxsize must be >= 1, got {maxsize}"
            raise ValueError(msg)
        self._queue: asyncio.Queue[T] = asyncio.Queue(maxsize=maxsize)
        self.dropped = 0

    @property
    def size(self) -> int:
        return self._queue.qsize()

    @property
    def maxsize(self) -> int:
        return self._queue.maxsize

    def put(self, item: T) -> bool:
        """Enqueue without blocking. Returns False if something was dropped."""
        try:
            self._queue.put_nowait(item)
        except asyncio.QueueFull:
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:  # pragma: no cover
                pass
            self.dropped += 1
            try:
                self._queue.put_nowait(item)
            except asyncio.QueueFull:  # pragma: no cover
                return False
            return False
        return True

    async def get(self) -> T:
        return await self._queue.get()

    def get_nowait(self) -> T | None:
        try:
            return self._queue.get_nowait()
        except asyncio.QueueEmpty:
            return None

    def clear(self) -> int:
        """Discard everything queued. §15 barge-in flushes stale frames."""
        removed = 0
        while True:
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                return removed
            removed += 1


__all__ = ["FrameClock", "FrameQueue", "FrameSlot"]
