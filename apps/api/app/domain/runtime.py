"""Client runtime capability + policy models (spec §44 / §59 / §61 / §62).

Mirrors ``packages/shared/src/runtime.ts``.

WARNING — camelCase fields: ``runtime.ts`` declares ``ComputeCapability`` with
camelCase keys (``wasmSimd``, ``memoryClass``, ``selectedBackend``, ``adapterInfo``)
because it is produced by browser code. The mirror below keeps those exact wire names
via aliases, so the models validate the browser payload verbatim. Everything else in
the contract is snake_case.

Runtime telemetry must never carry conversation content or PII (§49.5 / §97).
"""

from __future__ import annotations

from pydantic import AliasChoices, ConfigDict, Field

from app.domain.common import DomainModel
from app.domain.enums import ComputeBackend, LocalTask, MemoryClass, WebGpuMode


class AdapterInfo(DomainModel):
    """``ComputeCapability.adapterInfo`` — GPU adapter description, no identifiers."""

    vendor: str | None = None
    architecture: str | None = None


class ComputeCapability(DomainModel):
    """§59 WebGPU capability object reported by the browser."""

    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
        serialize_by_alias=True,
        validate_assignment=True,
    )

    webgpu: bool
    wasm_simd: bool = Field(
        validation_alias=AliasChoices("wasmSimd", "wasm_simd"),
        serialization_alias="wasmSimd",
    )
    worker: bool
    memory_class: MemoryClass = Field(
        validation_alias=AliasChoices("memoryClass", "memory_class"),
        serialization_alias="memoryClass",
    )
    selected_backend: ComputeBackend = Field(
        validation_alias=AliasChoices("selectedBackend", "selected_backend"),
        serialization_alias="selectedBackend",
    )
    adapter_info: AdapterInfo | None = Field(
        default=None,
        validation_alias=AliasChoices("adapterInfo", "adapter_info"),
        serialization_alias="adapterInfo",
    )


class LocalModelFile(DomainModel):
    """One downloadable artefact of a local model manifest."""

    url: str
    bytes: int = Field(ge=0)
    sha256: str | None = None


class LocalModelManifest(DomainModel):
    """§60 model lifecycle manifest for a client-side task."""

    task: LocalTask
    model_id: str
    files: list[LocalModelFile] = Field(default_factory=list)
    quantization: str | None = None
    dimension: int | None = Field(default=None, ge=1)


class RuntimeTelemetry(DomainModel):
    """§49.5 runtime telemetry — timings and backend only, never content."""

    backend: ComputeBackend
    model_id: str | None = None
    load_ms: float | None = Field(default=None, ge=0)
    last_inference_ms: float | None = Field(default=None, ge=0)
    worker_alive: bool
    fallback_reason: str | None = Field(
        default=None,
        max_length=200,
        description="Short machine-readable reason (e.g. 'device_lost'); never user text",
    )


class RuntimePolicy(DomainModel):
    """§61 enterprise security mode — served to the client by ``GET /api/v1/runtime/policy``."""

    webgpu: WebGpuMode
    allow_local_model_cache: bool
    allow_sensitive_data_cache: bool
    clear_on_logout: bool
