"""Streaming TTS jitter buffer (§18) and the §16 audio contract.

§16 fixes the format the lip-sync path consumes: **mono, 16 kHz, float32**. TTS
providers emit 24 / 44.1 / 48 kHz, mono or stereo, int16 or float32, in chunks
whose size nobody controls (§48 — the runtime is not bound to any one vendor).
Everything is normalised here, once, at the door.

§18 fixes the buffering policy: **target 250–500ms**. Below the target the
avatar must not start speaking, or the first phoneme arrives before the audio
that justifies it. Above the ceiling the buffer is holding latency that will
never be repaid, so the oldest audio is discarded.

The rule that matters most is the one about underrun: when the buffer runs dry
mid-utterance the buffer returns **silence of the exact length requested** and
counts an underrun. It does not block, does not shorten the read, and does not
raise. A stall here would freeze the master clock (§17) and therefore the whole
render loop — the §53 principle applied to audio: keep producing, degrade the
content, never stop.

Only numpy is used, so all of this is unit-testable with no engine installed.
"""

from __future__ import annotations

import struct
from collections import deque
from typing import Final

import numpy as np

from app.core.errors import AudioFormatInvalidError

#: §16 — the MuseTalk feature path's one true rate.
FEATURE_SAMPLE_RATE: Final[int] = 16_000

#: §18 recommended target window.
MIN_TARGET_MS: Final[float] = 250.0
MAX_TARGET_MS: Final[float] = 500.0

#: Sample rates a TTS provider may plausibly hand us. Anything else is refused
#: rather than resampled blind: a wrong assumed rate produces lip sync that is
#: subtly, unfixably out of step.
SUPPORTED_RATES: Final[frozenset[int]] = frozenset({8000, 16000, 22050, 24000, 32000, 44100, 48000})


# ---------------------------------------------------------------------------
# §16 normalisation primitives
# ---------------------------------------------------------------------------


def pcm_to_float32(data: bytes | bytearray | memoryview, *, sample_format: str) -> np.ndarray:
    """Interleaved PCM bytes → float32 in [-1, 1].

    ``sample_format`` is one of ``s16``, ``s32``, ``f32``.
    """
    buffer = bytes(data)
    if sample_format == "s16":
        if len(buffer) % 2:
            raise AudioFormatInvalidError("s16 payload length is not a multiple of 2 bytes")
        return np.frombuffer(buffer, dtype="<i2").astype(np.float32) / 32768.0
    if sample_format == "s32":
        if len(buffer) % 4:
            raise AudioFormatInvalidError("s32 payload length is not a multiple of 4 bytes")
        return np.frombuffer(buffer, dtype="<i4").astype(np.float32) / 2147483648.0
    if sample_format == "f32":
        if len(buffer) % 4:
            raise AudioFormatInvalidError("f32 payload length is not a multiple of 4 bytes")
        return np.frombuffer(buffer, dtype="<f4").astype(np.float32, copy=True)
    raise AudioFormatInvalidError(f"unsupported sample format {sample_format!r}")


def to_mono(samples: np.ndarray, channels: int) -> np.ndarray:
    """Downmix interleaved audio to mono by averaging channels (§16)."""
    if channels < 1:
        raise AudioFormatInvalidError("channel count must be at least 1")
    if channels == 1:
        return samples.astype(np.float32, copy=False)
    if channels > 2:
        raise AudioFormatInvalidError(f"unsupported channel count {channels}")
    usable = (samples.size // channels) * channels
    if usable != samples.size:
        # A truncated final frame is a stream artefact, not a fatal error.
        samples = samples[:usable]
    return samples.reshape(-1, channels).mean(axis=1).astype(np.float32)


def resample_linear(samples: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    """Linear resample to ``dst_rate``.

    Linear interpolation, not a windowed-sinc: the consumer is a mel/Whisper
    feature extractor whose first operation is a heavily smoothing filterbank,
    so the aliasing that would be audible in playback is inaudible in the
    features — and this path has to run inside a 40ms frame budget. The *media*
    audio the browser plays is never resampled by us (§51); it is passed
    through at its original rate.
    """
    if src_rate == dst_rate or samples.size == 0:
        return samples.astype(np.float32, copy=False)
    if src_rate <= 0 or dst_rate <= 0:
        raise AudioFormatInvalidError("sample rates must be positive")
    duration = samples.size / float(src_rate)
    out_count = max(1, int(round(duration * dst_rate)))
    src_positions = np.arange(samples.size, dtype=np.float64)
    dst_positions = np.arange(out_count, dtype=np.float64) * (src_rate / float(dst_rate))
    return np.interp(dst_positions, src_positions, samples).astype(np.float32)


def decode_wav(data: bytes) -> tuple[np.ndarray, int, int]:
    """Parse a RIFF/WAVE container → ``(float32 samples, sample_rate, channels)``.

    Written by hand against the stdlib because ``wave`` refuses float32 WAVs,
    which is exactly what several TTS providers emit. Only the two formats that
    matter are accepted: PCM integer (1) and IEEE float (3).
    """
    if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise AudioFormatInvalidError("payload is not a RIFF/WAVE file")

    offset = 12
    fmt: tuple[int, int, int, int] | None = None
    while offset + 8 <= len(data):
        chunk_id = data[offset : offset + 4]
        (chunk_size,) = struct.unpack_from("<I", data, offset + 4)
        body = offset + 8
        if chunk_id == b"fmt " and chunk_size >= 16:
            audio_format, channels, sample_rate, _byte_rate, _align, bits = struct.unpack_from(
                "<HHIIHH", data, body
            )
            fmt = (audio_format, channels, sample_rate, bits)
        elif chunk_id == b"data":
            if fmt is None:
                raise AudioFormatInvalidError("WAVE data chunk appeared before fmt chunk")
            audio_format, channels, sample_rate, bits = fmt
            payload = data[body : body + chunk_size]
            if audio_format == 1 and bits == 16:
                samples = pcm_to_float32(payload, sample_format="s16")
            elif audio_format == 1 and bits == 32:
                samples = pcm_to_float32(payload, sample_format="s32")
            elif audio_format == 3 and bits == 32:
                samples = pcm_to_float32(payload, sample_format="f32")
            else:
                raise AudioFormatInvalidError(
                    f"unsupported WAVE encoding (format={audio_format}, bits={bits})"
                )
            if sample_rate not in SUPPORTED_RATES:
                raise AudioFormatInvalidError(f"unsupported sample rate {sample_rate}")
            return samples, sample_rate, channels
        offset = body + chunk_size + (chunk_size & 1)  # chunks are word-aligned
    raise AudioFormatInvalidError("WAVE file contains no data chunk")


# ---------------------------------------------------------------------------
# §18 jitter buffer
# ---------------------------------------------------------------------------


class AudioJitterBuffer:
    """Absorbs streaming-TTS chunk jitter and feeds fixed-size reads.

    Producer side: :meth:`push`, any rate / channel count / sample format.
    Consumer side: :meth:`pop_ms` / :meth:`pop_samples`, always exactly the
    requested length of mono 16 kHz float32.
    """

    __slots__ = (
        "_chunks",
        "_head_offset",
        "_queued",
        "_total_pushed",
        "max_ms",
        "sample_rate",
        "target_ms",
        "underruns",
        "overrun_dropped_samples",
        "overruns",
    )

    def __init__(
        self,
        *,
        target_ms: float = 320.0,
        max_ms: float = 1500.0,
        sample_rate: int = FEATURE_SAMPLE_RATE,
    ) -> None:
        if not MIN_TARGET_MS <= target_ms <= MAX_TARGET_MS:
            msg = (
                f"target_ms must be within the §18 window "
                f"[{MIN_TARGET_MS}, {MAX_TARGET_MS}], got {target_ms}"
            )
            raise ValueError(msg)
        if max_ms <= target_ms:
            msg = "max_ms must exceed target_ms or the buffer is permanently in overrun"
            raise ValueError(msg)
        self.target_ms = target_ms
        self.max_ms = max_ms
        self.sample_rate = sample_rate
        self._chunks: deque[np.ndarray] = deque()
        #: Read cursor into ``_chunks[0]``; avoids re-slicing a big array per read.
        self._head_offset = 0
        self._queued = 0
        self._total_pushed = 0
        self.underruns = 0
        self.overruns = 0
        self.overrun_dropped_samples = 0

    # -- introspection -----------------------------------------------------

    @property
    def queued_samples(self) -> int:
        return self._queued

    @property
    def buffered_ms(self) -> float:
        """Exported as ``audio_buffer_ms`` (§77)."""
        return 1000.0 * self._queued / float(self.sample_rate)

    @property
    def primed(self) -> bool:
        """True once §18's target has been reached — the cue to start speaking."""
        return self.buffered_ms >= self.target_ms

    @property
    def total_pushed_samples(self) -> int:
        return self._total_pushed

    def _ms_to_samples(self, milliseconds: float) -> int:
        return max(0, int(round(milliseconds * self.sample_rate / 1000.0)))

    # -- producer ----------------------------------------------------------

    def push(
        self,
        pcm: bytes | bytearray | memoryview | np.ndarray,
        *,
        sample_rate: int = FEATURE_SAMPLE_RATE,
        channels: int = 1,
        sample_format: str = "s16",
    ) -> int:
        """Normalise a TTS chunk to §16 form and enqueue it.

        Returns the number of 16 kHz mono samples added. Overrun trimming
        happens here, not on read, so latency never survives a single push.
        """
        if isinstance(pcm, np.ndarray):
            samples = pcm.astype(np.float32, copy=False).reshape(-1)
        else:
            samples = pcm_to_float32(pcm, sample_format=sample_format)
        if sample_rate not in SUPPORTED_RATES:
            raise AudioFormatInvalidError(f"unsupported sample rate {sample_rate}")

        mono = to_mono(samples, channels)
        resampled = resample_linear(mono, sample_rate, self.sample_rate)
        if resampled.size == 0:
            return 0

        self._chunks.append(resampled)
        self._queued += int(resampled.size)
        self._total_pushed += int(resampled.size)
        self._trim_overrun()
        return int(resampled.size)

    def _trim_overrun(self) -> None:
        """Discard the oldest audio once the buffer exceeds :attr:`max_ms`.

        Dropping the *oldest* is deliberate. The newest audio is the one the
        expression controller and the master clock are already aligned to;
        keeping stale audio would mean the mouth stays behind for the rest of
        the utterance instead of for a fraction of a second.
        """
        limit = self._ms_to_samples(self.max_ms)
        if self._queued <= limit:
            return
        self.overruns += 1
        excess = self._queued - limit
        self.overrun_dropped_samples += excess
        self._discard(excess)

    def _discard(self, count: int) -> None:
        remaining = count
        while remaining > 0 and self._chunks:
            head = self._chunks[0]
            available = head.size - self._head_offset
            if available > remaining:
                self._head_offset += remaining
                self._queued -= remaining
                return
            self._chunks.popleft()
            self._head_offset = 0
            self._queued -= available
            remaining -= available

    # -- consumer ----------------------------------------------------------

    def pop_samples(self, count: int) -> np.ndarray:
        """Read exactly ``count`` samples, zero-filling on underrun."""
        if count <= 0:
            return np.zeros(0, dtype=np.float32)
        out = np.zeros(count, dtype=np.float32)
        written = 0
        while written < count and self._chunks:
            head = self._chunks[0]
            available = head.size - self._head_offset
            take = min(available, count - written)
            out[written : written + take] = head[self._head_offset : self._head_offset + take]
            written += take
            self._head_offset += take
            self._queued -= take
            if self._head_offset >= head.size:
                self._chunks.popleft()
                self._head_offset = 0
        if written < count:
            # Silence, not a short read: the caller is a fixed-cadence frame
            # loop and a short read would desynchronise the master clock.
            self.underruns += 1
        return out

    def pop_ms(self, milliseconds: float) -> np.ndarray:
        """Read one frame's worth of audio — 40ms at 25fps (§17)."""
        return self.pop_samples(self._ms_to_samples(milliseconds))

    def peek_rms(self, milliseconds: float) -> float:
        """RMS of the next ``milliseconds`` without consuming them.

        The static-portrait backend drives mouth openness from this, which is
        how the §53 floor still looks like speech with no lip-sync engine.
        """
        count = self._ms_to_samples(milliseconds)
        if count <= 0 or self._queued == 0:
            return 0.0
        gathered: list[np.ndarray] = []
        needed = min(count, self._queued)
        offset = self._head_offset
        for chunk in self._chunks:
            if needed <= 0:
                break
            piece = chunk[offset : offset + needed]
            gathered.append(piece)
            needed -= piece.size
            offset = 0
        if not gathered:
            return 0.0
        window = np.concatenate(gathered)
        return float(np.sqrt(np.mean(np.square(window, dtype=np.float64))))

    # -- lifecycle ---------------------------------------------------------

    def flush(self) -> int:
        """Discard everything queued. §15 barge-in calls this.

        Returns the number of samples thrown away — the orchestrator reports it
        on ``avatar.interrupted`` so an operator can see how much speech the
        trainee actually cut off.
        """
        discarded = self._queued
        self._chunks.clear()
        self._head_offset = 0
        self._queued = 0
        return discarded

    def reset(self) -> None:
        """Flush and clear the counters."""
        self.flush()
        self.underruns = 0
        self.overruns = 0
        self.overrun_dropped_samples = 0
        self._total_pushed = 0


__all__ = [
    "FEATURE_SAMPLE_RATE",
    "MAX_TARGET_MS",
    "MIN_TARGET_MS",
    "SUPPORTED_RATES",
    "AudioJitterBuffer",
    "decode_wav",
    "pcm_to_float32",
    "resample_linear",
    "to_mono",
]
