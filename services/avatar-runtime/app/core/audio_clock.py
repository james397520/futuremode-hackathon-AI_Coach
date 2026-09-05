"""Audio PTS is the master clock (§17, §49, ADR-007).

The whole A/V sync policy is three sentences:

1. Audio presentation time is authoritative. It advances by exactly the number
   of samples handed to the media path, divided by the sample rate — never by
   wall time, because a stalled render loop must not be able to make the audio
   clock lie.
2. Every 1–2 seconds compare ``video_pts - audio_pts``.
3. If video is late, **drop the late frames** so the next frame rendered is the
   one that belongs *now*. Never render a backlog: a rendered backlog is
   accumulated latency, and accumulated latency is exactly what §17 forbids.

Target: ``|A/V drift| < 80ms``.

The subtle part is (3). The naive implementation renders every frame and simply
falls further behind, so drift grows without bound — the frames all get shown,
each one later than the last. :class:`AVSyncController` instead advances the
video frame index to the frame that matches the audio clock, reports how many
frames that skipped, and lets the caller count them as drops (§45
``avatar.frame.drop``). Drift after correction is bounded by one frame period.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from app.core.config import DEFAULT_FPS

#: §16 — the MuseTalk feature path is mono 16 kHz, always.
FEATURE_SAMPLE_RATE: Final[int] = 16_000

#: §17 — |A/V drift| target before correction kicks in.
DEFAULT_DRIFT_TARGET_MS: Final[float] = 80.0

#: §17 — "每 1–2 秒檢查". Checking more often than this chases jitter; less
#: often lets a real drift run for seconds before anyone notices.
DEFAULT_CHECK_INTERVAL_S: Final[float] = 1.0


class FrameDecision(StrEnum):
    """What the sync controller says to do with the next video frame."""

    RENDER = "render"
    #: Video is behind the audio clock: skip ahead instead of rendering late.
    DROP = "drop"
    #: Video is ahead of the audio clock: hold this frame until audio catches up.
    HOLD = "hold"


@dataclass(slots=True)
class SyncVerdict:
    """The result of one :meth:`AVSyncController.evaluate` call."""

    decision: FrameDecision
    #: ``video_pts - audio_pts`` in milliseconds, signed. Negative = video late.
    drift_ms: float
    #: How many frame slots were skipped to catch up. 0 unless ``decision`` is DROP.
    skipped: int = 0
    #: The frame index the caller should render next.
    next_index: int = 0


class AudioClock:
    """The master clock. Advances only when audio is actually consumed.

    ``sample_rate`` is the rate of the *media* audio (what the browser plays),
    which is not necessarily the 16 kHz feature rate — §16 keeps those two paths
    separate on purpose, and §51 recommends shipping the media audio down the
    same WebRTC stream so the browser never runs a second clock.
    """

    __slots__ = ("_samples", "sample_rate")

    def __init__(self, sample_rate: int = FEATURE_SAMPLE_RATE) -> None:
        if sample_rate <= 0:
            msg = f"sample_rate must be positive, got {sample_rate}"
            raise ValueError(msg)
        self.sample_rate = sample_rate
        self._samples = 0

    @property
    def samples(self) -> int:
        """Total samples presented since the clock started."""
        return self._samples

    @property
    def pts_s(self) -> float:
        """Audio presentation time in seconds."""
        return self._samples / float(self.sample_rate)

    @property
    def pts_ms(self) -> float:
        return 1000.0 * self.pts_s

    def advance_samples(self, count: int) -> float:
        """Present ``count`` samples. Returns the new PTS in seconds."""
        if count < 0:
            msg = "cannot un-present audio; the master clock is monotonic"
            raise ValueError(msg)
        self._samples += count
        return self.pts_s

    def advance_ms(self, milliseconds: float) -> float:
        """Present ``milliseconds`` of audio (rounded to whole samples)."""
        return self.advance_samples(int(round(milliseconds * self.sample_rate / 1000.0)))

    def reset(self) -> None:
        """Restart at zero. Used on §15 barge-in, where the pending audio is
        discarded and the clock must not keep the cancelled speech's position."""
        self._samples = 0


class AVSyncController:
    """Keeps the video frame index locked to :class:`AudioClock`.

    Usage per frame::

        verdict = sync.evaluate(frame_index, audio_clock.pts_s)
        if verdict.decision is FrameDecision.DROP:
            metrics.FRAME_DROP_TOTAL.labels("late").inc(verdict.skipped)
        frame_index = verdict.next_index
    """

    __slots__ = (
        "_checked_at_s",
        "_drift_ms",
        "_last_decision",
        "check_interval_s",
        "drift_target_ms",
        "fps",
    )

    def __init__(
        self,
        fps: int = DEFAULT_FPS,
        *,
        drift_target_ms: float = DEFAULT_DRIFT_TARGET_MS,
        check_interval_s: float = DEFAULT_CHECK_INTERVAL_S,
    ) -> None:
        if fps <= 0:
            msg = f"fps must be positive, got {fps}"
            raise ValueError(msg)
        self.fps = fps
        self.drift_target_ms = drift_target_ms
        self.check_interval_s = check_interval_s
        self._drift_ms = 0.0
        self._checked_at_s = 0.0
        self._last_decision = FrameDecision.RENDER

    # -- derived -----------------------------------------------------------

    @property
    def frame_period_s(self) -> float:
        """§17 — 1/25 = 40ms."""
        return 1.0 / float(self.fps)

    @property
    def av_drift_ms(self) -> float:
        """Last measured ``video_pts - audio_pts``, exported as ``av_drift_ms`` (§77)."""
        return self._drift_ms

    def pts_for(self, frame_index: int) -> float:
        """§17 — ``frame_pts = frame_index / fps``."""
        return frame_index / float(self.fps)

    def index_for(self, audio_pts_s: float) -> int:
        """The frame index whose PTS is at or just before ``audio_pts_s``."""
        return max(0, int(audio_pts_s * self.fps))

    # -- the decision ------------------------------------------------------

    def evaluate(self, frame_index: int, audio_pts_s: float) -> SyncVerdict:
        """Decide what to do with the frame at ``frame_index``.

        Drift is measured on every call (it is two subtractions), but a
        *correction* is only applied on the §17 cadence — otherwise ordinary
        per-frame jitter would make the video index jump around and the motion
        would stutter far more visibly than an 80ms lag ever does.
        """
        video_pts = self.pts_for(frame_index)
        self._drift_ms = 1000.0 * (video_pts - audio_pts_s)

        due = (audio_pts_s - self._checked_at_s) >= self.check_interval_s
        if not due:
            self._last_decision = FrameDecision.RENDER
            return SyncVerdict(FrameDecision.RENDER, self._drift_ms, 0, frame_index)

        self._checked_at_s = audio_pts_s

        if self._drift_ms < -self.drift_target_ms:
            # Video is late. Jump to the frame that belongs to *now* and report
            # everything in between as dropped. This is the §17/§49 rule: drop
            # late frames rather than accumulate latency.
            target = self.index_for(audio_pts_s)
            skipped = max(0, target - frame_index)
            self._drift_ms = 1000.0 * (self.pts_for(target) - audio_pts_s)
            self._last_decision = FrameDecision.DROP
            return SyncVerdict(FrameDecision.DROP, self._drift_ms, skipped, target)

        if self._drift_ms > self.drift_target_ms:
            # Video is ahead. Holding costs nothing and never loses content;
            # the frame index is not advanced, so the renderer simply repeats.
            self._last_decision = FrameDecision.HOLD
            return SyncVerdict(FrameDecision.HOLD, self._drift_ms, 0, frame_index)

        self._last_decision = FrameDecision.RENDER
        return SyncVerdict(FrameDecision.RENDER, self._drift_ms, 0, frame_index)

    @property
    def in_target(self) -> bool:
        """True while ``|drift| < drift_target_ms`` (§17's acceptance criterion)."""
        return abs(self._drift_ms) < self.drift_target_ms

    def reset(self) -> None:
        """Forget drift history. Called on barge-in and on session restart."""
        self._drift_ms = 0.0
        self._checked_at_s = 0.0
        self._last_decision = FrameDecision.RENDER


__all__ = [
    "DEFAULT_CHECK_INTERVAL_S",
    "DEFAULT_DRIFT_TARGET_MS",
    "FEATURE_SAMPLE_RATE",
    "AVSyncController",
    "AudioClock",
    "FrameDecision",
    "SyncVerdict",
]
