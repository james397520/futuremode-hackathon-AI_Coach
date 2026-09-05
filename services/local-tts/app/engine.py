"""Kokoro-82M-v1.1-zh on onnxruntime: text → 24 kHz PCM.

Pipeline, in order: split the text into sentences (the model was trained on
≤ ~100-token utterances and rushes past that), misaki's Chinese G2P turns each
sentence into Kokoro's phoneme alphabet, the vocab from the model's own
``config.json`` maps phonemes to ids, and one onnxruntime ``run`` per sentence
produces the waveform. Sentences are joined with a short silence.

Everything the model needs lives in three files under ``models/`` (see
``scripts/fetch_model.sh``); nothing is downloaded at runtime.
"""

from __future__ import annotations

import json
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

SAMPLE_RATE = 24_000
#: Hard limit of the graph (position embeddings); we stay well under it.
MAX_TOKENS = 510
#: Target per chunk. Past ~100 tokens the model speeds up and starts dropping
#: syllables (documented in the model card's make_zh.py), so long sentences are
#: cut at the nearest comma before this many phoneme tokens.
CHUNK_TOKENS = 120
#: Silence appended after each sentence: 0.18 s.
GAP_SAMPLES = int(0.18 * SAMPLE_RATE)

_SENTENCE_END = re.compile(r"(?<=[。！？!?；;…\n])")
_CLAUSE_END = re.compile(r"(?<=[，,、：:])")
_THOUSANDS = re.compile(r"(?<=\d),(?=\d{3}\b)")
_CURRENCY = re.compile(r"(?:NT\$|NTD|TWD)\s*")


def normalize(text: str) -> str:
    """The few things misaki's number reader gets wrong on insurance copy.

    "1,200" is read as 一，二百 unless the separator goes; "NT$" is an unknown
    symbol (dropped silently). Everything else — plain numbers, %, dates — is
    left to cn2an inside misaki.
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
    long is emitted as-is and left to the 510-token hard cap.
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


def length_speed(n_tokens: int) -> float:
    """The model card's mitigation for rushing on longer inputs (make_zh.py).

    1.0 up to 83 tokens, linear down to 0.8 at 183, then flat. Multiplied by
    the caller's own speed.
    """
    if n_tokens <= 83:
        return 1.0
    if n_tokens < 183:
        return 1.0 - (n_tokens - 83) / 500
    return 0.8


class Tokenizer:
    """Phoneme string → vocab ids using the model's own ``config.json``."""

    def __init__(self, vocab: dict[str, int]) -> None:
        self.vocab = vocab

    @classmethod
    def from_config(cls, path: Path) -> Tokenizer:
        with path.open(encoding="utf-8") as fp:
            return cls(json.load(fp)["vocab"])

    def encode(self, phonemes: str) -> list[int]:
        # Symbols outside the vocab (rare CJK punctuation, emoji) are dropped
        # rather than raising — a stray character must not silence a sentence.
        return [self.vocab[ch] for ch in phonemes if ch in self.vocab]


@dataclass
class SynthesisStats:
    chars: int
    phonemes: int
    chunks: int
    audio_s: float
    synth_s: float
    g2p_s: float
    voice: str
    speed: float

    @property
    def rtf(self) -> float:
        return self.synth_s / self.audio_s if self.audio_s > 0 else 0.0

    def as_dict(self) -> dict[str, Any]:
        return {
            "chars": self.chars,
            "phonemes": self.phonemes,
            "chunks": self.chunks,
            "audio_s": round(self.audio_s, 3),
            "synth_s": round(self.synth_s, 3),
            "g2p_s": round(self.g2p_s, 3),
            "rtf": round(self.rtf, 3),
            "voice": self.voice,
            "speed": self.speed,
        }


@dataclass
class KokoroZhEngine:
    """One loaded model. `synthesize` is serialised by a lock: the graph is
    thread-safe, but two concurrent runs on an 8 GB laptop just page."""

    model_path: Path
    voices_path: Path
    config_path: Path
    threads: int = 4
    session: Any = field(init=False, repr=False)
    voices: dict[str, np.ndarray] = field(init=False, repr=False)
    tokenizer: Tokenizer = field(init=False, repr=False)
    g2p: Any = field(init=False, repr=False)
    device: str = field(init=False, default="cpu")
    rtf_last: float | None = field(init=False, default=None)
    _lock: threading.Lock = field(init=False, default_factory=threading.Lock, repr=False)

    def __post_init__(self) -> None:
        import onnxruntime as ort
        from misaki import zh

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = self.threads
        opts.inter_op_num_threads = 1
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(
            str(self.model_path), opts, providers=["CPUExecutionProvider"]
        )
        self.device = "cpu/onnxruntime"
        with np.load(self.voices_path) as packed:
            self.voices = {name: packed[name] for name in packed.files}
        self.tokenizer = Tokenizer.from_config(self.config_path)
        # version="1.1" selects the phoneme alphabet this checkpoint was trained on
        # (Bopomofo-style consonants + tone marks); "1.0" would produce garbage.
        self.g2p = zh.ZHG2P(version="1.1")
        self._input_names = {i.name for i in self.session.get_inputs()}
        self._tokens_input = "input_ids" if "input_ids" in self._input_names else "tokens"

    # ---- voices -------------------------------------------------------------
    def voice_names(self) -> list[str]:
        """The Chinese voices (zf_* / zm_*). The pack also carries three English
        voices; without an English G2P they would only produce noise, so they are
        not advertised — though `has_voice` still accepts them."""
        return sorted(v for v in self.voices if v[:3] in ("zf_", "zm_"))

    def has_voice(self, name: str) -> bool:
        return name in self.voices

    # ---- pipeline -----------------------------------------------------------
    def phonemize(self, text: str) -> str:
        result = self.g2p(text)
        # misaki returns (phonemes, tokens) in recent versions, a str in older ones.
        phonemes = result[0] if isinstance(result, tuple) else result
        return str(phonemes or "")

    def _chunks(self, text: str) -> list[list[int]]:
        # jieba + pypinyin cost ~40 ms per sentence and the splitter asks about
        # the same pieces more than once; memoise within the request.
        encoded: dict[str, list[int]] = {}

        def ids_for(piece: str) -> list[int]:
            if piece not in encoded:
                encoded[piece] = self.tokenizer.encode(self.phonemize(piece))
            return encoded[piece]

        chunks: list[list[int]] = []
        for sentence in split_sentences(normalize(text)):
            for piece in split_long(sentence, lambda p: len(ids_for(p)) > CHUNK_TOKENS):
                ids = ids_for(piece)
                if ids:
                    chunks.append(ids[:MAX_TOKENS])
        return chunks

    def _run(self, ids: list[int], voice: np.ndarray, speed: float) -> np.ndarray:
        style = voice[min(len(ids), len(voice)) - 1]
        inputs = {
            self._tokens_input: np.array([[0, *ids, 0]], dtype=np.int64),
            "style": np.asarray(style, dtype=np.float32),
            "speed": np.array([speed], dtype=np.float32),
        }
        outputs = self.session.run(None, inputs)
        return np.asarray(outputs[0], dtype=np.float32).ravel()

    def synthesize(
        self, text: str, *, voice: str, speed: float = 1.0
    ) -> tuple[np.ndarray, SynthesisStats]:
        """Return int16 PCM at 24 kHz plus timings. Raises KeyError on an unknown voice."""
        pack = self.voices[voice]
        t0 = time.perf_counter()
        chunks = self._chunks(text)
        t1 = time.perf_counter()
        pieces: list[np.ndarray] = []
        with self._lock:
            for ids in chunks:
                wav = self._run(ids, pack, speed * length_speed(len(ids)))
                pieces.append(wav)
                pieces.append(np.zeros(GAP_SAMPLES, dtype=np.float32))
        t2 = time.perf_counter()
        audio = np.concatenate(pieces) if pieces else np.zeros(0, dtype=np.float32)
        # Trim the trailing gap; keep the inter-sentence ones.
        if len(audio) >= GAP_SAMPLES:
            audio = audio[:-GAP_SAMPLES]
        pcm = np.clip(audio * 32767.0, -32768, 32767).astype(np.int16)
        stats = SynthesisStats(
            chars=len(text),
            phonemes=sum(len(c) for c in chunks),
            chunks=len(chunks),
            audio_s=len(pcm) / SAMPLE_RATE,
            synth_s=t2 - t1,
            g2p_s=t1 - t0,
            voice=voice,
            speed=speed,
        )
        self.rtf_last = round(stats.rtf, 3)
        return pcm, stats
