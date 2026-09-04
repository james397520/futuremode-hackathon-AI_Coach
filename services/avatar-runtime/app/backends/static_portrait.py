"""The always-available backend: a source portrait, animated (§53).

This is the floor of the fallback ladder and, on a machine that cannot host the
MLX engines, the path that actually runs. It therefore has to look deliberate
rather than broken: the figure blinks, breathes, drifts its head within the §70
clamps, and opens its mouth in time with the audio it is given.

Everything here is numpy. No engine, no GPU, no model weights — so it cannot be
the reason a training session fails to start.

The mouth is driven by short-window audio RMS rather than by a phoneme model.
That is honest about what it is: it tracks *loudness*, so it lands on syllable
boundaries and silences convincingly, and it does not pretend to be viseme-
accurate lip sync. MuseTalk supplies real lip sync when it is installed.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import ClassVar

import numpy as np
import structlog

from app.expression.interpolator import RenderPose

log = structlog.get_logger(__name__)

#: Mouth openness is smoothed toward the audio envelope; abrupt jumps read as a
#: glitch rather than as speech.
MOUTH_ATTACK = 0.55
MOUTH_RELEASE = 0.22
#: Below this RMS the mouth is treated as closed. Keeps room tone from producing
#: a permanently half-open mouth.
SILENCE_RMS = 0.012


@dataclass(slots=True)
class _Geometry:
    """Where the face features sit in the source image, in pixels."""

    eye_y: int
    eye_dx: int
    eye_rx: int
    eye_ry: int
    mouth_y: int
    mouth_rx: int
    mouth_ry: int
    centre_x: int

    #: Fractions of the framed stage, not of the source image, because the
    #: backend animates after `_fit` has cropped and resized. Overridable per
    #: avatar via `avatar.json -> geometry`, since "head and shoulders" (§71)
    #: still leaves a lot of room for where the head actually sits.
    DEFAULTS: ClassVar[dict[str, float]] = {
        "eye_y": 0.425,
        "eye_dx": 0.072,
        "eye_rx": 0.038,
        "eye_ry": 0.020,
        "mouth_y": 0.605,
        "mouth_rx": 0.052,
        "mouth_ry": 0.017,
        "centre_x": 0.500,
    }

    @classmethod
    def estimate(
        cls, height: int, width: int, overrides: Mapping[str, float] | None = None
    ) -> _Geometry:
        """Placement for a §71-conformant head-and-shoulders portrait.

        A real landmark detector would be better, but pulling one in would drag
        InsightFace — which §74 flags as non-commercial — into the one backend
        that must always be available. Proportions keep this path free of that
        constraint; `overrides` is how a portrait whose head sits higher or
        lower than the default framing gets its mouth overlay in the right
        place, without anyone editing this file.
        """
        g = {**cls.DEFAULTS, **{k: float(v) for k, v in (overrides or {}).items() if k in cls.DEFAULTS}}
        return cls(
            eye_y=int(height * g["eye_y"]),
            eye_dx=int(width * g["eye_dx"]),
            eye_rx=max(3, int(width * g["eye_rx"])),
            eye_ry=max(2, int(height * g["eye_ry"])),
            mouth_y=int(height * g["mouth_y"]),
            mouth_rx=max(4, int(width * g["mouth_rx"])),
            mouth_ry=max(3, int(height * g["mouth_ry"])),
            centre_x=int(width * g["centre_x"]),
        )


class StaticPortraitBackend:
    """Renders an animated portrait from a single still image."""

    name = "static_portrait"

    def __init__(
        self,
        portrait: np.ndarray,
        *,
        width: int,
        height: int,
        geometry: Mapping[str, float] | None = None,
    ) -> None:
        if portrait.ndim != 3 or portrait.shape[2] < 3:
            raise ValueError("portrait must be an HxWx3 RGB array")
        self._source = self._fit(portrait[:, :, :3].astype(np.float32), height, width)
        self._h, self._w = height, width
        self._geom = _Geometry.estimate(height, width, geometry)
        self._mouth_open = 0.0
        self._yy, self._xx = np.mgrid[0:height, 0:width].astype(np.float32)

    # -- public API ----------------------------------------------------------
    def push_audio_envelope(self, samples: np.ndarray) -> float:
        """Feed the audio for the next frame; returns the smoothed openness 0..1."""
        if samples.size == 0:
            target = 0.0
        else:
            rms = float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))
            target = 0.0 if rms < SILENCE_RMS else min(1.0, (rms - SILENCE_RMS) * 9.0)
        # Asymmetric smoothing: a mouth opens faster than it closes, which is
        # both true and much more forgiving of a coarse envelope.
        alpha = MOUTH_ATTACK if target > self._mouth_open else MOUTH_RELEASE
        self._mouth_open += alpha * (target - self._mouth_open)
        return self._mouth_open

    def close_mouth(self) -> None:
        """Force the mouth shut immediately (§15 barge-in).

        Deliberately not "feed silence until it decays": at the release
        coefficient a natural decay needs ~13 frames to reach closed, which at
        20 fps is two thirds of a second of the figure still mouthing words
        after the trainee has cut in. Barge-in means stop now.
        """
        self._mouth_open = 0.0

    def render(self, pose: RenderPose, *, mouth_open: float | None = None) -> np.ndarray:
        """Render one RGB uint8 frame for the given pose."""
        openness = self._mouth_open if mouth_open is None else float(mouth_open)
        frame = self._apply_head_motion(self._source, pose)
        frame = self._apply_blink(frame, pose)
        frame = self._apply_mouth(frame, openness)
        frame = self._apply_energy_tint(frame, pose)
        return np.clip(frame, 0.0, 255.0).astype(np.uint8)

    # -- internals -----------------------------------------------------------
    @staticmethod
    def _fit(img: np.ndarray, height: int, width: int) -> np.ndarray:
        """Centre-crop to the target aspect, then nearest-resample.

        Nearest rather than bilinear because this runs per frame and the source
        is already larger than the stage; the quality difference is invisible at
        384x512 and the cost difference is not.
        """
        sh, sw = img.shape[:2]
        target_ar = width / height
        src_ar = sw / sh
        if src_ar > target_ar:                      # too wide -> crop sides
            new_w = int(round(sh * target_ar))
            x0 = (sw - new_w) // 2
            img = img[:, x0 : x0 + new_w]
        elif src_ar < target_ar:                    # too tall -> crop bottom
            new_h = int(round(sw / target_ar))
            img = img[0:new_h, :]
        sh, sw = img.shape[:2]
        ys = (np.linspace(0, sh - 1, height)).astype(np.int32)
        xs = (np.linspace(0, sw - 1, width)).astype(np.int32)
        return img[ys][:, xs]

    def _apply_head_motion(self, img: np.ndarray, pose: RenderPose) -> np.ndarray:
        """Translate/scale to fake small head motion.

        A real 3D rotation needs a head model; within the §70 clamps (yaw +/-12,
        pitch +/-8) a sub-pixel shift plus a breathing scale is visually
        indistinguishable and costs a single roll.
        """
        # ~1.4 px of travel per degree keeps motion inside the card at 384x512.
        dx = int(round(pose.head_yaw * self._w * 0.0032))
        dy = int(round(pose.head_pitch * self._h * 0.0026))
        breath = 1.0 + 0.004 * math.sin(pose.motion_energy * math.tau)
        out = self._shift_clamped(img, dy, dx)
        if abs(breath - 1.0) > 1e-4:
            out = out * breath
        return out

    @staticmethod
    def _shift_clamped(img: np.ndarray, dy: int, dx: int) -> np.ndarray:
        """Translate, repeating the edge pixels instead of wrapping.

        `np.roll` would be shorter, but it wraps: shifting down by 3px drags the
        bottom three rows — shoulders, or whatever the portrait ends on — across
        the top of the head as a dark band. Clamping to the edge is invisible
        because the §71 portrait has a plain, even margin.
        """
        if dy == 0 and dx == 0:
            return img
        out = img
        if dy:
            out = np.concatenate(
                (np.repeat(out[:1], dy, axis=0), out[:-dy]) if dy > 0
                else (out[-dy:], np.repeat(out[-1:], -dy, axis=0)),
                axis=0,
            )
        if dx:
            out = np.concatenate(
                (np.repeat(out[:, :1], dx, axis=1), out[:, :-dx]) if dx > 0
                else (out[:, -dx:], np.repeat(out[:, -1:], -dx, axis=1)),
                axis=1,
            )
        return out

    def _apply_blink(self, img: np.ndarray, pose: RenderPose) -> np.ndarray:
        """Close the eyelids by darkening + collapsing the eye ellipses."""
        closed = 1.0 - max(0.0, min(1.0, pose.eye_open))
        if closed < 0.02:
            return img
        g = self._geom
        out = img
        for sign in (-1, 1):
            cxe = g.centre_x + sign * g.eye_dx
            # Ellipse that shrinks vertically as the lid closes.
            ry = max(1.0, g.eye_ry * (1.0 - 0.85 * closed))
            m = (((self._xx - cxe) / g.eye_rx) ** 2 + ((self._yy - g.eye_y) / ry) ** 2) <= 1.0
            if not m.any():
                continue
            lid = self._sample_skin(img, g.eye_y - g.eye_ry * 2, cxe)
            out = np.where(m[..., None], img * (1 - closed) + lid * closed, out)
        return out

    def _apply_mouth(self, img: np.ndarray, openness: float) -> np.ndarray:
        """Open the mouth by darkening an ellipse that grows with the envelope."""
        if openness < 0.03:
            return img
        g = self._geom
        ry = g.mouth_ry * (0.35 + 1.9 * openness)
        rx = g.mouth_rx * (0.92 + 0.12 * openness)
        d = ((self._xx - g.centre_x) / rx) ** 2 + ((self._yy - g.mouth_y) / ry) ** 2
        inner = np.clip(1.0 - d, 0.0, 1.0)          # soft, so the edge is not a hard oval
        if not np.any(inner > 0):
            return img
        # Oral cavity: a desaturated dark tone derived from the local skin so it
        # sits in the portrait's own palette rather than looking like a hole.
        skin = self._sample_skin(img, g.mouth_y - g.mouth_ry * 3, g.centre_x)
        cavity = skin * np.array([0.30, 0.20, 0.22], dtype=np.float32)
        a = (inner * min(1.0, openness * 1.15))[..., None]
        return img * (1.0 - a) + cavity * a

    @staticmethod
    def _apply_energy_tint(img: np.ndarray, pose: RenderPose) -> np.ndarray:
        """A very slight warm/cool shift with intensity.

        Enough that a strong expression reads differently at a glance without the
        figure changing identity — the §58 "strong emotion identity stability"
        check is the thing this must not break.
        """
        if pose.intensity < 0.35:
            return img
        k = (pose.intensity - 0.35) * 0.06
        return img * np.array([1.0 + k, 1.0 - k * 0.35, 1.0 - k * 0.5], dtype=np.float32)

    def _sample_skin(self, img: np.ndarray, y: float, x: float) -> np.ndarray:
        yi = int(np.clip(y, 0, self._h - 1))
        xi = int(np.clip(x, 0, self._w - 1))
        patch = img[max(0, yi - 2) : yi + 3, max(0, xi - 2) : xi + 3]
        return patch.reshape(-1, 3).mean(axis=0) if patch.size else np.zeros(3, np.float32)
