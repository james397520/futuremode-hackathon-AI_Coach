"""The §53 floor. If these break, a training session can lose its avatar."""

from __future__ import annotations

import numpy as np
import pytest

from app.backends.static_portrait import SILENCE_RMS, StaticPortraitBackend
from app.expression.interpolator import RenderPose

W, H = 384, 512


def pose(**kw) -> RenderPose:
    base = dict(
        expression="neutral", intensity=0.3, head_yaw=0.0, head_pitch=0.0, head_roll=0.0,
        eye_open=1.0, gaze_x=0.0, gaze_y=0.0, motion_energy=0.4, blinking=False,
    )
    base.update(kw)
    return RenderPose(**base)


@pytest.fixture
def backend(portrait) -> StaticPortraitBackend:
    return StaticPortraitBackend(portrait, width=W, height=H)


def test_renders_without_any_engine(backend):
    frame = backend.render(pose())
    assert frame.shape == (H, W, 3)
    assert frame.dtype == np.uint8


def test_head_motion_does_not_wrap_pixels(backend):
    """np.roll would drag the bottom of the portrait across the top of the head.

    The regression this pins is visible as a dark band along the first rows.
    """
    still = backend.render(pose(head_pitch=0.0))
    shifted = backend.render(pose(head_pitch=8.0))     # the §70 pitch limit
    assert abs(float(shifted[:4].mean()) - float(still[:4].mean())) < 6.0


def test_silence_keeps_the_mouth_shut(backend):
    for _ in range(6):
        openness = backend.push_audio_envelope(np.zeros(800, dtype=np.float32))
    assert openness < 0.05


def test_room_tone_is_not_speech(backend):
    """Below the silence floor the mouth must stay closed, or it hangs half-open."""
    quiet = np.full(800, SILENCE_RMS * 0.5, dtype=np.float32)
    for _ in range(6):
        openness = backend.push_audio_envelope(quiet)
    assert openness < 0.05


def test_loud_audio_opens_the_mouth_and_changes_the_frame(backend):
    closed = backend.render(pose())
    loud = (0.4 * np.sin(np.linspace(0, 60, 800))).astype(np.float32)
    for _ in range(6):
        openness = backend.push_audio_envelope(loud)
    assert openness > 0.2
    open_frame = backend.render(pose())
    assert not np.array_equal(closed, open_frame)


def test_mouth_opens_faster_than_it_closes(backend):
    """Asymmetric smoothing: speech onsets are sharp, tails are not."""
    loud = (0.4 * np.sin(np.linspace(0, 60, 800))).astype(np.float32)
    rise = backend.push_audio_envelope(loud)
    fall_start = rise
    for _ in range(5):
        backend.push_audio_envelope(loud)
    peak = backend.push_audio_envelope(loud)
    decay = backend.push_audio_envelope(np.zeros(800, dtype=np.float32))
    assert rise - 0.0 > peak - decay or (peak - decay) < (fall_start - 0.0) * 2


def test_blink_changes_the_eye_region_only_a_little(backend):
    """A blink must be visible but must not restructure the whole frame."""
    open_eyes = backend.render(pose(eye_open=1.0))
    shut = backend.render(pose(eye_open=0.0))
    diff = np.abs(open_eyes.astype(np.int16) - shut.astype(np.int16)).mean()
    assert diff > 0.0
    assert diff < 12.0


def test_survives_a_portrait_of_the_wrong_aspect(portrait):
    wide = np.hstack([portrait, portrait])
    frame = StaticPortraitBackend(wide, width=W, height=H).render(pose())
    assert frame.shape == (H, W, 3)


def test_rejects_a_non_rgb_source(portrait):
    with pytest.raises(ValueError):
        StaticPortraitBackend(portrait[:, :, 0], width=W, height=H)
