"""Mouth / face masks from landmarks (§22).

§22 is explicit: *"Mask 使用 face parsing 或 landmark polygon，避免矩形貼嘴"* — no
rectangular mouth patches. The reason is visible within one second of watching:
a rectangle's corners cut across the nasolabial fold and the chin, so every
frame where MuseTalk's skin tone differs even slightly from LivePortrait's
produces four flickering straight edges around the mouth. A landmark polygon
follows anatomy, and a feathered polygon has no edge to flicker at all.

Everything here is numpy only. A face-parsing network would give a better mask
and the engines provide one when they are installed (see
:func:`combine_parsing`), but the landmark polygon has to work with nothing
installed, because it is what the §53 floor composites with.

Landmark convention: the 68-point dlib/iBUG layout that both LivePortrait and
MuseTalk's preprocessing emit. Indices 48–59 are the outer lip contour, 60–67
the inner one.
"""

from __future__ import annotations

from typing import Final

import numpy as np

#: 68-point layout, outer lip contour.
OUTER_LIP_INDICES: Final[tuple[int, ...]] = tuple(range(48, 60))
#: 68-point layout, inner lip contour.
INNER_LIP_INDICES: Final[tuple[int, ...]] = tuple(range(60, 68))
#: Jawline, used for the face-region mask.
JAW_INDICES: Final[tuple[int, ...]] = tuple(range(0, 17))
#: Eyebrow tops, used to close the face polygon across the forehead.
BROW_INDICES: Final[tuple[int, ...]] = tuple(range(17, 27))

#: How far the mouth polygon is grown beyond the lip contour, as a fraction of
#: mouth width. MuseTalk regenerates a little skin around the lips; the mask has
#: to cover that or its own boundary becomes the seam.
DEFAULT_MOUTH_MARGIN: Final[float] = 0.22

#: Feather radius as a fraction of mouth width (§22 "Feather").
DEFAULT_FEATHER_RATIO: Final[float] = 0.09


def polygon_mask(points: np.ndarray, height: int, width: int) -> np.ndarray:
    """Rasterise a closed polygon to a float32 mask in [0, 1].

    Even-odd scanline fill evaluated at pixel centres. Concave polygons and
    self-intersections are handled correctly, which matters: an open mouth's
    inner-lip contour is genuinely concave.
    """
    if height <= 0 or width <= 0:
        msg = f"mask size must be positive, got {height}x{width}"
        raise ValueError(msg)
    pts = np.asarray(points, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 2 or pts.shape[0] < 3:
        msg = "a polygon needs at least 3 (x, y) points"
        raise ValueError(msg)

    mask = np.zeros((height, width), dtype=np.float32)
    x0 = pts[:, 0]
    y0 = pts[:, 1]
    x1 = np.roll(x0, -1)
    y1 = np.roll(y0, -1)

    # Only the rows the polygon actually covers.
    row_lo = max(0, int(np.floor(y0.min())))
    row_hi = min(height - 1, int(np.ceil(y0.max())))
    for row in range(row_lo, row_hi + 1):
        yc = row + 0.5
        crossing = ((y0 <= yc) & (y1 > yc)) | ((y1 <= yc) & (y0 > yc))
        if not crossing.any():
            continue
        ya, yb = y0[crossing], y1[crossing]
        xa, xb = x0[crossing], x1[crossing]
        xs = np.sort(xa + (yc - ya) * (xb - xa) / (yb - ya))
        for i in range(0, xs.size - 1, 2):
            left = int(np.ceil(xs[i] - 0.5))
            right = int(np.floor(xs[i + 1] - 0.5))
            left = max(0, left)
            right = min(width - 1, right)
            if right >= left:
                mask[row, left : right + 1] = 1.0
    return mask


def expand_polygon(points: np.ndarray, margin: float) -> np.ndarray:
    """Grow a polygon around its centroid by ``margin`` (0.2 = 20% larger)."""
    pts = np.asarray(points, dtype=np.float64)
    centroid = pts.mean(axis=0)
    return centroid + (pts - centroid) * (1.0 + margin)


def mouth_polygon(
    landmarks: np.ndarray,
    *,
    margin: float = DEFAULT_MOUTH_MARGIN,
) -> np.ndarray:
    """The outer-lip polygon, grown by ``margin``.

    Accepts either a full 68-point array or a pre-sliced lip contour, so the
    engines can hand over whatever their preprocessing produced.
    """
    pts = np.asarray(landmarks, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 2:
        msg = "landmarks must be an (N, 2) array"
        raise ValueError(msg)
    if pts.shape[0] >= 68:
        contour = pts[list(OUTER_LIP_INDICES)]
    elif pts.shape[0] >= 12:
        contour = pts[:12]
    else:
        msg = f"need at least 12 lip landmarks, got {pts.shape[0]}"
        raise ValueError(msg)
    return expand_polygon(contour, margin)


def face_polygon(landmarks: np.ndarray) -> np.ndarray:
    """A closed face-region polygon: jawline plus a brow-derived forehead arc.

    Used to keep the composite inside the face — a mouth mask that leaks past
    the jaw would paste MuseTalk's output onto the neck or the background.
    """
    pts = np.asarray(landmarks, dtype=np.float64)
    if pts.shape[0] < 27:
        msg = "face_polygon needs the 68-point layout (jaw + brows)"
        raise ValueError(msg)
    jaw = pts[list(JAW_INDICES)]
    brows = pts[list(BROW_INDICES)]
    # Lift the brow line to approximate the hairline, then walk it back the
    # other way so the polygon closes without crossing itself.
    brow_height = float(np.abs(jaw[:, 1].max() - brows[:, 1].min()))
    forehead = brows.copy()
    forehead[:, 1] -= brow_height * 0.35
    return np.vstack([jaw, forehead[::-1]])


def _box_blur_axis(array: np.ndarray, radius: int, axis: int) -> np.ndarray:
    """O(n) box blur along one axis via a prefix sum, edge-padded."""
    if radius < 1:
        return array
    kernel = 2 * radius + 1
    pad_width = [(0, 0), (0, 0)]
    pad_width[axis] = (radius, radius)
    padded = np.pad(array, pad_width, mode="edge")
    cumulative = np.cumsum(padded, axis=axis, dtype=np.float64)
    zero_shape = list(cumulative.shape)
    zero_shape[axis] = 1
    cumulative = np.concatenate(
        [np.zeros(zero_shape, dtype=np.float64), cumulative], axis=axis
    )
    length = array.shape[axis]
    hi: list[slice] = [slice(None), slice(None)]
    lo: list[slice] = [slice(None), slice(None)]
    hi[axis] = slice(kernel, kernel + length)
    lo[axis] = slice(0, length)
    return ((cumulative[tuple(hi)] - cumulative[tuple(lo)]) / kernel).astype(np.float32)


def feather(mask: np.ndarray, radius: int, *, passes: int = 3) -> np.ndarray:
    """Soften a mask's boundary (§22 "Feather").

    Three box-blur passes approximate a Gaussian closely enough that the
    difference is invisible at these radii, and cost O(n) instead of O(n·k) —
    which matters inside a 40ms frame budget.
    """
    if radius < 1:
        return mask.astype(np.float32, copy=False)
    out = mask.astype(np.float32, copy=True)
    for _ in range(max(1, passes)):
        out = _box_blur_axis(out, radius, axis=0)
        out = _box_blur_axis(out, radius, axis=1)
    return np.clip(out, 0.0, 1.0)


def mouth_mask(
    landmarks: np.ndarray,
    height: int,
    width: int,
    *,
    margin: float = DEFAULT_MOUTH_MARGIN,
    feather_ratio: float = DEFAULT_FEATHER_RATIO,
) -> np.ndarray:
    """The §22 mouth mask: landmark polygon, grown, rasterised, feathered.

    Never a rectangle. :func:`fill_ratio` is the assertion that keeps it that
    way in the test suite.
    """
    polygon = mouth_polygon(landmarks, margin=margin)
    mask = polygon_mask(polygon, height, width)
    span = float(polygon[:, 0].max() - polygon[:, 0].min())
    radius = max(1, int(round(span * feather_ratio)))
    return feather(mask, radius)


def constrain_to_face(mask: np.ndarray, landmarks: np.ndarray) -> np.ndarray:
    """Zero the parts of ``mask`` that fall outside the face polygon."""
    height, width = mask.shape[:2]
    face = polygon_mask(face_polygon(landmarks), height, width)
    return (mask * face).astype(np.float32)


def combine_parsing(
    landmark_mask: np.ndarray,
    parsing_mask: np.ndarray | None,
    *,
    weight: float = 0.5,
) -> np.ndarray:
    """Blend the landmark polygon with an engine-provided face-parsing mask.

    §22 allows either. When both exist the intersection-leaning blend is better
    than either alone: parsing follows the true lip boundary, the polygon keeps
    a stable shape when parsing flickers on a hard frame.
    """
    if parsing_mask is None:
        return landmark_mask.astype(np.float32, copy=False)
    if parsing_mask.shape[:2] != landmark_mask.shape[:2]:
        msg = "parsing mask and landmark mask must be the same size"
        raise ValueError(msg)
    weight = float(np.clip(weight, 0.0, 1.0))
    parsing = np.clip(parsing_mask.astype(np.float32), 0.0, 1.0)
    blended = landmark_mask * (1.0 - weight) + parsing * weight
    # Lean toward the intersection: anything either mask calls background stays
    # background, so the composite can never spill outside both.
    return np.clip(blended * np.maximum(landmark_mask, parsing), 0.0, 1.0)


def bbox_of_mask(mask: np.ndarray, threshold: float = 0.05) -> tuple[int, int, int, int]:
    """``(x, y, w, h)`` of the mask's support. ``(0, 0, 0, 0)`` if empty."""
    active = mask > threshold
    if not active.any():
        return (0, 0, 0, 0)
    rows = np.flatnonzero(active.any(axis=1))
    cols = np.flatnonzero(active.any(axis=0))
    y0, y1 = int(rows[0]), int(rows[-1])
    x0, x1 = int(cols[0]), int(cols[-1])
    return (x0, y0, x1 - x0 + 1, y1 - y0 + 1)


def fill_ratio(mask: np.ndarray, threshold: float = 0.5) -> float:
    """Fraction of the mask's bounding box that the mask actually covers.

    1.0 means the mask *is* its bounding box — i.e. a rectangle, i.e. the thing
    §22 forbids. A lip polygon lands around 0.6–0.8.
    """
    x, y, w, h = bbox_of_mask(mask, threshold=threshold)
    if w == 0 or h == 0:
        return 0.0
    window = mask[y : y + h, x : x + w]
    return float((window > threshold).sum()) / float(w * h)


__all__ = [
    "BROW_INDICES",
    "DEFAULT_FEATHER_RATIO",
    "DEFAULT_MOUTH_MARGIN",
    "INNER_LIP_INDICES",
    "JAW_INDICES",
    "OUTER_LIP_INDICES",
    "bbox_of_mask",
    "combine_parsing",
    "constrain_to_face",
    "expand_polygon",
    "face_polygon",
    "feather",
    "fill_ratio",
    "mouth_mask",
    "mouth_polygon",
    "polygon_mask",
]
