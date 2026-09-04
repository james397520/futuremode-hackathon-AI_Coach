"""Settings for the private inference service (spec §72 / §49).

Every value is read from the environment with the ``INFERENCE_`` prefix, e.g.
``INFERENCE_DEVICE=rocm``, ``INFERENCE_MAX_BATCH_SIZE=16``. Defaults are the
CPU-only, single-node values that make ``docker compose up`` work with no
configuration at all.

Two settings exist purely as safety rails and should not be relaxed casually:

``model_allowlist``
    Nothing outside this list may be loaded, *even if it appears in the on-disk
    manifest*. An empty list means "every entry in the manifest", which is safe
    because the manifest is operator-controlled configuration, but an explicit
    list is what you want in production: it makes "add a model" a deployment
    change rather than a request parameter.

``shared_secret``
    Service-to-service auth. This service must never be reachable from the public
    internet (see README, "what this service must never do"); the secret is
    defence in depth for the case where the cluster network is flatter than the
    diagram claims.
"""

from __future__ import annotations

import os
from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any, Final

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: Header carrying the shared secret when the caller does not use ``Authorization``.
SECRET_HEADER: Final[str] = "X-Inference-Secret"
#: Request-id header, identical to the main API's so a trace spans both services.
REQUEST_ID_HEADER: Final[str] = "X-Request-ID"


class Device(StrEnum):
    """Where the ONNX graph executes."""

    CPU = "cpu"
    CUDA = "cuda"
    #: AMD AUP is a ROCm environment. onnxruntime exposes AMD acceleration through
    #: the **ROCm** execution provider (``ROCMExecutionProvider``) and, for graphs
    #: MIGraphX can compile, ``MIGraphXExecutionProvider``. Those providers only
    #: exist in an onnxruntime built against ROCm — the PyPI `onnxruntime` wheel is
    #: CPU-only and the `onnxruntime-gpu` PyPI wheel is CUDA-only. See the `rocm`
    #: extra in pyproject.toml and RUNTIME_VARIANT in the Dockerfile.
    ROCM = "rocm"


class AppEnv(StrEnum):
    LOCAL = "local"
    STAGING = "staging"
    PRODUCTION = "production"


#: Provider preference order per device. onnxruntime falls through this list, so the
#: CPU provider is always last rather than absent: a model the accelerator cannot
#: compile should run slowly, not fail (§49.4 "degrade, do not disappear").
_PROVIDERS: Final[dict[Device, tuple[str, ...]]] = {
    Device.CPU: ("CPUExecutionProvider",),
    Device.CUDA: ("CUDAExecutionProvider", "CPUExecutionProvider"),
    Device.ROCM: ("MIGraphXExecutionProvider", "ROCMExecutionProvider", "CPUExecutionProvider"),
}


def _as_tuple(value: Any) -> tuple[str, ...]:
    """Accept a comma-separated string, a JSON-ish list, or a real sequence."""
    if value is None or value == "":
        return ()
    if isinstance(value, str):
        return tuple(part.strip() for part in value.split(",") if part.strip())
    if isinstance(value, (list, tuple, set, frozenset)):
        return tuple(str(part).strip() for part in value if str(part).strip())
    return (str(value),)


class Settings(BaseSettings):
    """Immutable process configuration."""

    model_config = SettingsConfigDict(
        env_prefix="INFERENCE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
        # `model_dir`, `model_allowlist`, ... would otherwise collide with pydantic's
        # protected `model_` namespace and emit warnings on every import.
        protected_namespaces=(),
    )

    # --- process -------------------------------------------------------------
    app_env: AppEnv = AppEnv.LOCAL
    host: str = "0.0.0.0"  # noqa: S104 - container-local bind; exposure is the proxy's job
    port: Annotated[int, Field(ge=1, le=65535)] = 8100
    log_level: str = "INFO"
    #: JSON logs everywhere except an interactive local run.
    log_json: bool = True

    # --- model storage -------------------------------------------------------
    #: Weights are mounted, never baked into the image and never committed to git.
    model_dir: Path = Path("/srv/models")
    #: Defaults to ``<model_dir>/manifest.json``; see :meth:`manifest_path`.
    model_manifest_path: Path | None = None

    #: Loaded and warmed at boot. `/health/ready` stays red until all of them are up.
    preload_models: tuple[str, ...] = (
        "BAAI/bge-m3",
        "BAAI/bge-reranker-v2-m3",
    )
    default_embedding_model: str = "BAAI/bge-m3"
    default_rerank_model: str = "BAAI/bge-reranker-v2-m3"
    #: Empty = "any entry in the manifest". See the module docstring.
    model_allowlist: tuple[str, ...] = ()
    #: Refuse to load a file whose sha256 does not match the manifest. Turning this
    #: off is only ever acceptable while iterating on a local checkout.
    verify_sha256: bool = True

    # --- execution -----------------------------------------------------------
    device: Device = Device.CPU
    #: 0 = let onnxruntime choose (it uses the core count). Pin these in a
    #: container with a CPU limit, or ORT will oversubscribe its cgroup.
    intra_op_threads: Annotated[int, Field(ge=0, le=256)] = 0
    inter_op_threads: Annotated[int, Field(ge=0, le=256)] = 0

    # --- request shape limits ------------------------------------------------
    max_batch_size: Annotated[int, Field(ge=1, le=512)] = 32
    #: Global ceiling; a model's own manifest value wins when it is smaller.
    max_sequence_length: Annotated[int, Field(ge=8, le=8192)] = 512
    max_texts_per_request: Annotated[int, Field(ge=1, le=4096)] = 256
    #: Character guard applied *before* tokenisation, so an adversarial 50 MB
    #: string is a 413/422, not an OOM (see preprocessing/text.py).
    max_input_chars: Annotated[int, Field(ge=16, le=2_000_000)] = 32_000
    max_request_bytes: Annotated[int, Field(ge=1024)] = 8 * 1024 * 1024

    # --- concurrency ---------------------------------------------------------
    max_concurrent_requests: Annotated[int, Field(ge=1, le=256)] = 8
    #: Time a request may wait for a device slot before we return 503 (§49.4).
    #: Shedding load beats queueing behind a caller that has already timed out.
    queue_timeout_s: Annotated[float, Field(gt=0, le=300)] = 10.0
    #: Wall-clock budget for one model execution.
    request_timeout_s: Annotated[float, Field(gt=0, le=600)] = 60.0

    # --- model lifecycle -----------------------------------------------------
    #: LRU eviction budget. Sessions are evicted least-recently-used first once the
    #: sum of the manifest's `resident_mb` estimates would exceed this.
    model_memory_budget_mb: Annotated[int, Field(ge=64)] = 8192
    #: Release a session that has not been used for this long. 0 disables.
    model_idle_release_s: Annotated[float, Field(ge=0, le=86_400)] = 900.0
    #: How often the idle sweeper wakes.
    model_sweep_interval_s: Annotated[float, Field(gt=0, le=3600)] = 60.0
    warmup_on_startup: bool = True

    # --- auth / observability ------------------------------------------------
    #: Empty in local dev. Non-empty is *required* outside `local` (validated below).
    shared_secret: SecretStr = SecretStr("")
    metrics_enabled: bool = True
    #: Deliberately no CORS settings: no browser ever talks to this service. The
    #: browser tier runs its own models (packages/ai-runtime) or goes through
    #: apps/api. Adding CORS here would be a sign the topology went wrong.

    # ------------------------------------------------------------------ #
    # validators
    # ------------------------------------------------------------------ #

    @field_validator("preload_models", "model_allowlist", mode="before")
    @classmethod
    def _coerce_tuple(cls, value: Any) -> tuple[str, ...]:
        return _as_tuple(value)

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
        if self.app_env is not AppEnv.LOCAL and not self.shared_secret.get_secret_value():
            msg = (
                "INFERENCE_SHARED_SECRET must be set when INFERENCE_APP_ENV is not "
                "'local': an unauthenticated inference endpoint will happily embed "
                "anything anyone sends it"
            )
            raise ValueError(msg)
        if self.model_allowlist:
            missing = [m for m in self.preload_models if m not in self.model_allowlist]
            if missing:
                msg = (
                    f"preload_models {missing} are not in model_allowlist; the service "
                    "would fail readiness on every boot"
                )
                raise ValueError(msg)
        return self

    # ------------------------------------------------------------------ #
    # derived
    # ------------------------------------------------------------------ #

    @property
    def manifest_path(self) -> Path:
        """Absolute path of the model manifest."""
        if self.model_manifest_path is not None:
            return self.model_manifest_path
        return self.model_dir / "manifest.json"

    @property
    def execution_providers(self) -> tuple[str, ...]:
        """onnxruntime provider list for :attr:`device`, most specific first."""
        return _PROVIDERS[self.device]

    @property
    def auth_required(self) -> bool:
        return bool(self.shared_secret.get_secret_value())

    def effective_max_length(self, model_max_length: int) -> int:
        """A model never gets a longer sequence than the global ceiling allows."""
        return max(8, min(self.max_sequence_length, model_max_length))

    def is_model_allowed(self, model_id: str) -> bool:
        """Allowlist check. Empty allowlist = defer to manifest membership."""
        return not self.model_allowlist or model_id in self.model_allowlist


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Process-wide settings singleton."""
    return Settings()


def reset_settings_cache() -> None:
    """Drop the singleton. Tests only — production reads the environment once."""
    get_settings.cache_clear()


def settings_from_env(**overrides: Any) -> Settings:
    """Build a Settings instance ignoring ``.env``, for tests and CLI tooling."""
    env = {k: v for k, v in os.environ.items() if not k.startswith("INFERENCE_")}
    previous = dict(os.environ)
    try:
        os.environ.clear()
        os.environ.update(env)
        return Settings(_env_file=None, **overrides)  # type: ignore[call-arg]
    finally:
        os.environ.clear()
        os.environ.update(previous)


__all__ = [
    "REQUEST_ID_HEADER",
    "SECRET_HEADER",
    "AppEnv",
    "Device",
    "Settings",
    "get_settings",
    "reset_settings_cache",
    "settings_from_env",
]
