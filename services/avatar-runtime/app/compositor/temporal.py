"""Temporal smoothing (§23).

§23 asks for an EMA over four quantities — **mask, bbox, mouth landmarks and
colour correction** — with the formula

    smoothed = alpha * current + (1 - alpha) * previous

and a starting alpha of 0.5–0.8.

Note the direction: a *higher* alpha follows the current frame more closely and
smooths less. 0.5 is heavy smoothing, 0.8 is light. The default here is 0.65,
in the middle of §23's band.

Why each of the four is smoothed
--------------------------------
* **landmarks** — the detector is per-frame and independent, so its output
  jitters by a pixel or two even on a still face. Unsmoothed, the mouth polygon
  breathes.
* **bbox** — the crop the engines work in. A jittering crop makes the whole
  regenerated region shimmer, which is far more visible than the jitter itself.
* **mask** — smoothing the rasterised mask catches the residue the landmark
  smoothing does not.
* **colour correction** — per-frame statistics react to a single frame where
  the mouth happens to be open; smoothing them stops the correction pumping.

Every smoother must survive being fed a first sample (nothing to blend with),
a shape change (the canvas was resized by a §65 degrade), and a reset (§15
barge-in, where the previous mouth is no longer relevant).
"""

from __future__ import annotations

from typing import Final, Generic, TypeVar

import numpy as np

from app.compositor.color_match import ColorStats

#: §23's suggested starting band.
MIN_ALPHA: Final[float] = 0.5
MAX_ALPHA: Final[float] = 0.8
DEFAULT_ALPHA: Final[float] = 0.65

T = TypeVar("T", bound=np.ndarray)


def ema(current: np.ndarray, previous: np.ndarray | None, alpha: float) -> np.ndarray:
    """§23's formula. ``previous=None`` returns ``current`` unchanged."""
    curr = np.asarray(current, dtype=np.float64)
    if previous is None:
        return curr.astype(np.float32)
    prev = np.asarray(previous, dtype=np.float64)
    if prev.shape != curr.shape:
        # A shape change means the geometry itself changed (resolution degrade,
        # a different avatar). Blending across it would be nonsense.
        return curr.astype(np.float32)
    return (alpha * curr + (1.0 - alpha) * prev).astype(np.float32)


def _validate_alpha(alpha: float) -> float:
    if not 0.0 < alpha <= 1.0:
        msg = f"alpha must be in (0, 1], got {alpha}"
        raise ValueError(msg)
    return float(alpha)


class EMASmoother(Generic[T]):
    """Exponential moving average over numpy arrays of a fixed shape."""

    __slots__ = ("_previous", "alpha")

    def __init__(self, alpha: float = DEFAULT_ALPHA) -> None:
        self.alpha = _validate_alpha(alpha)
        self._previous: np.ndarray | None = None

    @property
    def primed(self) -> bool:
        return self._previous is not None

    @property
    def value(self) -> np.ndarray | None:
        return self._previous

    def update(self, current: np.ndarray) -> np.ndarray:
        smoothed = ema(current, self._previous, self.alpha)
        self._previous = smoothed
        return smoothed

    def reset(self) -> None:
        self._previous = None


class ScalarSmoother:
    """EMA over a single float — used for drift, fps and luminance gain."""

    __slots__ = ("_previous", "alpha")

    def __init__(self, alpha: float = DEFAULT_ALPHA) -> None:
        self.alpha = _validate_alpha(alpha)
        self._previous: float | None = None

    @property
    def value(self) -> float | None:
        return self._previous

    def update(self, current: float) -> float:
        if self._previous is None:
            self._previous = float(current)
        else:
            self._previous = self.alpha * float(current) + (1.0 - self.alpha) * self._previous
        return self._previous

    def reset(self) -> None:
        self._previous = None


class BBoxSmoother:
    """EMA over an ``(x, y, w, h)`` box, rounded back to whole pixels.

    The rounding is deliberate and happens *after* the average: keeping the
    fractional box internally means a slow drift of half a pixel per frame
    still moves the crop eventually, instead of being rounded away every frame
    and never moving at all.
    """

    __slots__ = ("_previous", "alpha")

    def __init__(self, alpha: float = DEFAULT_ALPHA) -> None:
        self.alpha = _validate_alpha(alpha)
        self._previous: np.ndarray | None = None

    def update(self, bbox: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
        current = np.asarray(bbox, dtype=np.float64)
        if self._previous is None:
            self._previous = current
        else:
            self._previous = self.alpha * current + (1.0 - self.alpha) * self._previous
        x, y, w, h = (int(round(v)) for v in self._previous)
        return (x, y, max(0, w), max(0, h))

    def reset(self) -> None:
        self._previous = None


class ColorStatsSmoother:
    """EMA over :class:`~app.compositor.color_match.ColorStats`."""

    __slots__ = ("_mean", "_std", "alpha")

    def __init__(self, alpha: float = DEFAULT_ALPHA) -> None:
        self.alpha = _validate_alpha(alpha)
        self._mean = EMASmoother[np.ndarray](alpha)
        self._std = EMASmoother[np.ndarray](alpha)

    def update(self, stats: ColorStats) -> ColorStats:
        if not stats.usable:
            # Nothing reliable to fold in; keep the previous estimate so the
            # correction does not jump when the mouth briefly leaves frame.
            previous_mean = self._mean.value
            previous_std = self._std.value
            if previous_mean is not None and previous_std is not None:
                return ColorStats(mean=previous_mean, std=previous_std, weight=stats.weight)
            return stats
        return ColorStats(
            mean=self._mean.update(stats.mean),
            std=np.maximum(self._std.update(stats.std), 1e-5),
            weight=stats.weight,
        )

    def reset(self) -> None:
        self._mean.reset()
        self._std.reset()


class TemporalSmoothers:
    """The four §23 smoothers as one object, so a reset cannot forget one."""

    __slots__ = ("bbox", "color_host", "color_patch", "landmarks", "mask")

    def __init__(self, alpha: float = DEFAULT_ALPHA) -> None:
        _validate_alpha(alpha)
        self.mask = EMASmoother[np.ndarray](alpha)
        self.bbox = BBoxSmoother(alpha)
        self.landmarks = EMASmoother[np.ndarray](alpha)
        self.color_patch = ColorStatsSmoother(alpha)
        self.color_host = ColorStatsSmoother(alpha)

    def reset(self) -> None:
        """§15 — after a barge-in the previous mouth is stale, not a reference."""
        self.mask.reset()
        self.bbox.reset()
        self.landmarks.reset()
        self.color_patch.reset()
        self.color_host.reset()


__all__ = [
    "DEFAULT_ALPHA",
    "MAX_ALPHA",
    "MIN_ALPHA",
    "BBoxSmoother",
    "ColorStatsSmoother",
    "EMASmoother",
    "ScalarSmoother",
    "TemporalSmoothers",
    "ema",
]
