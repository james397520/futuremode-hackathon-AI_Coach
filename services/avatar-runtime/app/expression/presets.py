"""Expression presets — §9 (the data type) and §10 (the values), plus §69's cut.

LivePortrait has no ``emotion="angry"`` API. §9's answer is the pipeline

    semantic emotion → Expression Controller → curated motion template → LivePortrait

and this module is the first arrow: the curated, hand-tunable numbers that a
semantic label means. They are *product* values, not model internals, which is
why they live in typed Python where a reviewer can diff them, rather than in a
model checkpoint where nobody can.

§69 says the first version ships six expressions — neutral, listening,
skeptical, concerned, frustrated, interested — and that is enough to demo an AI
customer. They are marked :attr:`Priority.P0`. The rest (angry, thinking, and
the second-version set) are P1: defined, tuned, and *not* required to exist as
motion templates for a session to start. :func:`available_presets` is what the
state bank and the controller consult, so a deployment that only built the six
never selects an expression it cannot render.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import StrEnum
from typing import Final


class ExpressionName(StrEnum):
    """Every expression the controller may select.

    §7's ``motion/`` and ``loops/`` directories are named after these values, so
    renaming one is an asset migration, not a refactor.
    """

    # --- §69 first version (P0) ---
    NEUTRAL = "neutral"
    LISTENING = "listening"
    SKEPTICAL = "skeptical"
    CONCERNED = "concerned"
    FRUSTRATED = "frustrated"
    INTERESTED = "interested"
    # --- second version (P1) ---
    ANGRY = "angry"
    THINKING = "thinking"
    CONFUSED = "confused"
    SATISFIED = "satisfied"
    READY = "ready"
    DISENGAGED = "disengaged"


class Priority(StrEnum):
    """Ship-order marker. P0 must exist; P1 is used only if built."""

    P0 = "p0"
    P1 = "p1"


class Gaze(StrEnum):
    """§70 — "不要一開始做複雜 eye tracking". Three named directions, no more."""

    USER = "user"
    SLIGHTLY_AWAY = "slightly_away"
    DOWN = "down"


#: §70 gaze offsets in normalised units, applied on top of a preset's own gaze.
GAZE_OFFSETS: Final[dict[Gaze, tuple[float, float]]] = {
    Gaze.USER: (0.0, 0.0),
    Gaze.SLIGHTLY_AWAY: (-0.16, 0.0),
    Gaze.DOWN: (0.0, -0.22),
}


@dataclass(frozen=True, slots=True)
class ExpressionState:
    """§9's dataclass, verbatim.

    Units:

    * ``intensity`` 0–1, how far the curated template is pushed.
    * ``head_yaw`` / ``head_pitch`` / ``head_roll`` in **degrees**, clamped by
      :mod:`app.expression.interpolator` to the §70 card limits before any of
      it reaches an engine. The numbers below are already inside those limits;
      the clamp exists because ``intensity`` scaling and idle motion are added
      on top at runtime.
    * ``eye_open`` is a multiplier around 1.0 (``1.08`` = slightly widened).
    * ``blink_rate`` in blinks per second (0.20 ≈ one blink every five seconds).
    * ``gaze_x`` / ``gaze_y`` normalised, positive = right / up.
    * ``motion_energy`` 0–1, scales idle micro-motion amplitude.
    """

    name: str
    intensity: float
    head_yaw: float = 0.0
    head_pitch: float = 0.0
    head_roll: float = 0.0
    eye_open: float = 1.0
    blink_rate: float = 0.2
    gaze_x: float = 0.0
    gaze_y: float = 0.0
    motion_energy: float = 0.5

    def scaled(self, intensity: float) -> ExpressionState:
        """Re-render this preset at a different intensity.

        Only the parts that *read* as emotional strength move: pose deflection,
        eyelid aperture and motion energy. ``blink_rate`` deliberately does not
        scale linearly with intensity — a preset's blink rate is a
        characterisation choice (an angry person blinks *less*), and scaling it
        would erase the distinction the presets exist to encode.
        """
        factor = max(0.0, min(1.0, intensity)) / max(1e-6, self.intensity)
        factor = max(0.0, min(2.0, factor))
        return replace(
            self,
            intensity=max(0.0, min(1.0, intensity)),
            head_yaw=self.head_yaw * factor,
            head_pitch=self.head_pitch * factor,
            head_roll=self.head_roll * factor,
            eye_open=1.0 + (self.eye_open - 1.0) * factor,
            gaze_x=self.gaze_x * factor,
            gaze_y=self.gaze_y * factor,
            motion_energy=max(0.0, min(1.0, self.motion_energy * (0.6 + 0.4 * factor))),
        )

    def with_gaze(self, gaze: Gaze) -> ExpressionState:
        """Apply a §70 named gaze direction on top of the preset."""
        dx, dy = GAZE_OFFSETS[gaze]
        return replace(
            self,
            gaze_x=max(-1.0, min(1.0, self.gaze_x + dx)),
            gaze_y=max(-1.0, min(1.0, self.gaze_y + dy)),
        )


# ---------------------------------------------------------------------------
# §10 presets
# ---------------------------------------------------------------------------

#: §10 verbatim for the eight it defines; the four §69-second-version additions
#: are interpolated from their neighbours and marked P1.
PRESETS: Final[dict[ExpressionName, ExpressionState]] = {
    ExpressionName.NEUTRAL: ExpressionState(
        name="neutral",
        intensity=0.20,
        head_yaw=0.0,
        head_pitch=0.0,
        head_roll=0.0,
        eye_open=1.0,
        blink_rate=0.20,
        motion_energy=0.35,
    ),
    ExpressionName.LISTENING: ExpressionState(
        name="listening",
        intensity=0.30,
        head_pitch=-1.0,
        eye_open=1.02,
        blink_rate=0.18,
        motion_energy=0.35,
    ),
    ExpressionName.SKEPTICAL: ExpressionState(
        name="skeptical",
        intensity=0.65,
        head_yaw=3.0,
        head_roll=-2.0,
        eye_open=0.91,
        blink_rate=0.15,
        motion_energy=0.40,
    ),
    ExpressionName.CONCERNED: ExpressionState(
        name="concerned",
        intensity=0.55,
        head_pitch=2.0,
        eye_open=1.03,
        blink_rate=0.22,
        motion_energy=0.32,
    ),
    ExpressionName.FRUSTRATED: ExpressionState(
        name="frustrated",
        intensity=0.75,
        head_pitch=3.0,
        eye_open=0.88,
        blink_rate=0.12,
        motion_energy=0.55,
    ),
    ExpressionName.ANGRY: ExpressionState(
        name="angry",
        intensity=0.85,
        head_pitch=2.0,
        eye_open=0.86,
        blink_rate=0.10,
        motion_energy=0.75,
    ),
    ExpressionName.INTERESTED: ExpressionState(
        name="interested",
        intensity=0.60,
        head_pitch=-2.0,
        eye_open=1.08,
        blink_rate=0.18,
        motion_energy=0.45,
    ),
    ExpressionName.THINKING: ExpressionState(
        name="thinking",
        intensity=0.45,
        head_yaw=-3.0,
        gaze_x=-0.18,
        eye_open=0.96,
        blink_rate=0.20,
        motion_energy=0.25,
    ),
    # --- second version (§69) ---
    ExpressionName.CONFUSED: ExpressionState(
        name="confused",
        intensity=0.50,
        head_yaw=-2.0,
        head_roll=2.5,
        eye_open=0.98,
        blink_rate=0.24,
        gaze_x=-0.10,
        motion_energy=0.35,
    ),
    ExpressionName.SATISFIED: ExpressionState(
        name="satisfied",
        intensity=0.45,
        head_pitch=-1.0,
        eye_open=1.04,
        blink_rate=0.20,
        motion_energy=0.38,
    ),
    ExpressionName.READY: ExpressionState(
        name="ready",
        intensity=0.40,
        head_pitch=-1.5,
        eye_open=1.05,
        blink_rate=0.19,
        motion_energy=0.42,
    ),
    ExpressionName.DISENGAGED: ExpressionState(
        name="disengaged",
        intensity=0.35,
        head_yaw=-4.0,
        head_pitch=1.5,
        eye_open=0.94,
        blink_rate=0.26,
        gaze_x=-0.20,
        gaze_y=-0.10,
        motion_energy=0.18,
    ),
}

#: §69 — the six the first version ships.
P0_EXPRESSIONS: Final[tuple[ExpressionName, ...]] = (
    ExpressionName.NEUTRAL,
    ExpressionName.LISTENING,
    ExpressionName.SKEPTICAL,
    ExpressionName.CONCERNED,
    ExpressionName.FRUSTRATED,
    ExpressionName.INTERESTED,
)

PRIORITY: Final[dict[ExpressionName, Priority]] = {
    name: (Priority.P0 if name in P0_EXPRESSIONS else Priority.P1) for name in ExpressionName
}


def preset(name: ExpressionName | str) -> ExpressionState:
    """Look up a preset by name. Raises ``KeyError`` for an unknown name."""
    key = ExpressionName(name) if not isinstance(name, ExpressionName) else name
    return PRESETS[key]


def is_p0(name: ExpressionName) -> bool:
    return PRIORITY[name] is Priority.P0


def available_presets(built: frozenset[ExpressionName] | None = None) -> dict[
    ExpressionName, ExpressionState
]:
    """The presets a deployment can actually render.

    ``built`` is the set of expressions for which motion templates / loops
    exist (from :mod:`app.expression.state_bank`). ``None`` means "everything",
    which is the right answer for continuous mode (§3.2) where no pre-built
    loop is required.
    """
    if built is None:
        return dict(PRESETS)
    return {name: state for name, state in PRESETS.items() if name in built}


def nearest_available(
    wanted: ExpressionName,
    built: frozenset[ExpressionName],
) -> ExpressionName:
    """Substitute the closest built expression for one that was not built.

    The fallback chains walk toward calmer, lower-intensity states, never
    toward stronger ones: showing ``neutral`` when ``angry`` was not built is a
    missed beat, showing ``angry`` when ``concerned`` was not built would be a
    lie about the simulation state.
    """
    if wanted in built:
        return wanted
    for candidate in _SUBSTITUTIONS.get(wanted, ()):
        if candidate in built:
            return candidate
    if ExpressionName.NEUTRAL in built:
        return ExpressionName.NEUTRAL
    # A bank with nothing in it cannot be selected from; the caller is expected
    # to be in continuous or static mode, where every preset is renderable.
    return wanted


_SUBSTITUTIONS: Final[dict[ExpressionName, tuple[ExpressionName, ...]]] = {
    ExpressionName.ANGRY: (ExpressionName.FRUSTRATED, ExpressionName.SKEPTICAL),
    ExpressionName.FRUSTRATED: (ExpressionName.SKEPTICAL, ExpressionName.CONCERNED),
    ExpressionName.SKEPTICAL: (ExpressionName.CONCERNED, ExpressionName.NEUTRAL),
    ExpressionName.CONCERNED: (ExpressionName.NEUTRAL,),
    ExpressionName.INTERESTED: (ExpressionName.LISTENING, ExpressionName.NEUTRAL),
    ExpressionName.SATISFIED: (ExpressionName.INTERESTED, ExpressionName.NEUTRAL),
    ExpressionName.READY: (ExpressionName.INTERESTED, ExpressionName.LISTENING),
    ExpressionName.THINKING: (ExpressionName.LISTENING, ExpressionName.NEUTRAL),
    ExpressionName.CONFUSED: (ExpressionName.CONCERNED, ExpressionName.LISTENING),
    ExpressionName.DISENGAGED: (ExpressionName.NEUTRAL, ExpressionName.LISTENING),
    ExpressionName.LISTENING: (ExpressionName.NEUTRAL,),
}


__all__ = [
    "GAZE_OFFSETS",
    "P0_EXPRESSIONS",
    "PRESETS",
    "PRIORITY",
    "ExpressionName",
    "ExpressionState",
    "Gaze",
    "Priority",
    "available_presets",
    "is_p0",
    "nearest_available",
    "preset",
]
