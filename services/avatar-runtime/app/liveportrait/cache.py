"""Rendered-frame cache for the Expression State Bank (§3.1, §64).

In Mode A the same frames are shown over and over: a five-second, 125-frame
loop at 25fps repeats twelve times a minute, and a session spends most of its
time in two or three expressions. Rendering them once and keeping them is the
difference between LivePortrait running continuously and LivePortrait running
almost never.

The cache is bounded in **bytes**, not entries. A 512×512 RGB frame is 786 KB
as float32 and 262 KB as uint8; counting entries would make the budget mean
something different at every resolution, and §65 changes the resolution at
runtime. Frames are stored as uint8 for the same reason — a cache is not the
place to hold four bytes per channel.

§64's ``max_active_avatars=3`` is enforced one level up, in
:mod:`app.avatars.store`; this cache belongs to a single loaded avatar.
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from app.expression.presets import ExpressionName

#: Default budget. Roughly 250 uint8 frames at 512×512 — two full loops plus a
#: crossfade's worth of a third.
DEFAULT_BUDGET_MB: float = 64.0


@dataclass(frozen=True, slots=True)
class FrameKey:
    """What identifies a cached frame."""

    expression: ExpressionName
    frame_index: int
    #: Quantised intensity. Caching per exact float would never hit; 20 buckets
    #: is finer than the eye resolves on a 512px card.
    intensity_bucket: int

    @classmethod
    def of(cls, expression: ExpressionName, frame_index: int, intensity: float) -> FrameKey:
        bucket = int(round(max(0.0, min(1.0, intensity)) * 20))
        return cls(expression=expression, frame_index=frame_index, intensity_bucket=bucket)


class FrameCache:
    """Byte-bounded LRU of rendered expression frames."""

    __slots__ = ("_budget_bytes", "_bytes", "_entries", "hits", "misses")

    def __init__(self, budget_mb: float = DEFAULT_BUDGET_MB) -> None:
        if budget_mb <= 0:
            msg = f"budget_mb must be positive, got {budget_mb}"
            raise ValueError(msg)
        self._budget_bytes = int(budget_mb * 1024 * 1024)
        self._entries: OrderedDict[FrameKey, np.ndarray] = OrderedDict()
        self._bytes = 0
        self.hits = 0
        self.misses = 0

    @property
    def size_bytes(self) -> int:
        return self._bytes

    @property
    def count(self) -> int:
        return len(self._entries)

    @property
    def hit_rate(self) -> float:
        total = self.hits + self.misses
        return self.hits / total if total else 0.0

    def get(self, key: FrameKey) -> np.ndarray | None:
        frame = self._entries.get(key)
        if frame is None:
            self.misses += 1
            return None
        self._entries.move_to_end(key)
        self.hits += 1
        # A copy, always: the caller composites a mouth into the frame it gets
        # back, and handing out the cached buffer would poison the cache with
        # last frame's mouth.
        return frame.copy()

    def put(self, key: FrameKey, frame: np.ndarray) -> None:
        stored = frame if frame.dtype == np.uint8 else np.clip(frame, 0, 255).astype(np.uint8)
        size = int(stored.nbytes)
        if size > self._budget_bytes:
            # One frame larger than the whole budget: caching it would evict
            # everything and then itself. Skip rather than thrash.
            return
        if key in self._entries:
            self._bytes -= int(self._entries[key].nbytes)
        self._entries[key] = stored
        self._entries.move_to_end(key)
        self._bytes += size
        self._evict()

    def _evict(self) -> None:
        while self._bytes > self._budget_bytes and self._entries:
            _, evicted = self._entries.popitem(last=False)
            self._bytes -= int(evicted.nbytes)

    def clear(self) -> None:
        self._entries.clear()
        self._bytes = 0

    def resize(self, budget_mb: float) -> None:
        """Shrink or grow the budget — §65 degrade steps call this."""
        if budget_mb <= 0:
            msg = f"budget_mb must be positive, got {budget_mb}"
            raise ValueError(msg)
        self._budget_bytes = int(budget_mb * 1024 * 1024)
        self._evict()


__all__ = ["DEFAULT_BUDGET_MB", "FrameCache", "FrameKey"]
