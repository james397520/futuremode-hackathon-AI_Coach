"""Settings for the local TTS server. Environment-driven, ``LOCAL_TTS_`` prefix."""

from __future__ import annotations

import functools
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LOCAL_TTS_", extra="ignore")

    host: str = "127.0.0.1"
    port: int = 8795
    #: Where fetch_model.sh put the weights. Gitignored.
    model_dir: Path = Field(default=SERVICE_ROOT / "models")
    model_file: str = "kokoro-v1.1-zh.onnx"
    voices_file: str = "voices-v1.1-zh.bin"
    config_file: str = "config.json"
    #: Default voices per gender. Chosen from the model card's own showcase
    #: (HEARME_zf_001 / HEARME_zm_010); every zf_*/zm_* in the voices file is
    #: still selectable by name.
    default_female_voice: str = "zf_001"
    default_male_voice: str = "zm_010"
    #: onnxruntime intra-op threads. 4 of the M3's 8 cores: enough for RTF ≈ 0.2,
    #: leaves the API and the browser breathing room on an 8 GB machine.
    threads: int = 4
    #: Idle keep-warm: synthesise a two-syllable phrase when no request has come
    #: in for this long, so the ~550 MB of weights stay resident. On this 8 GB
    #: laptop an idle agent gets paged out within minutes and the next persona
    #: line then costs 3-6 s instead of ~1 s. About 0.3 s of CPU per interval;
    #: 0 disables.
    keep_warm_s: float = 45.0
    #: Hard ceilings shared with apps/api's SessionSpeakRequest.
    max_text_chars: int = 1200
    request_timeout_s: float = 60.0
    ffmpeg_bin: str = "/opt/homebrew/bin/ffmpeg"
    log_json: bool = True


@functools.lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
