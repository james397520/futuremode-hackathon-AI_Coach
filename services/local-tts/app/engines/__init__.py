"""The engine registry: everything `main.py` needs to know about a model *name*.

Two models, one HTTP surface. `main.py` never mentions Kokoro or Breeze; it asks
this table whether an engine's weights are on disk, what voices it would offer,
and — only when someone actually asks for it — builds it.

Weights are loaded lazily per engine. Kokoro alone is 545–615 MB resident
(§16.15) and Breeze another ~130 MB; on an 8 GB machine that is already swapping
we pay for the second one only if a request names it.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from app.engines import breeze as _breeze
from app.engines import kokoro as _kokoro
from app.engines.base import (
    EngineBase,
    SynthesisStats,
    TtsEngine,
    normalize,
    split_long,
    split_sentences,
)

if TYPE_CHECKING:  # pragma: no cover - import cycle only matters to type checkers
    from app.config import Settings

__all__ = [
    "ENGINE_NAMES",
    "EngineBase",
    "SynthesisStats",
    "TtsEngine",
    "build",
    "is_available",
    "model_name",
    "normalize",
    "split_long",
    "split_sentences",
    "voice_names",
]


@dataclass(frozen=True)
class _Spec:
    model_name: str
    #: Do the weights exist? Asked before loading and reported by `/healthz`.
    available: Callable[[Settings], bool]
    #: Voice names *without* loading the graph, so `/healthz` can advertise an
    #: engine the process has not paid for yet.
    voices: Callable[[Settings], list[str]]
    build: Callable[[Settings], TtsEngine]


def _kokoro_paths(cfg: Settings) -> tuple[Path, Path, Path]:
    d = cfg.model_dir
    return d / cfg.model_file, d / cfg.voices_file, d / cfg.config_file


_SPECS: dict[str, _Spec] = {
    "breeze": _Spec(
        model_name=_breeze.MODEL_NAME,
        available=lambda cfg: _breeze.is_available(cfg.breeze_dir),
        voices=lambda cfg: [_breeze.VOICE_NAME],
        build=lambda cfg: _breeze.BreezeVitsEngine(
            model_path=cfg.breeze_dir / _breeze.MODEL_FILE,
            tokens_path=cfg.breeze_dir / _breeze.TOKENS_FILE,
            lexicon_path=cfg.breeze_dir / _breeze.LEXICON_FILE,
            threads=cfg.threads,
            gain=cfg.breeze_gain,
            length_scale=cfg.breeze_length_scale,
            taiwan_lexicon=cfg.taiwan_lexicon,
        ),
    ),
    "kokoro": _Spec(
        model_name=_kokoro.MODEL_NAME,
        available=lambda cfg: all(p.is_file() for p in _kokoro_paths(cfg)),
        voices=lambda cfg: _kokoro.list_voices(cfg.model_dir / cfg.voices_file),
        build=lambda cfg: _kokoro.KokoroZhEngine(
            model_path=cfg.model_dir / cfg.model_file,
            voices_path=cfg.model_dir / cfg.voices_file,
            config_path=cfg.model_dir / cfg.config_file,
            threads=cfg.threads,
            default_female_voice=cfg.default_female_voice,
            default_male_voice=cfg.default_male_voice,
        ),
    ),
}

#: Registration order is also the fallback order: if the configured default is
#: not on disk, the first available engine here speaks instead.
ENGINE_NAMES: tuple[str, ...] = tuple(_SPECS)


def model_name(name: str) -> str:
    return _SPECS[name].model_name


def is_available(name: str, cfg: Settings) -> bool:
    spec = _SPECS.get(name)
    return bool(spec and spec.available(cfg))


def voice_names(name: str, cfg: Settings) -> list[str]:
    spec = _SPECS.get(name)
    return spec.voices(cfg) if spec else []


def build(name: str, cfg: Settings) -> TtsEngine:
    return _SPECS[name].build(cfg)
