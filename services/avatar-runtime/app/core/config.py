"""Settings for the local Avatar Runtime (spec §67, §54, §55, §42).

Environment keys are **exactly** the §67 list::

    AVATAR_BACKEND=auto
    AVATAR_HOST=127.0.0.1
    AVATAR_PORT=8765
    AVATAR_DEFAULT_FPS=25
    AVATAR_DEFAULT_WIDTH=512
    AVATAR_DEFAULT_HEIGHT=512
    AVATAR_MODE=state_bank
    AVATAR_WEBRTC=true
    LIVEPORTRAIT_ENGINE=fasterliveportrait_mlx | fasterliveportrait_trt
    MUSETALK_ENGINE=musetalk_mlx | official_v15
    MUSETALK_PRECISION=fp16 | q8 | q4

Most fields take the ``AVATAR_`` prefix from :class:`SettingsConfigDict`; the
three engine keys have no prefix in §67, so they carry an explicit
``validation_alias``.

Two rails that should not be relaxed:

``host``
    Defaults to ``127.0.0.1`` and it must stay there (§39/§67). This process
    holds a person's likeness, a consent record and a live media stream; it is
    reached by ``apps/api`` on the same machine and by nothing else. There is
    deliberately no CORS setting and no auth token — the loopback bind *is* the
    boundary, and adding a public bind would mean the topology went wrong.

``avatars_dir``
    The §7 asset root. :mod:`app.avatars.store` refuses to load anything under
    it that has no valid ``license/consent.json`` (§73/§74, ADR-010).
"""

from __future__ import annotations

import os
from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any, Final

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: Request-id header, identical to apps/api and services/inference so one trace
#: spans all three.
REQUEST_ID_HEADER: Final[str] = "X-Request-ID"

#: §17 — 25fps ⇒ 40ms per frame. Everything downstream derives from the audio
#: clock, so this is the only place the canonical frame period is written down.
DEFAULT_FPS: Final[int] = 25


class BackendKind(StrEnum):
    """Which :mod:`app.backends` implementation drives a session."""

    AUTO = "auto"
    MAC_MLX = "mac_mlx"
    RTX_CUDA = "rtx_cuda"
    #: The §53 terminal fallback. Always available, zero heavy dependencies.
    STATIC = "static"


class RuntimeMode(StrEnum):
    """§3 — Expression State Bank (P0) vs Continuous Dual Inference (P1)."""

    STATE_BANK = "state_bank"
    CONTINUOUS = "continuous"


class Precision(StrEnum):
    """§28/§65 MuseTalk weight variants, in descending quality order."""

    FP16 = "fp16"
    Q8 = "q8"
    Q4 = "q4"


class LivePortraitEngine(StrEnum):
    FASTERLIVEPORTRAIT_MLX = "fasterliveportrait_mlx"  # §24.1 Mac
    FASTERLIVEPORTRAIT_TRT = "fasterliveportrait_trt"  # §29.1 RTX
    NONE = "none"


class MuseTalkEngine(StrEnum):
    MUSETALK_MLX = "musetalk_mlx"  # §24.2 Mac community port
    OFFICIAL_V15 = "official_v15"  # §29.2 TMElyralab official 1.5, CUDA
    NONE = "none"


class EncoderKind(StrEnum):
    """§36 — the hardware encoder name reported by ``/health``."""

    VIDEOTOOLBOX = "videotoolbox"
    NVENC = "nvenc"
    #: Software path used by the §37 Phase-1 WebSocket transport.
    SOFTWARE = "software"


class ProfileName(StrEnum):
    """§66 runtime auto-profiles."""

    MAC_LOW = "mac_low"
    MAC_BALANCED = "mac_balanced"
    MAC_HIGH = "mac_high"
    RTX_BALANCED = "rtx_balanced"
    RTX_HIGH = "rtx_high"
    #: No accelerator at all: static portrait + audio. Still a working session.
    STATIC = "static"


class RuntimeProfile(BaseModel):
    """One rung of the §56 profile table / §65 memory-degrade ladder.

    A profile is data, not policy: :mod:`app.platform.mac` and
    :mod:`app.platform.rtx` own the ordered ladders, and the orchestrator only
    ever asks for "the next rung down" when memory pressure is reported.

    Frozen, so a degrade step produces a *new* profile (``with_changes``) rather
    than mutating the one a running session is already reporting in ``/health``.
    """

    model_config = ConfigDict(frozen=True)

    name: ProfileName
    width: Annotated[int, Field(ge=64, le=1920)] = 512
    height: Annotated[int, Field(ge=64, le=1920)] = 512
    fps: Annotated[int, Field(ge=5, le=60)] = DEFAULT_FPS
    mode: RuntimeMode = RuntimeMode.STATE_BANK
    precision: Precision = Precision.FP16
    #: §19 MuseTalk micro-batch. 4 frames = 160ms, 8 = 320ms at 25fps.
    batch_size: Annotated[int, Field(ge=1, le=32)] = 8
    encoder: EncoderKind = EncoderKind.SOFTWARE

    @property
    def frame_period_s(self) -> float:
        return 1.0 / float(self.fps)

    def with_changes(self, **changes: Any) -> RuntimeProfile:
        """A copy with fields replaced, re-validated."""
        return RuntimeProfile.model_validate({**self.model_dump(), **changes})


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


class Settings(BaseSettings):
    """Immutable process configuration."""

    model_config = SettingsConfigDict(
        env_prefix="AVATAR_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
        protected_namespaces=(),
    )

    # --- process (§67) -------------------------------------------------------
    #: Loopback only. See the module docstring before changing this.
    host: str = "127.0.0.1"
    port: Annotated[int, Field(ge=1, le=65535)] = 8765
    log_level: str = "INFO"
    log_json: bool = True

    # --- canvas defaults (§42/§54/§55) --------------------------------------
    backend: BackendKind = BackendKind.AUTO
    default_fps: Annotated[int, Field(ge=5, le=60)] = DEFAULT_FPS
    default_width: Annotated[int, Field(ge=64, le=1920)] = 512
    default_height: Annotated[int, Field(ge=64, le=1920)] = 512
    mode: RuntimeMode = RuntimeMode.STATE_BANK
    webrtc: bool = True

    # --- engines (§67, unprefixed keys) --------------------------------------
    liveportrait_engine: LivePortraitEngine = Field(
        default=LivePortraitEngine.FASTERLIVEPORTRAIT_MLX,
        validation_alias=AliasChoices("LIVEPORTRAIT_ENGINE", "AVATAR_LIVEPORTRAIT_ENGINE"),
    )
    musetalk_engine: MuseTalkEngine = Field(
        default=MuseTalkEngine.MUSETALK_MLX,
        validation_alias=AliasChoices("MUSETALK_ENGINE", "AVATAR_MUSETALK_ENGINE"),
    )
    musetalk_precision: Precision = Field(
        default=Precision.FP16,
        validation_alias=AliasChoices("MUSETALK_PRECISION", "AVATAR_MUSETALK_PRECISION"),
    )

    # --- assets (§7/§64/§73) -------------------------------------------------
    avatars_dir: Path = Path("./avatars")
    configs_dir: Path = Path("./configs")
    #: §64 LRU budget for loaded avatar caches.
    max_active_avatars: Annotated[int, Field(ge=1, le=32)] = 3
    #: §73/ADR-010. Turning this off is only ever acceptable in a local test
    #: fixture, never on a machine that holds a real person's portrait.
    require_consent: bool = True

    # --- streaming (§17/§18/§37/§49) ----------------------------------------
    #: §18 target jitter buffer, 250–500ms.
    jitter_target_ms: Annotated[int, Field(ge=50, le=2000)] = 320
    #: Hard ceiling before the buffer starts dropping the oldest audio (§18).
    jitter_max_ms: Annotated[int, Field(ge=100, le=10_000)] = 1500
    #: §16 — MuseTalk's feature path is mono 16 kHz, always.
    feature_sample_rate: Annotated[int, Field(ge=8000, le=48_000)] = 16_000
    #: §17 target |A/V drift| ceiling before a frame is dropped.
    av_drift_target_ms: Annotated[float, Field(gt=0, le=1000)] = 80.0
    #: §17 "每 1–2 秒檢查".
    av_drift_check_interval_s: Annotated[float, Field(ge=0.5, le=5.0)] = 1.0
    #: §49 — the encoder queue is bounded so a slow consumer drops frames
    #: rather than growing seconds of latency.
    frame_queue_size: Annotated[int, Field(ge=1, le=240)] = 8
    #: §37 Phase-1 transport quality for JPEG/WebP.
    frame_quality: Annotated[int, Field(ge=1, le=100)] = 82

    # --- session lifecycle ---------------------------------------------------
    max_sessions: Annotated[int, Field(ge=1, le=64)] = 4
    session_idle_timeout_s: Annotated[float, Field(ge=10, le=86_400)] = 1800.0
    #: Audio bodies accepted by ``POST /sessions/{id}/audio`` (§44 prototype).
    max_audio_bytes: Annotated[int, Field(ge=1024)] = 8 * 1024 * 1024

    metrics_enabled: bool = True

    #: Browser origins allowed to call this service directly.
    #:
    #: In development the page is on :3000 and the runtime on :8765, so the
    #: browser needs an explicit grant. In production nginx proxies the runtime
    #: under `/avatar/`, making it same-origin, and this stays empty — when it is
    #: empty no CORS middleware is installed at all, so the loopback-only
    #: posture is the default rather than something an operator has to remember.
    cors_allow_origins: tuple[str, ...] = (
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    )

    # ------------------------------------------------------------------ #
    # validators
    # ------------------------------------------------------------------ #

    @field_validator("cors_allow_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: Any) -> Any:
        """Accept a comma-separated string so this can come from a single env var."""
        if isinstance(value, str):
            return tuple(part.strip() for part in value.split(",") if part.strip())
        return value

    @field_validator("webrtc", "require_consent", "metrics_enabled", "log_json", mode="before")
    @classmethod
    def _coerce_bool(cls, value: Any) -> bool:
        return _as_bool(value)

    @field_validator("log_level", mode="before")
    @classmethod
    def _upper_log_level(cls, value: Any) -> str:
        level = str(value or "INFO").upper()
        if level not in {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG", "NOTSET"}:
            msg = f"log_level must be a stdlib logging level name, got {value!r}"
            raise ValueError(msg)
        return level

    @model_validator(mode="after")
    def _check_invariants(self) -> Settings:
        if self.jitter_max_ms <= self.jitter_target_ms:
            msg = (
                "AVATAR_JITTER_MAX_MS must exceed AVATAR_JITTER_TARGET_MS, otherwise the "
                "buffer would be in permanent overrun and drop every chunk it is given"
            )
            raise ValueError(msg)
        if self.default_width % 2 or self.default_height % 2:
            msg = "canvas width/height must be even — H.264 4:2:0 chroma cannot express odd sizes"
            raise ValueError(msg)
        return self

    # ------------------------------------------------------------------ #
    # derived
    # ------------------------------------------------------------------ #

    @property
    def frame_period_s(self) -> float:
        """§17 — 1 frame = 40ms at 25fps."""
        return 1.0 / float(self.default_fps)

    @property
    def is_loopback(self) -> bool:
        return self.host in {"127.0.0.1", "::1", "localhost"}

    def config_file(self, name: str) -> Path:
        return self.configs_dir / f"{name}.yaml"

    def avatar_dir(self, avatar_id: str) -> Path:
        """Path of one §7 avatar bundle. Rejects traversal in the id."""
        if not avatar_id or "/" in avatar_id or "\\" in avatar_id or avatar_id.startswith("."):
            msg = f"invalid avatar_id: {avatar_id!r}"
            raise ValueError(msg)
        return self.avatars_dir / avatar_id


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide settings singleton."""
    return Settings()


def reset_settings_cache() -> None:
    """Drop the singleton. Tests only — production reads the environment once."""
    get_settings.cache_clear()


def settings_from_env(**overrides: Any) -> Settings:
    """Build a Settings instance ignoring ``.env``, for tests and CLI tooling."""
    keep = {
        k: v
        for k, v in os.environ.items()
        if not k.startswith(("AVATAR_", "LIVEPORTRAIT_", "MUSETALK_"))
    }
    previous = dict(os.environ)
    try:
        os.environ.clear()
        os.environ.update(keep)
        return Settings(_env_file=None, **overrides)  # type: ignore[call-arg]
    finally:
        os.environ.clear()
        os.environ.update(previous)


__all__ = [
    "DEFAULT_FPS",
    "REQUEST_ID_HEADER",
    "BackendKind",
    "EncoderKind",
    "LivePortraitEngine",
    "MuseTalkEngine",
    "Precision",
    "ProfileName",
    "RuntimeMode",
    "RuntimeProfile",
    "Settings",
    "get_settings",
    "reset_settings_cache",
    "settings_from_env",
]
