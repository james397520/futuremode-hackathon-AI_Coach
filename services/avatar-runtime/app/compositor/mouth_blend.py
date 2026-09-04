"""Mouth ROI compositing (§2, §22, §23) — the rule the whole design rests on.

§2 rejects the obvious pipeline::

    LivePortrait full face → MuseTalk full face → output

because two generative models editing the same pixels produce skin-texture
crawl, identity drift and a mouth boundary that jitters every frame. The
prescribed pipeline is instead::

    upper face = LivePortrait 主導
    mouth ROI  = MuseTalk 主導
    boundary   = soft mask blending

which is what this module implements, in §22's order:

    MuseTalk mouth → Mouth Mask → Feather → Color Match → Alpha Blend
                   → Temporal Smooth → final frame

**LivePortrait 管「演技」，MuseTalk 管「嘴」** (§1). Nothing above the mouth mask
is ever touched by the lip-sync engine, and that single constraint is why the
identity stays stable under strong expressions.

numpy only, so the composite is real and unit-testable with no engine present —
which also means the §53 fallback rungs use exactly the same code path as the
full pipeline, rather than a separate one that nobody exercises.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np

from app.compositor.color_match import DEFAULT_STRENGTH, masked_stats, match_color
from app.compositor.face_mask import (
    DEFAULT_FEATHER_RATIO,
    DEFAULT_MOUTH_MARGIN,
    bbox_of_mask,
    combine_parsing,
    constrain_to_face,
    feather,
    mouth_polygon,
    polygon_mask,
)
from app.compositor.temporal import DEFAULT_ALPHA, TemporalSmoothers

if TYPE_CHECKING:
    from collections.abc import Sequence


def alpha_blend(host: np.ndarray, patch: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """``host * (1 - mask) + patch * mask``, broadcasting the mask over channels."""
    if host.shape != patch.shape:
        msg = f"host {host.shape} and patch {patch.shape} must match"
        raise ValueError(msg)
    if mask.shape[:2] != host.shape[:2]:
        msg = "mask must cover the same pixel grid as the frame"
        raise ValueError(msg)
    weights = np.clip(mask.astype(np.float32), 0.0, 1.0)
    if host.ndim == 3:
        weights = weights[..., None]
    blended = host.astype(np.float32) * (1.0 - weights) + patch.astype(np.float32) * weights
    return blended


def paste_region(
    frame: np.ndarray,
    region: np.ndarray,
    bbox: tuple[int, int, int, int],
    mask: np.ndarray,
) -> np.ndarray:
    """Blend a cropped ``region`` back into ``frame`` at ``bbox``.

    The engines work on a crop, not the full canvas (§20 caches crop
    coordinates per avatar for exactly this reason), so this is the step that
    returns to canvas space. Out-of-bounds boxes are clipped rather than
    rejected: a face near the frame edge is a rendering situation, not an error.
    """
    x, y, w, h = bbox
    height, width = frame.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(width, x + w), min(height, y + h)
    if x1 <= x0 or y1 <= y0:
        return frame.astype(np.float32, copy=True)

    out = frame.astype(np.float32, copy=True)
    sub_region = region[y0 - y : y1 - y, x0 - x : x1 - x]
    sub_mask = mask[y0 - y : y1 - y, x0 - x : x1 - x]
    out[y0:y1, x0:x1] = alpha_blend(out[y0:y1, x0:x1], sub_region, sub_mask)
    return out


@dataclass(frozen=True, slots=True)
class CompositeResult:
    """One composited frame plus the numbers the §58 quality tests read."""

    frame: np.ndarray
    mask: np.ndarray
    bbox: tuple[int, int, int, int]
    #: Fraction of the frame the mouth mask actually covers. A sudden jump is
    #: the signature of a landmark detection failure.
    mask_coverage: float
    #: True when the composite ran with no MuseTalk output — §53's middle rung,
    #: where the LivePortrait motion is kept and the mouth is simply not driven.
    lipsync_applied: bool


class MouthCompositor:
    """The §22 pipeline with the §23 temporal smoothing wired in.

    One instance per session. It carries the EMA state, so calling
    :meth:`composite` on unrelated frames would be a bug — and :meth:`reset` is
    what §15 barge-in calls to make that safe.
    """

    __slots__ = (
        "_smoothers",
        "color_strength",
        "feather_ratio",
        "margin",
        "parsing_weight",
    )

    def __init__(
        self,
        *,
        alpha: float = DEFAULT_ALPHA,
        margin: float = DEFAULT_MOUTH_MARGIN,
        feather_ratio: float = DEFAULT_FEATHER_RATIO,
        color_strength: float = DEFAULT_STRENGTH,
        parsing_weight: float = 0.5,
    ) -> None:
        self._smoothers = TemporalSmoothers(alpha)
        self.margin = margin
        self.feather_ratio = feather_ratio
        self.color_strength = color_strength
        self.parsing_weight = parsing_weight

    # -- mask construction -------------------------------------------------

    def build_mask(
        self,
        landmarks: np.ndarray,
        shape: tuple[int, int],
        *,
        parsing_mask: np.ndarray | None = None,
        constrain: bool = True,
    ) -> tuple[np.ndarray, np.ndarray]:
        """Smoothed landmarks → feathered mouth mask. Returns ``(mask, landmarks)``.

        Landmarks are smoothed *before* rasterisation, not after: smoothing the
        mask alone leaves the polygon's vertices jittering underneath and only
        blurs the evidence.
        """
        smoothed_landmarks = self._smoothers.landmarks.update(np.asarray(landmarks, np.float64))
        polygon = mouth_polygon(smoothed_landmarks, margin=self.margin)
        height, width = shape
        raw = polygon_mask(polygon, height, width)
        span = float(polygon[:, 0].max() - polygon[:, 0].min())
        radius = max(1, int(round(span * self.feather_ratio)))
        mask = feather(raw, radius)
        mask = combine_parsing(mask, parsing_mask, weight=self.parsing_weight)
        if constrain and np.asarray(smoothed_landmarks).shape[0] >= 27:
            mask = constrain_to_face(mask, smoothed_landmarks)
        return self._smoothers.mask.update(mask), smoothed_landmarks

    # -- the composite -----------------------------------------------------

    def composite(
        self,
        host: np.ndarray,
        mouth: np.ndarray | None,
        landmarks: np.ndarray | Sequence[Sequence[float]],
        *,
        parsing_mask: np.ndarray | None = None,
    ) -> CompositeResult:
        """Run §22 end to end for one frame.

        ``host``
            The LivePortrait (or state-bank, or static-portrait) frame. It owns
            everything outside the mouth mask, always.
        ``mouth``
            MuseTalk's output, same shape as ``host``. **None** is a supported,
            expected input: it is §53's "MuseTalk fail → LivePortrait motion +
            audio" rung, and it returns the host frame untouched rather than
            raising.
        """
        if host.ndim != 3:
            msg = "host frame must be (H, W, C)"
            raise ValueError(msg)
        points = np.asarray(landmarks, dtype=np.float64)
        mask, _ = self.build_mask(
            points, (host.shape[0], host.shape[1]), parsing_mask=parsing_mask
        )
        bbox = self._smoothers.bbox.update(bbox_of_mask(mask))
        coverage = float(mask.mean())

        if mouth is None:
            return CompositeResult(
                frame=host.astype(np.float32, copy=True),
                mask=mask,
                bbox=bbox,
                mask_coverage=coverage,
                lipsync_applied=False,
            )
        if mouth.shape != host.shape:
            msg = f"mouth frame {mouth.shape} must match host {host.shape}"
            raise ValueError(msg)

        # §22 order: colour match before the blend, with §23-smoothed statistics
        # so the correction does not pump frame to frame.
        patch_stats = self._smoothers.color_patch.update(masked_stats(mouth, mask))
        host_stats = self._smoothers.color_host.update(masked_stats(host, mask))
        matched = match_color(
            mouth,
            host,
            mask,
            strength=self.color_strength,
            stats_override=(patch_stats, host_stats),
        )
        blended = alpha_blend(host, matched, mask)
        return CompositeResult(
            frame=blended,
            mask=mask,
            bbox=bbox,
            mask_coverage=coverage,
            lipsync_applied=True,
        )

    def reset(self) -> None:
        """Drop all temporal state (§15 barge-in, avatar switch, resize)."""
        self._smoothers.reset()


__all__ = ["CompositeResult", "MouthCompositor", "alpha_blend", "paste_region"]
