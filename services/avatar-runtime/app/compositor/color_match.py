"""Mouth-region colour matching (§22).

The two engines see different things. LivePortrait renders the host frame from
the source portrait's lighting; MuseTalk regenerates the mouth from its own
learned distribution, conditioned on audio. Even when both are excellent, the
mouth patch comes back a percent or two warmer or darker — and a percent or two,
changing every frame, is a flickering rectangle around the lips.

The fix is a per-channel mean/std transfer computed **inside the mask only**, so
the statistics describe the skin being blended, not the whole frame:

    matched = (patch - mean_patch) * (std_host / std_patch) + mean_host

Two safeguards make it usable at 25fps:

* ``strength`` — full correction can drag a legitimately dark open mouth toward
  skin tone. Around 0.7 removes the seam without erasing the mouth interior.
* a std-ratio clamp — when the mouth is open, the patch's variance is dominated
  by teeth and shadow, and an unclamped ratio would blow the correction up.

Colour correction is one of the four quantities §23 asks to smooth over time;
:class:`~app.compositor.temporal.ColorCorrection` carries the EMA.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

import numpy as np

DEFAULT_STRENGTH: Final[float] = 0.7
#: Bounds on ``std_host / std_patch``. Outside these the two regions are not
#: comparable and the safest correction is a gentle one.
MIN_STD_RATIO: Final[float] = 0.6
MAX_STD_RATIO: Final[float] = 1.6
_EPSILON: Final[float] = 1e-5


@dataclass(frozen=True, slots=True)
class ColorStats:
    """Per-channel mean and standard deviation inside a mask."""

    mean: np.ndarray  # shape (C,)
    std: np.ndarray  # shape (C,)
    #: Sum of mask weights. Near zero means the statistics are meaningless.
    weight: float

    @property
    def usable(self) -> bool:
        return self.weight > 8.0


def masked_stats(image: np.ndarray, mask: np.ndarray) -> ColorStats:
    """Weighted per-channel statistics over ``mask``.

    Weighted rather than thresholded: the feathered boundary should contribute
    partially, exactly as it does in the blend, or the statistics describe a
    slightly different region from the one being corrected.
    """
    if image.ndim != 3:
        msg = "image must be (H, W, C)"
        raise ValueError(msg)
    if mask.shape[:2] != image.shape[:2]:
        msg = "mask and image must be the same size"
        raise ValueError(msg)
    weights = np.clip(mask.astype(np.float64), 0.0, 1.0)
    total = float(weights.sum())
    channels = image.shape[2]
    if total <= _EPSILON:
        return ColorStats(
            mean=np.zeros(channels, dtype=np.float64),
            std=np.ones(channels, dtype=np.float64),
            weight=0.0,
        )
    pixels = image.astype(np.float64)
    w = weights[..., None]
    mean = (pixels * w).sum(axis=(0, 1)) / total
    variance = (((pixels - mean) ** 2) * w).sum(axis=(0, 1)) / total
    return ColorStats(mean=mean, std=np.sqrt(np.maximum(variance, _EPSILON)), weight=total)


def match_color(
    patch: np.ndarray,
    host: np.ndarray,
    mask: np.ndarray,
    *,
    strength: float = DEFAULT_STRENGTH,
    stats_override: tuple[ColorStats, ColorStats] | None = None,
) -> np.ndarray:
    """Recolour ``patch`` to sit inside ``host`` without a visible seam.

    ``stats_override`` lets the caller pass temporally-smoothed statistics
    (§23) instead of this frame's raw ones, which is what the compositor does.
    """
    if patch.shape != host.shape:
        msg = f"patch {patch.shape} and host {host.shape} must have the same shape"
        raise ValueError(msg)
    strength = float(np.clip(strength, 0.0, 1.0))
    if strength <= 0.0:
        return patch.astype(np.float32, copy=True)

    patch_stats, host_stats = stats_override or (
        masked_stats(patch, mask),
        masked_stats(host, mask),
    )
    if not (patch_stats.usable and host_stats.usable):
        # Too little masked area to say anything. Leaving the patch alone is
        # always safe; guessing is not.
        return patch.astype(np.float32, copy=True)

    ratio = np.clip(host_stats.std / np.maximum(patch_stats.std, _EPSILON), MIN_STD_RATIO,
                    MAX_STD_RATIO)
    corrected = (patch.astype(np.float64) - patch_stats.mean) * ratio + host_stats.mean
    blended = patch.astype(np.float64) * (1.0 - strength) + corrected * strength
    return np.clip(blended, 0.0, 255.0).astype(np.float32)


def luminance_gain(patch: np.ndarray, host: np.ndarray, mask: np.ndarray) -> float:
    """Scalar brightness ratio between host and patch inside the mask.

    A cheap health signal: a value drifting away from 1.0 across a session means
    the two engines' exposure has diverged and the bank needs rebuilding, not
    that the per-frame correction is failing.
    """
    patch_stats = masked_stats(patch, mask)
    host_stats = masked_stats(host, mask)
    if not (patch_stats.usable and host_stats.usable):
        return 1.0
    patch_mean = float(patch_stats.mean.mean())
    host_mean = float(host_stats.mean.mean())
    if patch_mean <= _EPSILON:
        return 1.0
    return host_mean / patch_mean


__all__ = [
    "DEFAULT_STRENGTH",
    "MAX_STD_RATIO",
    "MIN_STD_RATIO",
    "ColorStats",
    "luminance_gain",
    "masked_stats",
    "match_color",
]
