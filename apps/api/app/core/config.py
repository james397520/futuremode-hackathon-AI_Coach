"""Application settings.

Reads exactly the variable names declared in the repository-root ``.env.example``.
A small number of *optional* extras (CORS origins, log level, token TTLs, provider
switches) are declared with safe defaults; they are documented in ``apps/api/README.md``
so that ``.env.example`` stays the single source of truth for required variables.

Security invariants enforced here (spec §56 / §70 / §71 / §73):

* ``OPENAI_API_KEY`` / ``ELEVENLABS_API_KEY`` are read *only* in this process. They are
  never serialised into a response model and never returned by any router.
* Outside ``APP_ENV=local`` the process refuses to boot with a default ``JWT_SECRET``
  or with a missing ``OPENAI_API_KEY`` while the OpenAI provider is enabled.
"""

from __future__ import annotations

import functools
from typing import Literal

from pydantic import Field, SecretStr, ValidationInfo, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

AppEnv = Literal["local", "test", "staging", "production"]
WebGpuMode = Literal["auto", "on", "off"]
LlmProvider = Literal["openai", "azure_openai", "aup", "minimax", "none"]
TtsProvider = Literal["elevenlabs", "openai", "local", "none"]
SttProvider = Literal["mac", "elevenlabs", "openai", "none"]
VectorBackend = Literal["qdrant", "memory", "chroma", "faiss"]

#: Placeholder shipped in ``.env.example``; must never reach a deployed environment.
DEFAULT_JWT_SECRET = "change-me"


class ConfigurationError(RuntimeError):
    """Raised at import/boot time when the process is unsafe to start."""


class Settings(BaseSettings):
    """Typed view over the process environment."""

    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        secrets_dir=None,
    )

    # ---- environment --------------------------------------------------------
    app_env: AppEnv = Field(default="local", validation_alias="APP_ENV")
    app_name: str = Field(default="ai-coach-api", validation_alias="APP_NAME")
    api_prefix: str = Field(default="/api/v1", validation_alias="API_PREFIX")
    log_level: str = Field(default="INFO", validation_alias="LOG_LEVEL")
    debug_sql: bool = Field(default=False, validation_alias="DEBUG_SQL")

    # ---- datastores (.env.example) -----------------------------------------
    database_url: str = Field(
        default="postgresql+asyncpg://localhost:5432/aicoach",
        validation_alias="DATABASE_URL",
    )
    redis_url: str = Field(default="redis://localhost:6379/0", validation_alias="REDIS_URL")
    qdrant_url: str = Field(default="http://localhost:6333", validation_alias="QDRANT_URL")
    qdrant_api_key: SecretStr | None = Field(default=None, validation_alias="QDRANT_API_KEY")
    vector_backend: VectorBackend = Field(default="memory", validation_alias="VECTOR_BACKEND")

    # ---- object storage (.env.example) -------------------------------------
    s3_endpoint: str = Field(default="http://localhost:9000", validation_alias="S3_ENDPOINT")
    s3_access_key: str = Field(default="minioadmin", validation_alias="S3_ACCESS_KEY")
    s3_secret_key: SecretStr = Field(
        default=SecretStr("minioadmin"), validation_alias="S3_SECRET_KEY"
    )
    s3_bucket: str = Field(default="ai-coach", validation_alias="S3_BUCKET")
    s3_region: str = Field(default="us-east-1", validation_alias="S3_REGION")
    s3_signed_url_ttl_seconds: int = Field(
        default=900, validation_alias="S3_SIGNED_URL_TTL_SECONDS"
    )
    object_storage_enabled: bool = Field(
        default=False, validation_alias="OBJECT_STORAGE_ENABLED"
    )

    # ---- provider secrets (.env.example) — never leave this process ---------
    openai_api_key: SecretStr | None = Field(default=None, validation_alias="OPENAI_API_KEY")
    minimax_api_key: SecretStr | None = Field(default=None, validation_alias="MINIMAX_API_KEY")
    elevenlabs_api_key: SecretStr | None = Field(
        default=None, validation_alias="ELEVENLABS_API_KEY"
    )
    llm_provider: LlmProvider = Field(default="openai", validation_alias="LLM_PROVIDER")
    tts_provider: TtsProvider = Field(default="elevenlabs", validation_alias="TTS_PROVIDER")
    # Scribe needs no OpenAI dependency, so ElevenLabs covers both directions by default.
    stt_provider: SttProvider = Field(default="elevenlabs", validation_alias="STT_PROVIDER")
    # macOS-native recogniser (tools/mac-stt). Used when STT_PROVIDER=mac, or as
    # the on-device choice a client may request per utterance; falls back to the
    # cloud provider when the helper is missing or unauthorised.
    mac_stt_bin: str = Field(default="tools/mac-stt/bin/mac-stt", validation_alias="MAC_STT_BIN")
    # The helper runs as its own launchd agent (TCC attributes the permission to
    # it, not to whoever spawned it) and listens on loopback. The API talks to it
    # here; a per-call subprocess is only the fallback when the daemon is down.
    mac_stt_port: int = Field(default=8790, validation_alias="MAC_STT_PORT")
    # Local TTS model server (services/local-tts: Kokoro-82M-v1.1-zh on onnxruntime,
    # its own launchd agent on loopback). Used when TTS_PROVIDER=local, or when a
    # client asks for `engine=local` per line; falls back to the cloud provider when
    # the port is closed, so a missing model never silences the persona.
    local_tts_url: str = Field(default="http://127.0.0.1:8795", validation_alias="LOCAL_TTS_URL")
    # Measured on this account, zh-TW, 24-char sentence, median of 3, streaming:
    #   eleven_multilingual_v2  TTFB ~1040ms  total ~1100ms
    #   eleven_flash_v2_5       TTFB  ~215ms  total  ~310ms
    #   eleven_turbo_v2_5       TTFB  ~290ms  total  ~390ms
    # A live customer that takes a second to start talking feels broken; flash
    # is the default. Set ELEVENLABS_TTS_MODEL=eleven_multilingual_v2 for quality.
    elevenlabs_tts_model: str = Field(
        default="eleven_flash_v2_5", validation_alias="ELEVENLABS_TTS_MODEL"
    )
    llm_model: str = Field(default="gpt-4o", validation_alias="LLM_MODEL")
    minimax_base_url: str = Field(
        default="https://api.minimax.io/anthropic/v1", validation_alias="MINIMAX_BASE_URL"
    )
    minimax_model: str = Field(
        # Measured against the live endpoint (2 runs each, same prompt):
        # M3 3.3s, M2.1 4.6s, M2.5-highspeed 11.6s, M2.7-highspeed 35.3s.
        # Every model emits a `thinking` block that cannot be disabled, so the
        # win comes from the model, not from request parameters. The
        # deployment's .env is authoritative; this is only the fallback.
        default="MiniMax-M3",
        validation_alias="MINIMAX_MODEL",
    )
    llm_timeout_seconds: float = Field(default=30.0, validation_alias="LLM_TIMEOUT_SECONDS")
    embedding_model: str = Field(
        default="text-embedding-3-large", validation_alias="EMBEDDING_MODEL"
    )
    embedding_dimension: int = Field(default=3072, validation_alias="EMBEDDING_DIMENSION")

    # ---- auth (.env.example: JWT_SECRET) -----------------------------------
    jwt_secret: SecretStr = Field(
        default=SecretStr(DEFAULT_JWT_SECRET), validation_alias="JWT_SECRET"
    )
    jwt_algorithm: str = Field(default="HS256", validation_alias="JWT_ALGORITHM")
    jwt_issuer: str = Field(default="ai-coach", validation_alias="JWT_ISSUER")
    access_token_ttl_seconds: int = Field(
        default=15 * 60, validation_alias="ACCESS_TOKEN_TTL_SECONDS"
    )
    refresh_token_ttl_seconds: int = Field(
        default=14 * 24 * 3600, validation_alias="REFRESH_TOKEN_TTL_SECONDS"
    )
    session_cookie_name: str = Field(default="aicoach_session", validation_alias="COOKIE_NAME")
    csrf_cookie_name: str = Field(default="aicoach_csrf", validation_alias="CSRF_COOKIE_NAME")
    refresh_cookie_name: str = Field(
        default="aicoach_refresh", validation_alias="REFRESH_COOKIE_NAME"
    )
    cookie_domain: str | None = Field(default=None, validation_alias="COOKIE_DOMAIN")

    # ---- CORS (§73: explicit origins + credentials) -------------------------
    cors_allow_origins: tuple[str, ...] = Field(
        default=("http://localhost:3000",), validation_alias="CORS_ALLOW_ORIGINS"
    )

    # ---- rate limiting (§40.3 / §49.4) --------------------------------------
    rate_limit_enabled: bool = Field(default=True, validation_alias="RATE_LIMIT_ENABLED")
    rate_limit_default_per_minute: int = Field(
        default=120, validation_alias="RATE_LIMIT_DEFAULT_PER_MINUTE"
    )
    rate_limit_mutating_per_minute: int = Field(
        default=30, validation_alias="RATE_LIMIT_MUTATING_PER_MINUTE"
    )

    # ---- client runtime policy defaults (§44 / §61) -------------------------
    webgpu_mode: WebGpuMode = Field(
        default="auto", validation_alias="NEXT_PUBLIC_ENABLE_WEBGPU"
    )
    allow_local_model_cache: bool = Field(
        default=True, validation_alias="ALLOW_LOCAL_MODEL_CACHE"
    )
    allow_sensitive_data_cache: bool = Field(
        default=False, validation_alias="ALLOW_SENSITIVE_DATA_CACHE"
    )
    clear_on_logout: bool = Field(default=True, validation_alias="CLEAR_ON_LOGOUT")

    # ---- retention (§40.2) --------------------------------------------------
    transcript_retention_days: int = Field(
        default=365, validation_alias="TRANSCRIPT_RETENTION_DAYS"
    )

    # ---- observability ------------------------------------------------------
    otel_enabled: bool = Field(default=False, validation_alias="OTEL_ENABLED")
    otel_service_name: str = Field(default="ai-coach-api", validation_alias="OTEL_SERVICE_NAME")
    otel_exporter_otlp_endpoint: str | None = Field(
        default=None, validation_alias="OTEL_EXPORTER_OTLP_ENDPOINT"
    )

    # ---- derived ------------------------------------------------------------
    @property
    def is_local(self) -> bool:
        """True for developer machines and the automated test environment."""
        return self.app_env in ("local", "test")

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def openai_enabled(self) -> bool:
        """The OpenAI provider is enabled for LLM work or for TTS/STT (§70/§71)."""
        return self.llm_provider in ("openai", "azure_openai") or self.tts_provider == "openai"

    @property
    def elevenlabs_enabled(self) -> bool:
        return self.tts_provider == "elevenlabs" or self.stt_provider == "elevenlabs"

    @property
    def minimax_enabled(self) -> bool:
        return self.llm_provider == "minimax"

    @property
    def cookie_secure(self) -> bool:
        """Secure cookies everywhere except plain-HTTP local development (§73)."""
        return not self.is_local

    # ---- validators ---------------------------------------------------------
    @field_validator("cors_allow_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        """Accept ``a,b`` or a JSON array for CORS_ALLOW_ORIGINS."""
        if isinstance(value, str):
            raw = value.strip()
            if raw.startswith("["):
                return raw
            return tuple(item.strip() for item in raw.split(",") if item.strip())
        return value

    @field_validator("cors_allow_origins", mode="after")
    @classmethod
    def _reject_wildcard_origin(
        cls, value: tuple[str, ...], info: ValidationInfo
    ) -> tuple[str, ...]:
        """``*`` is incompatible with credentialed CORS and forbidden by §73."""
        if "*" in value:
            raise ValueError(
                "CORS_ALLOW_ORIGINS must list explicit origins; '*' is incompatible with "
                "credentialed requests (spec §73)."
            )
        _ = info
        return value

    @field_validator("log_level", mode="after")
    @classmethod
    def _normalise_log_level(cls, value: str) -> str:
        level = value.strip().upper()
        allowed = {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG", "NOTSET"}
        if level not in allowed:
            raise ValueError(f"LOG_LEVEL must be one of {sorted(allowed)}")
        return level

    @field_validator("database_url", mode="after")
    @classmethod
    def _require_async_driver(cls, value: str) -> str:
        if not value.startswith("postgresql+asyncpg://"):
            raise ValueError(
                "DATABASE_URL must use the asyncpg driver, e.g. "
                "postgresql+asyncpg://user:pass@host:5432/db"
            )
        return value

    @model_validator(mode="after")
    def _fail_fast_on_unsafe_config(self) -> Settings:
        """Refuse to boot a non-local environment with placeholder/absent secrets."""
        if self.is_local:
            return self

        problems: list[str] = []
        if self.jwt_secret.get_secret_value() == DEFAULT_JWT_SECRET:
            problems.append("JWT_SECRET is still the .env.example placeholder 'change-me'")
        if len(self.jwt_secret.get_secret_value()) < 32:
            problems.append("JWT_SECRET must be at least 32 characters outside local")
        if self.openai_enabled and not self.openai_api_key:
            problems.append(
                f"OPENAI_API_KEY is required when LLM_PROVIDER={self.llm_provider} / "
                f"TTS_PROVIDER={self.tts_provider}"
            )
        if self.minimax_enabled and not self.minimax_api_key:
            problems.append("MINIMAX_API_KEY is required when LLM_PROVIDER=minimax")
        if self.elevenlabs_enabled and not self.elevenlabs_api_key:
            problems.append("ELEVENLABS_API_KEY is required when TTS_PROVIDER=elevenlabs")
        if not self.cors_allow_origins:
            problems.append("CORS_ALLOW_ORIGINS must not be empty outside local")
        if self.is_production and self.allow_sensitive_data_cache:
            problems.append(
                "ALLOW_SENSITIVE_DATA_CACHE must be false in production (spec §61/§97)"
            )
        if self.is_production and self.vector_backend == "memory":
            problems.append("VECTOR_BACKEND=memory is only allowed for local development")
        if self.is_production and not self.object_storage_enabled:
            problems.append("OBJECT_STORAGE_ENABLED must be true in production")
        if problems:
            raise ConfigurationError(
                f"Unsafe configuration for APP_ENV={self.app_env}: " + "; ".join(problems)
            )
        return self


@functools.lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide settings singleton (cached; safe as a FastAPI dependency)."""
    return Settings()
