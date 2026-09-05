"""Audio features for lip sync (§16, §18, §19).

MuseTalk is conditioned on Whisper-style features, so the runtime has to turn a
stream of TTS PCM into log-mel frames on the same cadence as the video. §16
fixes the input side (mono, 16 kHz, float32 — normalised by
:mod:`app.core.jitter_buffer`); this module is the transform.

Implemented in numpy on purpose. The alternative — pulling in torch or
torchaudio just to compute a mel spectrogram — would put a multi-gigabyte
dependency in front of the §53 floor, and a mel filterbank is fifty lines. It
also means the audio→frame alignment, which is the part that actually decides
whether lip sync looks right, is unit-testable with nothing installed.

Whisper's parameters, which the MuseTalk 1.5 checkpoints expect::

    sample rate  16000        n_fft   400 (25ms)
    hop length   160 (10ms)   n_mels  80

10ms hops against 40ms video frames (§17) means **4 feature frames per video
frame**, which is also why §19's micro-batches are 4/8/16 frames: they line up
exactly with 160ms / 320ms / 640ms of audio.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Final

import numpy as np

from app.core.jitter_buffer import FEATURE_SAMPLE_RATE

N_FFT: Final[int] = 400
HOP_LENGTH: Final[int] = 160
N_MELS: Final[int] = 80
#: Whisper clamps the log-mel dynamic range to 8 dB below the maximum.
DYNAMIC_RANGE_DB: Final[float] = 8.0

#: 10ms hop against a 40ms video frame.
FEATURE_FRAMES_PER_VIDEO_FRAME: Final[int] = 4


def hz_to_mel(hz: np.ndarray | float) -> np.ndarray:
    """Slaney mel scale, as used by Whisper's filterbank."""
    hz = np.asarray(hz, dtype=np.float64)
    linear_max = 1000.0 / (200.0 / 3.0)
    mel = hz / (200.0 / 3.0)
    log_region = hz >= 1000.0
    step = np.log(6.4) / 27.0
    mel = np.where(log_region, linear_max + np.log(np.maximum(hz, 1e-9) / 1000.0) / step, mel)
    return mel


def mel_to_hz(mel: np.ndarray) -> np.ndarray:
    mel = np.asarray(mel, dtype=np.float64)
    linear_max = 1000.0 / (200.0 / 3.0)
    hz = mel * (200.0 / 3.0)
    log_region = mel >= linear_max
    step = np.log(6.4) / 27.0
    return np.where(log_region, 1000.0 * np.exp(step * (mel - linear_max)), hz)


@lru_cache(maxsize=4)
def mel_filterbank(
    sample_rate: int = FEATURE_SAMPLE_RATE,
    n_fft: int = N_FFT,
    n_mels: int = N_MELS,
) -> np.ndarray:
    """``(n_mels, n_fft//2 + 1)`` triangular filterbank, area-normalised.

    Cached: it depends only on constants, and rebuilding it per chunk would
    dominate the cost of the transform.
    """
    fft_freqs = np.linspace(0.0, sample_rate / 2.0, n_fft // 2 + 1)
    mel_min, mel_max = hz_to_mel(0.0), hz_to_mel(sample_rate / 2.0)
    mel_points = np.linspace(float(mel_min), float(mel_max), n_mels + 2)
    hz_points = mel_to_hz(mel_points)

    filters = np.zeros((n_mels, fft_freqs.size), dtype=np.float64)
    for index in range(n_mels):
        low, centre, high = hz_points[index], hz_points[index + 1], hz_points[index + 2]
        rising = (fft_freqs - low) / max(centre - low, 1e-9)
        falling = (high - fft_freqs) / max(high - centre, 1e-9)
        filters[index] = np.maximum(0.0, np.minimum(rising, falling))
    # Slaney normalisation: equal area per filter, so loud low frequencies do
    # not dominate the representation.
    enorm = 2.0 / np.maximum(hz_points[2 : n_mels + 2] - hz_points[:n_mels], 1e-9)
    return (filters * enorm[:, None]).astype(np.float32)


def _frame_signal(samples: np.ndarray, n_fft: int, hop: int) -> np.ndarray:
    """Reflection-padded framing, matching Whisper's ``center=True`` STFT."""
    if samples.size == 0:
        return np.zeros((0, n_fft), dtype=np.float32)
    pad = n_fft // 2
    padded = np.pad(samples, (pad, pad), mode="reflect" if samples.size > pad else "constant")
    count = 1 + max(0, (padded.size - n_fft) // hop)
    if count <= 0:
        return np.zeros((0, n_fft), dtype=np.float32)
    indices = np.arange(n_fft)[None, :] + hop * np.arange(count)[:, None]
    return padded[indices].astype(np.float32)


def log_mel_spectrogram(
    samples: np.ndarray,
    *,
    sample_rate: int = FEATURE_SAMPLE_RATE,
    n_fft: int = N_FFT,
    hop: int = HOP_LENGTH,
    n_mels: int = N_MELS,
) -> np.ndarray:
    """``(n_frames, n_mels)`` log-mel features in Whisper's normalisation.

    Silence produces a valid, finite, constant feature block rather than
    ``-inf``: the lip-sync engine must be able to run on a pause without
    producing NaNs that would propagate into the mouth region.
    """
    if samples.ndim != 1:
        samples = np.asarray(samples).reshape(-1)
    frames = _frame_signal(samples.astype(np.float32), n_fft, hop)
    if frames.shape[0] == 0:
        return np.zeros((0, n_mels), dtype=np.float32)

    window = np.hanning(n_fft + 1)[:-1].astype(np.float32)
    spectrum = np.fft.rfft(frames * window, n=n_fft, axis=1)
    power = (spectrum.real**2 + spectrum.imag**2).astype(np.float32)

    mel = power @ mel_filterbank(sample_rate, n_fft, n_mels).T
    log_spec = np.log10(np.maximum(mel, 1e-10))
    # Whisper's clamp + affine normalisation to roughly [-1, 1].
    log_spec = np.maximum(log_spec, log_spec.max() - DYNAMIC_RANGE_DB)
    return ((log_spec + 4.0) / 4.0).astype(np.float32)


@dataclass(frozen=True, slots=True)
class AudioFeatureWindow:
    """Features for one §19 micro-batch of video frames."""

    #: ``(video_frames * FEATURE_FRAMES_PER_VIDEO_FRAME, n_mels)``
    features: np.ndarray
    video_frames: int
    start_frame_index: int
    #: RMS per video frame — the static backend's mouth driver, and a cheap
    #: voice-activity signal for §15 barge-in detection upstream.
    rms: np.ndarray

    @property
    def is_silent(self) -> bool:
        return bool(self.rms.max(initial=0.0) < 1e-4)


def frame_rms(samples: np.ndarray, video_frames: int) -> np.ndarray:
    """Per-video-frame RMS of a chunk. Always returns ``video_frames`` values."""
    if video_frames <= 0:
        return np.zeros(0, dtype=np.float32)
    if samples.size == 0:
        return np.zeros(video_frames, dtype=np.float32)
    per_frame = max(1, samples.size // video_frames)
    usable = per_frame * video_frames
    block = samples[:usable].reshape(video_frames, per_frame).astype(np.float64)
    return np.sqrt(np.mean(np.square(block), axis=1)).astype(np.float32)


def extract_window(
    samples: np.ndarray,
    *,
    video_frames: int,
    start_frame_index: int = 0,
    sample_rate: int = FEATURE_SAMPLE_RATE,
) -> AudioFeatureWindow:
    """Turn one micro-batch of audio into features aligned to video frames.

    The feature count is trimmed or zero-padded to exactly
    ``video_frames * 4``. Handing the engine a ragged window is how lip sync
    accumulates a frame of lag per batch until it is visibly behind — the
    alignment has to be exact, every batch, or not at all.
    """
    features = log_mel_spectrogram(samples, sample_rate=sample_rate)
    wanted = video_frames * FEATURE_FRAMES_PER_VIDEO_FRAME
    if features.shape[0] > wanted:
        features = features[:wanted]
    elif features.shape[0] < wanted:
        pad = np.zeros((wanted - features.shape[0], features.shape[1]), dtype=np.float32)
        features = np.vstack([features, pad]) if features.size else pad
    return AudioFeatureWindow(
        features=features,
        video_frames=video_frames,
        start_frame_index=start_frame_index,
        rms=frame_rms(samples, video_frames),
    )


def samples_per_video_frame(fps: int, sample_rate: int = FEATURE_SAMPLE_RATE) -> int:
    """640 samples at 25fps / 16 kHz — §17's 40ms frame."""
    if fps <= 0:
        msg = f"fps must be positive, got {fps}"
        raise ValueError(msg)
    return int(round(sample_rate / float(fps)))


__all__ = [
    "DYNAMIC_RANGE_DB",
    "FEATURE_FRAMES_PER_VIDEO_FRAME",
    "HOP_LENGTH",
    "N_FFT",
    "N_MELS",
    "AudioFeatureWindow",
    "extract_window",
    "frame_rms",
    "hz_to_mel",
    "log_mel_spectrogram",
    "mel_filterbank",
    "mel_to_hz",
    "samples_per_video_frame",
]
