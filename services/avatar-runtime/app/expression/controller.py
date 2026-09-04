"""Expression controller — hysteresis and transition timing (§12, §9, §47).

§12 forbids ``neutral → 1 frame → angry`` and prescribes:

===========================  ==========
normal emotion transition    350–700ms
strong interruption          180–350ms
recovery to neutral          500–1200ms
===========================  ==========

and hysteresis, with skeptical as the worked example: **enter at resistance
≥ 65, exit only at ≤ 52**.

Why hysteresis is not optional
------------------------------
The persona scalars come from an LLM. They do not glide; they hop — 64, 66, 63,
67 across four turns is completely ordinary output. A single threshold turns
that into four expression changes in twelve seconds, and a face that changes its
mind four times reads as broken, not as skeptical. The enter/exit band means the
face commits: once it is skeptical it stays skeptical until resistance genuinely
recedes to 52, and the trainee gets a stable signal they can respond to (§84 —
the point of the whole feature is that the trainee *perceives* the reaction).

The bands themselves live in :mod:`app.expression.mapper` next to the §13 ladder
they belong to. This module owns the memory: which rule is currently active, how
long it has been active, and how fast to move to the next one.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from app.expression.interpolator import ExpressionInterpolator, RenderPose
from app.expression.mapper import (
    RULE_BY_STATE,
    RULES,
    PersonaMetrics,
    PersonaSnapshot,
    expression_intensity,
    target_expression_state,
)
from app.expression.presets import ExpressionName, ExpressionState, nearest_available, preset

# --- §12 transition durations ---------------------------------------------

NORMAL_MIN_MS: Final[float] = 350.0
NORMAL_MAX_MS: Final[float] = 700.0
STRONG_MIN_MS: Final[float] = 180.0
STRONG_MAX_MS: Final[float] = 350.0
RECOVERY_MIN_MS: Final[float] = 500.0
RECOVERY_MAX_MS: Final[float] = 1200.0

#: A state must be held at least this long before anything but a strong
#: interruption may replace it. Below ~400ms the transition itself has not
#: finished, so a change would be visible as a stutter rather than a reaction.
MIN_DWELL_MS: Final[float] = 400.0

#: Expressions whose *arrival* is a strong interruption (§12): the customer
#: reacting sharply to something the trainee just said.
STRONG_TARGETS: Final[frozenset[ExpressionName]] = frozenset(
    {ExpressionName.ANGRY, ExpressionName.FRUSTRATED}
)

#: Expressions that count as "back to calm" for the recovery timing.
CALM_TARGETS: Final[frozenset[ExpressionName]] = frozenset(
    {ExpressionName.NEUTRAL, ExpressionName.LISTENING, ExpressionName.SATISFIED}
)


class TransitionKind(StrEnum):
    """Which §12 duration band a change falls into."""

    NORMAL = "normal"
    STRONG = "strong"
    RECOVERY = "recovery"


@dataclass(frozen=True, slots=True)
class ExpressionTransition:
    """One accepted expression change — the payload of ``avatar.expression.transition``."""

    from_state: ExpressionName
    to_state: ExpressionName
    kind: TransitionKind
    duration_ms: float
    intensity: float
    at_s: float


def transition_duration_ms(
    from_state: ExpressionName,
    to_state: ExpressionName,
    *,
    intensity: float,
    strong: bool = False,
) -> tuple[TransitionKind, float]:
    """Pick a §12-legal duration for a change.

    Within each band, higher intensity means *faster*: a customer becoming
    strongly frustrated snaps, a customer becoming mildly skeptical drifts.
    Recovery is the exception — coming back to neutral is always the slowest
    move a face makes, and rushing it makes the persona look like a switch.
    """
    intensity = max(0.0, min(1.0, intensity))
    if strong or to_state in STRONG_TARGETS:
        kind = TransitionKind.STRONG
        low, high = STRONG_MIN_MS, STRONG_MAX_MS
    elif to_state in CALM_TARGETS and from_state not in CALM_TARGETS:
        kind = TransitionKind.RECOVERY
        low, high = RECOVERY_MIN_MS, RECOVERY_MAX_MS
        # Recovery from a strong state takes longer, not less.
        weight = 1.0 - intensity if from_state in STRONG_TARGETS else 0.5
        return kind, low + (high - low) * (1.0 - max(0.0, min(1.0, weight)))
    else:
        kind = TransitionKind.NORMAL
        low, high = NORMAL_MIN_MS, NORMAL_MAX_MS
    return kind, high - (high - low) * intensity


class ExpressionController:
    """The §12 state machine over the §13 ladder.

    One instance per session. It owns:

    * the currently active :class:`~app.expression.mapper.ExpressionRule`,
    * the dwell timer that stops a rule being replaced the instant it is entered,
    * an :class:`~app.expression.interpolator.ExpressionInterpolator` that
      executes the chosen duration and adds blinks and idle motion.
    """

    __slots__ = (
        "_available",
        "_entered_at_s",
        "_last_transition",
        "_snapshot",
        "_state",
        "interpolator",
    )

    def __init__(
        self,
        *,
        available: frozenset[ExpressionName] | None = None,
        initial: ExpressionName = ExpressionName.NEUTRAL,
        now_s: float = 0.0,
        seed: int | None = None,
    ) -> None:
        #: Expressions this avatar can actually render (§21 bank contents).
        #: ``None`` = every preset, which is right for continuous and static modes.
        self._available = available
        self._state = self._resolve(initial)
        self._entered_at_s = now_s
        self._snapshot = PersonaSnapshot()
        self._last_transition: ExpressionTransition | None = None
        self.interpolator = ExpressionInterpolator(preset(self._state), seed=seed)

    # -- introspection -----------------------------------------------------

    @property
    def state(self) -> ExpressionName:
        return self._state

    @property
    def snapshot(self) -> PersonaSnapshot:
        return self._snapshot

    @property
    def last_transition(self) -> ExpressionTransition | None:
        return self._last_transition

    def _resolve(self, wanted: ExpressionName) -> ExpressionName:
        if self._available is None:
            return wanted
        return nearest_available(wanted, self._available)

    def set_available(self, available: frozenset[ExpressionName] | None) -> None:
        """Adopt the bank's contents once it is loaded (§21)."""
        self._available = available
        resolved = self._resolve(self._state)
        if resolved != self._state:
            self._state = resolved

    # -- the decision ------------------------------------------------------

    def _select(self, metrics: PersonaMetrics, now_s: float) -> ExpressionName:
        """Highest-priority *entered* rule, unless the current one still holds.

        Two guards keep the face still:

        1. **Hold.** If the active rule's exit band has not been crossed, it
           keeps the face — even when a lower-priority rule would now be
           entered. This is §12's hysteresis.
        2. **Dwell.** A rule that was entered less than :data:`MIN_DWELL_MS`
           ago is not replaced unless the replacement outranks it, so a
           genuinely escalating persona still gets an immediate reaction while
           a jittery one does not get a twitch.
        """
        current_rule = RULE_BY_STATE.get(self._state)
        candidate = next((rule for rule in RULES if rule.entered(metrics)), RULES[-1])

        if current_rule is None:
            return candidate.state

        if current_rule.held(metrics) and current_rule.priority <= candidate.priority:
            return self._state

        dwell_ms = (now_s - self._entered_at_s) * 1000.0
        if dwell_ms < MIN_DWELL_MS and candidate.priority >= current_rule.priority:
            return self._state

        return candidate.state

    def apply(self, state: PersonaSnapshot, *, now_s: float) -> ExpressionTransition | None:
        """Feed a new persona snapshot in. Returns the transition, if any.

        §47: this is called *before* the audio for the same turn starts, so the
        avatar visibly prepares to speak. The orchestrator enforces that
        ordering; the controller just has to be cheap enough that it can be.
        """
        self._snapshot = state
        metrics = PersonaMetrics.of(state)
        wanted = self._resolve(self._select(metrics, now_s))
        target = self._target_state(state, wanted)

        if wanted == self._state:
            # Same expression, possibly a different intensity — retarget
            # without restarting the dwell timer. A customer getting steadily
            # angrier while staying "frustrated" should visibly intensify.
            self.interpolator.set_target(
                target, now_s=now_s, duration_ms=NORMAL_MAX_MS, blink_on_change=False
            )
            return None

        intensity = expression_intensity(state, wanted)
        kind, duration = transition_duration_ms(self._state, wanted, intensity=intensity)
        previous = self._state
        self._state = wanted
        self._entered_at_s = now_s
        self.interpolator.set_target(
            target,
            now_s=now_s,
            duration_ms=duration,
            blink_on_change=kind is TransitionKind.STRONG,
        )
        transition = ExpressionTransition(
            from_state=previous,
            to_state=wanted,
            kind=kind,
            duration_ms=duration,
            intensity=intensity,
            at_s=now_s,
        )
        self._last_transition = transition
        return transition

    def _target_state(self, state: PersonaSnapshot, wanted: ExpressionName) -> ExpressionState:
        return target_expression_state(state, wanted)

    # -- direct control ----------------------------------------------------

    def force(
        self,
        wanted: ExpressionName,
        *,
        now_s: float,
        kind: TransitionKind = TransitionKind.STRONG,
        intensity: float | None = None,
    ) -> ExpressionTransition:
        """Bypass the ladder. Used by §15 barge-in, which must return the face
        to ``listening`` immediately regardless of what the scalars say."""
        resolved = self._resolve(wanted)
        base = preset(resolved)
        level = intensity if intensity is not None else base.intensity
        _, duration = transition_duration_ms(
            self._state,
            resolved,
            intensity=level,
            strong=kind is TransitionKind.STRONG,
        )
        if kind is TransitionKind.RECOVERY:
            duration = RECOVERY_MIN_MS
        previous = self._state
        self._state = resolved
        self._entered_at_s = now_s
        self.interpolator.set_target(
            base.scaled(level),
            now_s=now_s,
            duration_ms=duration,
            blink_on_change=kind is TransitionKind.STRONG,
        )
        transition = ExpressionTransition(
            from_state=previous,
            to_state=resolved,
            kind=kind,
            duration_ms=duration,
            intensity=level,
            at_s=now_s,
        )
        self._last_transition = transition
        return transition

    def sample(self, now_s: float) -> RenderPose:
        """The §70-clamped pose for this frame."""
        return self.interpolator.sample(now_s)


__all__ = [
    "CALM_TARGETS",
    "MIN_DWELL_MS",
    "NORMAL_MAX_MS",
    "NORMAL_MIN_MS",
    "RECOVERY_MAX_MS",
    "RECOVERY_MIN_MS",
    "STRONG_MAX_MS",
    "STRONG_MIN_MS",
    "STRONG_TARGETS",
    "ExpressionController",
    "ExpressionTransition",
    "TransitionKind",
    "transition_duration_ms",
]
