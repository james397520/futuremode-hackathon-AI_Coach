"""What every engine shares: text normalisation, sentence splitting, stats, PCM.

The service is deliberately engine-agnostic above this line. Two models with
different alphabets (Kokoro's IPA-ish phonemes, Breeze's 注音符號) and different
sample rates (24 kHz / 22.05 kHz) still get the same insurance-copy
normalisation, the same sentence and clause splitting, the same inter-sentence
silence and the same log/response fields.
"""

from __future__ import annotations

import re
import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

import numpy as np

#: Silence appended after each chunk, in seconds. Converted to samples by the
#: engine, which is the only thing that knows its own sample rate.
GAP_S = 0.18

_SENTENCE_END = re.compile(r"(?<=[。！？!?；;…\n])")
_CLAUSE_END = re.compile(r"(?<=[，,、：:])")
_THOUSANDS = re.compile(r"(?<=\d),(?=\d{3}\b)")
_CURRENCY = re.compile(r"(?:NT\$|NTD|TWD)\s*")


def normalize(text: str) -> str:
    """The few things a Chinese number reader gets wrong on insurance copy.

    "1,200" is read as 一，二百 unless the separator goes; "NT$" is an unknown
    symbol (dropped silently). Everything else — plain numbers, %, dates — is
    left to cn2an, inside misaki for Kokoro and called directly for Breeze.
    """
    text = _THOUSANDS.sub("", text)
    text = _CURRENCY.sub("新台幣", text)
    return text.replace("＄", "").replace("$", "")


def split_sentences(text: str) -> list[str]:
    """Sentence-final punctuation, then whitespace/newlines, drop empties."""
    parts = [p.strip() for p in _SENTENCE_END.split(text)]
    return [p for p in parts if p]


def split_long(sentence: str, too_long: Callable[[str], bool]) -> list[str]:
    """Cut a sentence at clause punctuation until every piece passes `too_long`.

    Greedy left-to-right merge of clauses; a single clause that is still too
    long is emitted as-is and left to the engine's own hard cap.
    """
    if not too_long(sentence):
        return [sentence]
    clauses = [c for c in _CLAUSE_END.split(sentence) if c]
    out: list[str] = []
    current = ""
    for clause in clauses:
        candidate = current + clause
        if current and too_long(candidate):
            out.append(current)
            current = clause
        else:
            current = candidate
    if current:
        out.append(current)
    return out


@dataclass
class SynthesisStats:
    engine: str
    chars: int
    phonemes: int
    chunks: int
    audio_s: float
    synth_s: float
    g2p_s: float
    voice: str
    speed: float
    sample_rate: int

    @property
    def rtf(self) -> float:
        return self.synth_s / self.audio_s if self.audio_s > 0 else 0.0

    def as_dict(self) -> dict[str, Any]:
        return {
            "engine": self.engine,
            "chars": self.chars,
            "phonemes": self.phonemes,
            "chunks": self.chunks,
            "audio_s": round(self.audio_s, 3),
            "synth_s": round(self.synth_s, 3),
            "g2p_s": round(self.g2p_s, 3),
            "rtf": round(self.rtf, 3),
            "voice": self.voice,
            "speed": self.speed,
            "sample_rate": self.sample_rate,
        }


@runtime_checkable
class TtsEngine(Protocol):
    """One loaded model. `main.py` only ever sees this.

    Implementations serialise `synthesize` on their own lock: the onnxruntime
    graphs are thread-safe, but two concurrent runs on an 8 GB laptop just page.
    """

    #: Registry key, as accepted by `POST /speak {engine}` and `LOCAL_TTS_ENGINE`.
    name: str
    #: Human-readable weights identifier, echoed by `/healthz`.
    model_name: str
    sample_rate: int
    device: str
    rtf_last: float | None
    #: True when the checkpoint has a single speaker, so `voice`/`gender` on a
    #: request cannot do anything and must be reported back as ignored.
    single_speaker: bool

    def voice_names(self) -> list[str]: ...

    def has_voice(self, name: str) -> bool: ...

    def default_voice(self, gender: str | None) -> str: ...

    def synthesize(
        self, text: str, *, voice: str, speed: float = 1.0
    ) -> tuple[np.ndarray, SynthesisStats]: ...


class EngineBase:
    """The bookkeeping both engines would otherwise duplicate."""

    name = "base"
    model_name = "base"
    sample_rate = 24_000
    single_speaker = False

    def __init__(self) -> None:
        self.device = "cpu/onnxruntime"
        self.rtf_last: float | None = None
        self._lock = threading.Lock()

    @property
    def gap_samples(self) -> int:
        return int(GAP_S * self.sample_rate)

    def join(self, pieces: list[np.ndarray]) -> np.ndarray:
        """Concatenate chunks that already carry a trailing gap, minus the last one."""
        if not pieces:
            return np.zeros(0, dtype=np.float32)
        audio = np.concatenate(pieces)
        gap = self.gap_samples
        return audio[:-gap] if len(audio) >= gap else audio

    @staticmethod
    def to_pcm16(audio: np.ndarray) -> np.ndarray:
        return np.clip(audio * 32767.0, -32768, 32767).astype(np.int16)
