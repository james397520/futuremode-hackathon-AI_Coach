"""Smooth interpolation, §70 clamping, blinks and idle micro-motion.

Three §-requirements meet in this file:

* **§12** — expressions change over 350–700ms, not in one frame. The controller
  picks the duration; this module executes it with an ease curve, because a
  linear ramp between two poses reads as a mechanical slide.
* **§70** — the Persona Card is a small box on the right of the screen. Head
  motion is clamped to yaw ±12°, pitch ±8°, roll ±5° so the face never leaves
  it, and the clamp is applied *after* everything else (target pose, intensity
  scaling, idle motion, transition overshoot) so nothing downstream can exceed
  it.
* **§14 / §61** — "Idle / Listening 都必須有自然 blink + 小幅 head motion，避免人物
  像靜態圖片". An avatar that holds perfectly still for ten seconds reads as a
  crashed video player, which is the exact impression §53's fallback chain
  exists to avoid.

Everything here is deterministic given a seed, which is what makes the §61
listening behaviour testable rather than merely observable.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from random import Random
from typing import Final

from app.expression.presets import ExpressionState

# --- §70 Persona Card limits ----------------------------------------------

#: §70 gives ranges (yaw 8–12°, pitch 5–8°, roll ±5°). The permissive end is
#: used as the hard clamp and the conservative end as the idle-motion budget:
#: a deliberate expression may lean to 12°, ambient breathing motion may not.
MAX_YAW_DEG: Final[float] = 12.0
MAX_PITCH_DEG: Final[float] = 8.0
MAX_ROLL_DEG: Final[float] = 5.0

MAX_IDLE_YAW_DEG: Final[float] = 1.6
MAX_IDLE_PITCH_DEG: Final[float] = 1.0
MAX_IDLE_ROLL_DEG: Final[float] = 0.8

#: Eyelid aperture bounds. Never fully closed outside a blink, never bulging.
MIN_EYE_OPEN: Final[float] = 0.0
MAX_EYE_OPEN: Final[float] = 1.20

#: A human blink is 100–150ms of closure with a fast close and slower open.
BLINK_DURATION_S: Final[float] = 0.13
#: Two blinks never overlap and never come closer than this.
MIN_BLINK_GAP_S: Final[float] = 0.9


def clamp(value: float, low: float, high: float) -> float:
    return low if value < low else high if value > high else value


def clamp_pose(state: ExpressionState) -> ExpressionState:
    """Apply the §70 head/gaze clamp to an :class:`ExpressionState`."""
    return ExpressionState(
        name=state.name,
        intensity=clamp(state.intensity, 0.0, 1.0),
        head_yaw=clamp(state.head_yaw, -MAX_YAW_DEG, MAX_YAW_DEG),
        head_pitch=clamp(state.head_pitch, -MAX_PITCH_DEG, MAX_PITCH_DEG),
        head_roll=clamp(state.head_roll, -MAX_ROLL_DEG, MAX_ROLL_DEG),
        eye_open=clamp(state.eye_open, MIN_EYE_OPEN, MAX_EYE_OPEN),
        blink_rate=clamp(state.blink_rate, 0.0, 1.0),
        gaze_x=clamp(state.gaze_x, -1.0, 1.0),
        gaze_y=clamp(state.gaze_y, -1.0, 1.0),
        motion_energy=clamp(state.motion_energy, 0.0, 1.0),
    )


def ease_in_out(t: float) -> float:
    """Smoothstep. Zero velocity at both ends, so transitions have no visible
    start or stop — the face simply *has become* something else."""
    t = clamp(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp_expression(a: ExpressionState, b: ExpressionState, t: float) -> ExpressionState:
    """Blend two expression states. ``t=0`` is ``a``, ``t=1`` is ``b``."""
    t = clamp(t, 0.0, 1.0)
    return clamp_pose(
        ExpressionState(
            name=b.name if t >= 0.5 else a.name,
            intensity=lerp(a.intensity, b.intensity, t),
            head_yaw=lerp(a.head_yaw, b.head_yaw, t),
            head_pitch=lerp(a.head_pitch, b.head_pitch, t),
            head_roll=lerp(a.head_roll, b.head_roll, t),
            eye_open=lerp(a.eye_open, b.eye_open, t),
            blink_rate=lerp(a.blink_rate, b.blink_rate, t),
            gaze_x=lerp(a.gaze_x, b.gaze_x, t),
            gaze_y=lerp(a.gaze_y, b.gaze_y, t),
            motion_energy=lerp(a.motion_energy, b.motion_energy, t),
        )
    )


# ---------------------------------------------------------------------------
# Blink scheduling (§14, §61)
# ---------------------------------------------------------------------------


class BlinkScheduler:
    """Schedules natural blinks at a preset's ``blink_rate``.

    Blinks are Poisson-ish rather than metronomic: the interval is the mean
    interval scaled by a random factor in [0.55, 1.65]. Evenly spaced blinks
    are one of the strongest "this is a generated face" tells there is.

    ``blink_rate`` is blinks per second, so §10's 0.20 is a blink roughly every
    five seconds — the low end of a relaxed human, which is right for a talking
    head that is mostly listening.
    """

    __slots__ = ("_closed_until_s", "_next_blink_s", "_rate", "_rng")

    def __init__(self, *, rate: float = 0.2, seed: int | None = None) -> None:
        self._rng = Random(seed)
        self._rate = max(1e-3, rate)
        self._next_blink_s = self._schedule_from(0.0)
        self._closed_until_s = -1.0

    def _schedule_from(self, now_s: float) -> float:
        mean_interval = 1.0 / self._rate
        jitter = 0.55 + self._rng.random() * 1.10
        return now_s + max(MIN_BLINK_GAP_S, mean_interval * jitter)

    def set_rate(self, rate: float) -> None:
        """Adopt a new blink rate without cancelling the blink already pending."""
        self._rate = max(1e-3, rate)

    def eye_open_factor(self, now_s: float) -> float:
        """Multiplier in [0, 1] applied to the pose's ``eye_open``.

        1.0 = eyes as the expression wants them; 0.0 = fully closed. The curve
        is asymmetric — closing takes 40% of the blink and opening 60% — which
        is how a real eyelid moves.
        """
        if now_s >= self._next_blink_s and self._closed_until_s < now_s - BLINK_DURATION_S:
            self._closed_until_s = now_s + BLINK_DURATION_S
            self._next_blink_s = self._schedule_from(now_s + BLINK_DURATION_S)

        start = self._closed_until_s - BLINK_DURATION_S
        if not (start <= now_s <= self._closed_until_s):
            return 1.0
        phase = (now_s - start) / BLINK_DURATION_S
        if phase <= 0.4:
            return 1.0 - (phase / 0.4)
        return (phase - 0.4) / 0.6

    def is_blinking(self, now_s: float) -> bool:
        start = self._closed_until_s - BLINK_DURATION_S
        return start <= now_s <= self._closed_until_s

    def force_blink(self, now_s: float) -> None:
        """Trigger a blink immediately — used on strong state transitions, where
        a real face almost always blinks as it changes."""
        self._closed_until_s = now_s + BLINK_DURATION_S
        self._next_blink_s = self._schedule_from(now_s + BLINK_DURATION_S)


# ---------------------------------------------------------------------------
# Idle micro-motion (§14, §61)
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class IdleOffsets:
    yaw: float
    pitch: float
    roll: float


class IdleMotion:
    """Sub-degree ambient head motion so the avatar is never a still image.

    Three incommensurable sine frequencies per axis: the sum never repeats
    within a session, so there is no visible loop, and it needs no state beyond
    the current time — important, because the frame loop may skip frames (§17)
    and a stateful oscillator would jump when it does.

    Amplitude scales with the expression's ``motion_energy`` (§10), so an angry
    persona moves more than a thinking one, and is capped well below the §70
    limits: idle motion is ambience, not expression.
    """

    __slots__ = ("_phase",)

    #: Frequencies in Hz, chosen to be mutually irrational-ish.
    _YAW_HZ: Final[tuple[float, float]] = (0.13, 0.29)
    _PITCH_HZ: Final[tuple[float, float]] = (0.11, 0.37)
    _ROLL_HZ: Final[tuple[float, float]] = (0.07, 0.23)

    def __init__(self, *, seed: int | None = None) -> None:
        rng = Random(seed)
        #: Per-session phase offsets, so two avatars on one screen do not
        #: breathe in unison.
        self._phase = tuple(rng.random() * math.tau for _ in range(6))

    def offsets(self, now_s: float, motion_energy: float) -> IdleOffsets:
        energy = clamp(motion_energy, 0.0, 1.0)
        p = self._phase

        def wave(freqs: tuple[float, float], i: int) -> float:
            return 0.65 * math.sin(math.tau * freqs[0] * now_s + p[i]) + 0.35 * math.sin(
                math.tau * freqs[1] * now_s + p[i + 1]
            )

        return IdleOffsets(
            yaw=wave(self._YAW_HZ, 0) * MAX_IDLE_YAW_DEG * energy,
            pitch=wave(self._PITCH_HZ, 2) * MAX_IDLE_PITCH_DEG * energy,
            roll=wave(self._ROLL_HZ, 4) * MAX_IDLE_ROLL_DEG * energy,
        )


# ---------------------------------------------------------------------------
# The interpolator
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class RenderPose:
    """What a backend actually renders for one frame.

    This is an :class:`ExpressionState` after transition blending, idle motion,
    blink modulation and the §70 clamp — i.e. the only pose object that ever
    crosses into :mod:`app.backends`.
    """

    expression: str
    intensity: float
    head_yaw: float
    head_pitch: float
    head_roll: float
    eye_open: float
    gaze_x: float
    gaze_y: float
    motion_energy: float
    blinking: bool
    #: 0 while settled, 0→1 while a transition is in flight.
    transition_progress: float = 1.0


class ExpressionInterpolator:
    """Holds the current pose and eases it toward a target.

    ``set_target`` is idempotent for an unchanged target: re-sending the same
    persona state every turn (which the Scenario Director does) must not
    restart the transition, or the face would never finish arriving.
    """

    __slots__ = (
        "_blink",
        "_from",
        "_idle",
        "_duration_s",
        "_started_s",
        "_target",
        "idle_enabled",
    )

    def __init__(
        self,
        initial: ExpressionState,
        *,
        seed: int | None = None,
        idle_enabled: bool = True,
    ) -> None:
        clamped = clamp_pose(initial)
        self._from = clamped
        self._target = clamped
        self._started_s = 0.0
        self._duration_s = 0.0
        self._blink = BlinkScheduler(rate=clamped.blink_rate, seed=seed)
        self._idle = IdleMotion(seed=seed)
        self.idle_enabled = idle_enabled

    # -- state -------------------------------------------------------------

    @property
    def target(self) -> ExpressionState:
        return self._target

    def settled(self, now_s: float) -> bool:
        return self._progress(now_s) >= 1.0

    def _progress(self, now_s: float) -> float:
        if self._duration_s <= 0.0:
            return 1.0
        return clamp((now_s - self._started_s) / self._duration_s, 0.0, 1.0)

    def current(self, now_s: float) -> ExpressionState:
        """The blended expression state, before idle motion and blinks."""
        return lerp_expression(self._from, self._target, ease_in_out(self._progress(now_s)))

    # -- driving -----------------------------------------------------------

    def set_target(
        self,
        target: ExpressionState,
        *,
        now_s: float,
        duration_ms: float,
        blink_on_change: bool = False,
    ) -> bool:
        """Start easing toward ``target``. Returns False if it was already the target."""
        clamped = clamp_pose(target)
        if clamped == self._target:
            return False
        # Start from wherever the face actually is, not from the previous
        # target — interrupting a transition mid-way must not snap backwards.
        self._from = self.current(now_s)
        self._target = clamped
        self._started_s = now_s
        self._duration_s = max(0.0, duration_ms / 1000.0)
        self._blink.set_rate(clamped.blink_rate)
        if blink_on_change:
            self._blink.force_blink(now_s)
        return True

    def snap_to(self, target: ExpressionState, *, now_s: float) -> None:
        """Jump with no transition. Only for session start and hard resets."""
        clamped = clamp_pose(target)
        self._from = clamped
        self._target = clamped
        self._started_s = now_s
        self._duration_s = 0.0
        self._blink.set_rate(clamped.blink_rate)

    # -- sampling ----------------------------------------------------------

    def sample(self, now_s: float) -> RenderPose:
        """The pose for the frame at ``now_s``. Always inside the §70 limits."""
        base = self.current(now_s)
        yaw, pitch, roll = base.head_yaw, base.head_pitch, base.head_roll
        if self.idle_enabled:
            idle = self._idle.offsets(now_s, base.motion_energy)
            yaw += idle.yaw
            pitch += idle.pitch
            roll += idle.roll
        blink_factor = self._blink.eye_open_factor(now_s)
        return RenderPose(
            expression=base.name,
            intensity=base.intensity,
            # The clamp is last, on purpose: idle motion added to a pose that
            # was already at the limit must not push it past the card edge.
            head_yaw=clamp(yaw, -MAX_YAW_DEG, MAX_YAW_DEG),
            head_pitch=clamp(pitch, -MAX_PITCH_DEG, MAX_PITCH_DEG),
            head_roll=clamp(roll, -MAX_ROLL_DEG, MAX_ROLL_DEG),
            eye_open=clamp(base.eye_open * blink_factor, MIN_EYE_OPEN, MAX_EYE_OPEN),
            gaze_x=clamp(base.gaze_x, -1.0, 1.0),
            gaze_y=clamp(base.gaze_y, -1.0, 1.0),
            motion_energy=base.motion_energy,
            blinking=blink_factor < 0.999,
            transition_progress=self._progress(now_s),
        )


__all__ = [
    "BLINK_DURATION_S",
    "MAX_EYE_OPEN",
    "MAX_PITCH_DEG",
    "MAX_ROLL_DEG",
    "MAX_YAW_DEG",
    "MIN_EYE_OPEN",
    "BlinkScheduler",
    "ExpressionInterpolator",
    "IdleMotion",
    "IdleOffsets",
    "RenderPose",
    "clamp",
    "clamp_pose",
    "ease_in_out",
    "lerp",
    "lerp_expression",
]
