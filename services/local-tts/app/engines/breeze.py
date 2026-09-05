"""MediaTek-Research/Breeze2-VITS-onnx: Traditional-Chinese text → 22.05 kHz PCM.

A single-speaker VITS distilled from BreezyVoice, shipped as one 121 MB ONNX
graph plus a 68 k-entry 注音符號 lexicon. Run directly on the `onnxruntime` this
service already carries rather than through the `sherpa-onnx` wheel: the graph
is entirely self-describing (see `metadata_props` below), so sherpa would only
have contributed a second bundled copy of onnxruntime — and its own G2P would
have bypassed this service's `normalize()` and sentence splitting, which the
Kokoro engine already relies on.

What the file itself says (`InferenceSession.get_modelmeta()`)::

    model_type=vits  comment=vits-mr-run6  language=Chinese  jieba=1
    sample_rate=22050  add_blank=1  n_speakers=1
    punctuation=", . : ; ! ? ， 。 ： ； ！ ？ 、"

    in : x[N,L] int64 · x_length[N] int64 · noise_scale[1] · length_scale[1]
         · noise_scale_w[1] · sid[1] int64
    out: y[N,1,L] float

`add_blank=1` is the usual VITS interleave: a blank (token 0) before, between
and after every real token, so `len(x) == 2 * len(phonemes) + 1`. `n_speakers=1`
means `sid` is always 0 and a caller's `voice`/`gender` cannot do anything —
`/speak` reports that back in `X-Voice-Ignored` instead of silently dropping it.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from app.engines.base import EngineBase, SynthesisStats, normalize, split_long, split_sentences
from app.engines.taiwan_readings import taiwan_lexicon

MODEL_NAME = "MediaTek-Research/Breeze2-VITS-onnx"
SAMPLE_RATE = 22_050
MODEL_FILE = "breeze2-vits.onnx"
TOKENS_FILE = "tokens.txt"
LEXICON_FILE = "lexicon.txt"
#: The one speaker in the checkpoint. Not a choice — a label, so logs and the
#: `X-Voice` header have something honest to say.
VOICE_NAME = "tw_01"
#: Longest headword in lexicon.txt is 10 characters; the longest-match window
#: never needs to look further than that.
MAX_WORD = 10
#: Cut sentences at commas past this many phonemes. VITS is not autoregressive
#: so there is no hard limit, but the stochastic duration predictor drifts on
#: very long inputs and a comma is a better place to breathe than mid-clause.
CHUNK_PHONEMES = 200
MAX_PHONEMES = 600

#: Sampling knobs. The values sherpa-onnx uses for every VITS model, and what
#: the Android demo this checkpoint targets would use; the graph carries no
#: defaults of its own.
NOISE_SCALE = 0.667
NOISE_SCALE_W = 0.8

#: This checkpoint is quiet: peak ≈ 0.075, RMS ≈ 0.011 against Kokoro's 0.44 /
#: 0.06 on the same sentence. Without a gain the persona is inaudible next to
#: the cloud voice. ×5 lands on Kokoro's RMS; `_apply_gain` backs off if that
#: would clip, so the gain is never the thing that distorts a loud line.
GAIN = 5.0
PEAK_CEILING = 0.95

#: tokens.txt has exactly six punctuation marks (plus the blank and a space).
#: Everything else a persona line can contain is mapped onto the nearest one;
#: an ASCII hyphen becomes a comma-length pause rather than an em dash, because
#: it usually sits between numbers ("3-5 年"), not between clauses.
PUNCTUATION = {
    "，": "，",
    ",": "，",
    "、": "，",
    "；": "，",
    ";": "，",
    "：": "，",
    ":": "，",
    "-": "，",
    "。": "。",
    ".": "。",
    "！": "！",
    "!": "！",
    "？": "？",
    "?": "？",
    "—": "—",
    "–": "—",
    "―": "—",
    "─": "—",
    "－": "—",
    "～": "—",
    "~": "—",
    "…": "…",
    "⋯": "…",
    "‥": "…",
}


def is_available(model_dir: Path) -> bool:
    """All three files present? `/healthz` and the loader both ask before trying."""
    return all((model_dir / f).is_file() for f in (MODEL_FILE, TOKENS_FILE, LEXICON_FILE))


def read_tokens(path: Path) -> dict[str, int]:
    """``<symbol> <id>`` per line. The symbol may itself be a space, so split from
    the right — ``" 49"`` is the space token, not a malformed line."""
    tokens: dict[str, int] = {}
    with path.open(encoding="utf-8") as fp:
        for line in fp:
            line = line.rstrip("\n")
            if not line:
                continue
            symbol, _, index = line.rpartition(" ")
            if index.isdigit():
                tokens[symbol] = int(index)
    return tokens


def read_lexicon(path: Path, *, taiwan: bool = True) -> dict[str, list[str]]:
    """``<word> <注音> <注音> …`` per line; 67,999 entries, 1–10 characters each.

    With `taiwan` (the default), the readings in `taiwan_readings` are layered on
    top. That file explains why: the shipped list is a Taiwan voice reading from
    a mainland word list, so 研究 comes out ㄐㄧㄡˉ and 品質 comes out ㄓˋ. Merging
    is enough — longest match then finds the corrected word before it ever
    reaches the per-character fallback.
    """
    lexicon: dict[str, list[str]] = {}
    with path.open(encoding="utf-8") as fp:
        for line in fp:
            parts = line.split()
            if len(parts) >= 2:
                lexicon[parts[0]] = parts[1:]
    if taiwan:
        lexicon.update(taiwan_lexicon())
    return lexicon


def verbalize(text: str) -> str:
    """Digits → Chinese numerals. The token set has no Latin or Arabic entries,
    so anything left as "3500" would simply vanish.

    `cn2an` is already installed (misaki's [zh] extra pulls it in for Kokoro);
    here it is called directly. It emits simplified 万/亿/点, which this lexicon
    happens to carry alongside the traditional forms, so no conversion is needed.
    A failure falls through to the raw text rather than failing the request —
    losing the digits is better than losing the sentence.
    """
    try:
        import cn2an

        return str(cn2an.transform(text, "an2cn"))
    except Exception:
        return text


class BopomofoG2P:
    """Text → 注音符號 tokens by longest match over the lexicon.

    Left to right, try the longest headword that starts here (10 characters down
    to 1) and take its reading; the per-character fallback is just the tail of
    that same loop, since every common character is also a 1-character entry.
    A character in neither the lexicon nor the punctuation table is dropped: a
    stray emoji or an English word must not silence the sentence around it.
    """

    def __init__(self, tokens: dict[str, int], lexicon: dict[str, list[str]]) -> None:
        self.tokens = tokens
        self.lexicon = lexicon
        self.max_word = min(MAX_WORD, max((len(w) for w in lexicon), default=1))

    def phonemes(self, text: str) -> list[str]:
        out: list[str] = []
        i = 0
        n = len(text)
        while i < n:
            for size in range(min(self.max_word, n - i), 0, -1):
                reading = self.lexicon.get(text[i : i + size])
                if reading is not None:
                    out.extend(reading)
                    i += size
                    break
            else:
                mapped = PUNCTUATION.get(text[i])
                # Never two pauses in a row: "好。」" would otherwise get two.
                if mapped is not None and mapped in self.tokens and (not out or out[-1] != mapped):
                    out.append(mapped)
                i += 1
        return out

    def encode(self, phonemes: list[str]) -> list[int]:
        """Ids with the ``add_blank=1`` interleave: 0, t₀, 0, t₁, 0, …, 0."""
        ids = [self.tokens[p] for p in phonemes if p in self.tokens]
        interleaved = [0] * (2 * len(ids) + 1)
        interleaved[1::2] = ids
        return interleaved


def _apply_gain(audio: np.ndarray, gain: float) -> np.ndarray:
    if audio.size == 0:
        return audio
    peak = float(np.abs(audio).max())
    if peak > 0 and peak * gain > PEAK_CEILING:
        gain = PEAK_CEILING / peak
    return audio * gain


@dataclass
class BreezeVitsEngine(EngineBase):
    """One loaded VITS graph plus its lexicon. ~130 MB resident, single speaker."""

    model_path: Path
    tokens_path: Path
    lexicon_path: Path
    threads: int = 4
    gain: float = GAIN
    noise_scale: float = NOISE_SCALE
    noise_scale_w: float = NOISE_SCALE_W
    #: Multiplies every duration. > 1 slows the delivery down; this checkpoint
    #: speaks about 30 % faster than Kokoro at 1.0.
    length_scale: float = 1.0
    #: Layer the 台灣讀音 overrides over the shipped lexicon. See
    #: `taiwan_readings.py` for what changes and why.
    taiwan_lexicon: bool = True
    session: Any = field(init=False, repr=False)
    g2p: BopomofoG2P = field(init=False, repr=False)

    name = "breeze"
    model_name = MODEL_NAME
    sample_rate = SAMPLE_RATE
    single_speaker = True

    def __post_init__(self) -> None:
        import onnxruntime as ort

        EngineBase.__init__(self)
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = self.threads
        opts.inter_op_num_threads = 1
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(
            str(self.model_path), opts, providers=["CPUExecutionProvider"]
        )
        meta = self.session.get_modelmeta().custom_metadata_map
        # Trust the file over the constants: a re-export with a different rate
        # would otherwise play back at the wrong pitch, silently.
        self.sample_rate = int(meta.get("sample_rate") or SAMPLE_RATE)
        self.single_speaker = int(meta.get("n_speakers") or 1) <= 1
        self.g2p = BopomofoG2P(
            read_tokens(self.tokens_path),
            read_lexicon(self.lexicon_path, taiwan=self.taiwan_lexicon),
        )

    # ---- voices -------------------------------------------------------------
    def voice_names(self) -> list[str]:
        return [VOICE_NAME]

    def has_voice(self, name: str) -> bool:
        return name == VOICE_NAME

    def default_voice(self, gender: str | None) -> str:
        return VOICE_NAME

    # ---- pipeline -----------------------------------------------------------
    def _chunks(self, text: str) -> list[list[str]]:
        cache: dict[str, list[str]] = {}

        def phonemes_for(piece: str) -> list[str]:
            if piece not in cache:
                cache[piece] = self.g2p.phonemes(piece)
            return cache[piece]

        chunks: list[list[str]] = []
        for sentence in split_sentences(verbalize(normalize(text))):
            for piece in split_long(sentence, lambda p: len(phonemes_for(p)) > CHUNK_PHONEMES):
                phonemes = phonemes_for(piece)
                if phonemes:
                    chunks.append(phonemes[:MAX_PHONEMES])
        return chunks

    def _run(self, phonemes: list[str], length_scale: float) -> np.ndarray:
        ids = self.g2p.encode(phonemes)
        outputs = self.session.run(
            None,
            {
                "x": np.array([ids], dtype=np.int64),
                "x_length": np.array([len(ids)], dtype=np.int64),
                "noise_scale": np.array([self.noise_scale], dtype=np.float32),
                "length_scale": np.array([length_scale], dtype=np.float32),
                "noise_scale_w": np.array([self.noise_scale_w], dtype=np.float32),
                "sid": np.array([0], dtype=np.int64),
            },
        )
        return np.asarray(outputs[0], dtype=np.float32).ravel()

    def synthesize(
        self, text: str, *, voice: str = VOICE_NAME, speed: float = 1.0
    ) -> tuple[np.ndarray, SynthesisStats]:
        """Return int16 PCM at 22.05 kHz plus timings. `voice` is accepted and
        ignored — the checkpoint has one speaker."""
        t0 = time.perf_counter()
        chunks = self._chunks(text)
        t1 = time.perf_counter()
        # VITS scales *durations*, so a faster voice is a smaller number.
        length_scale = self.length_scale / max(speed, 0.1)
        gap = np.zeros(self.gap_samples, dtype=np.float32)
        pieces: list[np.ndarray] = []
        with self._lock:
            for phonemes in chunks:
                pieces.append(self._run(phonemes, length_scale))
                pieces.append(gap)
        t2 = time.perf_counter()
        pcm = self.to_pcm16(_apply_gain(self.join(pieces), self.gain))
        stats = SynthesisStats(
            engine=self.name,
            chars=len(text),
            phonemes=sum(len(c) for c in chunks),
            chunks=len(chunks),
            audio_s=len(pcm) / self.sample_rate,
            synth_s=t2 - t1,
            g2p_s=t1 - t0,
            voice=VOICE_NAME,
            speed=speed,
            sample_rate=self.sample_rate,
        )
        self.rtf_last = round(stats.rtf, 3)
        return pcm, stats
