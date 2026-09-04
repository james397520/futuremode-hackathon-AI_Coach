"""Mouth ROI geometry (§2, §20, §22).

MuseTalk regenerates a crop, not a canvas. This module owns the crop: where it
is, how big, how it is squared and padded to the engine's expected input size,
and how the result gets back to canvas coordinates.

Two decisions worth stating, because both are the difference between "works in
a demo" and "works for ten minutes" (§62):

* **The ROI is square and quantised.** A crop whose size changes by one pixel
  per frame makes the engine resample slightly differently every frame, and the
  regenerated mouth shimmers even when the model output is stable. Sizes are
  snapped to a multiple of :data:`SIZE_QUANTUM`, so small landmark jitter does
  not change the crop at all.
* **The ROI is clamped into the canvas by translation, not by shrinking.** A
  face near the frame edge keeps its scale; only its position moves. Shrinking
  would change the mouth's apparent size mid-session.

Temporal smoothing of the box itself is §23's job and lives in
:mod:`app.compositor.temporal`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

import numpy as np

from app.compositor.face_mask import OUTER_LIP_INDICES

#: MuseTalk 1.5 works on a 256×256 mouth crop.
ENGINE_INPUT_SIZE: Final[int] = 256

#: Crop sizes snap to a multiple of this. 8 is small enough to track a face
#: that genuinely moves and large enough to absorb detector jitter.
SIZE_QUANTUM: Final[int] = 8

#: How much context around the lips the crop includes, as a fraction of mouth
#: width. Too tight and the engine has no chin or nasolabial context to match
#: against; too loose and it starts regenerating parts of the face §2 reserves
#: for LivePortrait.
DEFAULT_PADDING: Final[float] = 0.9


@dataclass(frozen=True, slots=True)
class MouthROI:
    """A square mouth crop in canvas coordinates."""

    x: int
    y: int
    size: int
    #: Canvas dimensions the box was computed against.
    canvas_width: int
    canvas_height: int

    @property
    def bbox(self) -> tuple[int, int, int, int]:
        return (self.x, self.y, self.size, self.size)

    @property
    def centre(self) -> tuple[float, float]:
        return (self.x + self.size / 2.0, self.y + self.size / 2.0)

    def contains_canvas(self) -> bool:
        return (
            self.x >= 0
            and self.y >= 0
            and self.x + self.size <= self.canvas_width
            and self.y + self.size <= self.canvas_height
        )

    def crop(self, frame: np.ndarray) -> np.ndarray:
        """Extract the ROI, zero-padding any part outside the canvas."""
        channels = frame.shape[2] if frame.ndim == 3 else 1
        shape = (self.size, self.size, channels) if frame.ndim == 3 else (self.size, self.size)
        out = np.zeros(shape, dtype=np.float32)
        x0, y0 = max(0, self.x), max(0, self.y)
        x1 = min(self.canvas_width, self.x + self.size)
        y1 = min(self.canvas_height, self.y + self.size)
        if x1 <= x0 or y1 <= y0:
            return out
        out[y0 - self.y : y1 - self.y, x0 - self.x : x1 - self.x] = frame[y0:y1, x0:x1]
        return out

    def scale_to(self, size: int) -> tuple[float, float]:
        """Scale factors from this ROI to a ``size``×``size`` engine input."""
        return (size / float(self.size), size / float(self.size))


def mouth_roi(
    landmarks: np.ndarray,
    canvas_width: int,
    canvas_height: int,
    *,
    padding: float = DEFAULT_PADDING,
    quantum: int = SIZE_QUANTUM,
) -> MouthROI:
    """Compute the square mouth crop for a frame's landmarks."""
    points = np.asarray(landmarks, dtype=np.float64)
    if points.ndim != 2 or points.shape[1] != 2:
        msg = "landmarks must be an (N, 2) array"
        raise ValueError(msg)
    contour = points[list(OUTER_LIP_INDICES)] if points.shape[0] >= 68 else points

    x_min, y_min = contour.min(axis=0)
    x_max, y_max = contour.max(axis=0)
    width = max(1.0, x_max - x_min)
    height = max(1.0, y_max - y_min)
    centre_x = (x_min + x_max) / 2.0
    centre_y = (y_min + y_max) / 2.0

    raw = max(width, height) * (1.0 + padding)
    size = int(np.ceil(raw / quantum) * quantum)
    size = max(quantum, min(size, min(canvas_width, canvas_height)))

    x = int(round(centre_x - size / 2.0))
    y = int(round(centre_y - size / 2.0))
    # Translate, never shrink.
    x = max(0, min(x, canvas_width - size))
    y = max(0, min(y, canvas_height - size))
    return MouthROI(x=x, y=y, size=size, canvas_width=canvas_width, canvas_height=canvas_height)


def resize_nearest(image: np.ndarray, size: int) -> np.ndarray:
    """Nearest-neighbour resize to ``size``×``size``.

    Nearest rather than bilinear because this path exists for the
    no-engine-installed case, where correctness of geometry matters and image
    quality does not: when a real engine is present it does its own resampling
    with its own preprocessing. Bilinear in numpy would cost four gathers per
    pixel for a result nobody sees.
    """
    if size <= 0:
        msg = f"size must be positive, got {size}"
        raise ValueError(msg)
    height, width = image.shape[:2]
    rows = np.clip((np.arange(size) * (height / size)).astype(np.int64), 0, height - 1)
    cols = np.clip((np.arange(size) * (width / size)).astype(np.int64), 0, width - 1)
    return image[rows[:, None], cols[None, :]]


def resize_to(image: np.ndarray, height: int, width: int) -> np.ndarray:
    """Nearest-neighbour resize to an arbitrary shape."""
    src_h, src_w = image.shape[:2]
    rows = np.clip((np.arange(height) * (src_h / height)).astype(np.int64), 0, src_h - 1)
    cols = np.clip((np.arange(width) * (src_w / width)).astype(np.int64), 0, src_w - 1)
    return image[rows[:, None], cols[None, :]]


def paste_roi(canvas: np.ndarray, roi: MouthROI, patch: np.ndarray) -> np.ndarray:
    """Write an engine-sized patch back into canvas coordinates.

    Returns a **full-canvas** frame with the patch in place and everything else
    copied from ``canvas``. The mask-based blend is a separate step
    (:mod:`app.compositor.mouth_blend`) — this function only does geometry, so
    the two concerns stay independently testable.
    """
    resized = patch if patch.shape[0] == roi.size else resize_nearest(patch, roi.size)
    out = canvas.astype(np.float32, copy=True)
    x0, y0 = max(0, roi.x), max(0, roi.y)
    x1 = min(canvas.shape[1], roi.x + roi.size)
    y1 = min(canvas.shape[0], roi.y + roi.size)
    if x1 <= x0 or y1 <= y0:
        return out
    out[y0:y1, x0:x1] = resized[y0 - roi.y : y1 - roi.y, x0 - roi.x : x1 - roi.x]
    return out


def synthetic_mouth_landmarks(
    centre: tuple[float, float],
    width: float,
    openness: float,
    *,
    count: int = 12,
) -> np.ndarray:
    """A plausible outer-lip contour, for the no-detector path.

    The static-portrait backend has no landmark detector, but it still needs a
    non-rectangular mouth polygon to composite with (§22) — so it synthesises
    one from the portrait's mouth position and the audio-driven openness. The
    shape is an ellipse flattened at the corners, which is what a lip contour
    actually looks like; a circle would produce a visibly round mouth.
    """
    cx, cy = centre
    height = width * (0.28 + 0.55 * max(0.0, min(1.0, openness)))
    angles = np.linspace(0.0, 2.0 * np.pi, count, endpoint=False)
    # |sin|^0.7 flattens the corners without flattening the top and bottom.
    radial = np.abs(np.sin(angles)) ** 0.7
    xs = cx + (width / 2.0) * np.cos(angles)
    ys = cy + (height / 2.0) * np.sign(np.sin(angles)) * radial
    return np.stack([xs, ys], axis=1)


__all__ = [
    "DEFAULT_PADDING",
    "ENGINE_INPUT_SIZE",
    "SIZE_QUANTUM",
    "MouthROI",
    "mouth_roi",
    "paste_roi",
    "resize_nearest",
    "resize_to",
    "synthetic_mouth_landmarks",
]
