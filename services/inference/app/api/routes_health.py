"""Liveness, readiness and the metrics scrape.

Mirrors ``apps/api/app/api/health.py``'s split, with the same paths so one probe
configuration works for both services:

* ``GET /healthz`` — **liveness**. Process state only. It never touches the
  registry, the loader or the device, because a model that failed to load is not
  a reason to restart the container: the restart would hit the same missing file
  and the pod would crash-loop instead of reporting a diagnosable "degraded".
* ``GET /readyz`` — **readiness**. Honest about what is actually usable: not
  ready while models are still loading, not ready when one of them failed, and
  the body says which model, in what state, with which failure code.

``/health/live`` and ``/health/ready`` are registered as aliases because that is
how the registry and loader modules refer to them in their docstrings.

Both are unauthenticated — a kubelet has no service credential — and therefore
expose only names, enums, booleans and numbers (§49.5). No model input, no file
paths, no manifest contents.
"""

from __future__ import annotations

from typing import Final

from fastapi import APIRouter, Response, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ConfigDict

from app import __version__
from app.api.deps import ModelState, StateDep
from app.core.metrics import READY, REGISTRY


router = APIRouter(tags=["health"])

#: Exposition format for the Prometheus text protocol.
_PROMETHEUS_CONTENT_TYPE: Final[str] = "text/plain; version=0.0.4; charset=utf-8"


class HealthResponse(BaseModel):
    """Liveness body. Identical fields to ``apps/api``'s."""

    status: str
    version: str
    app_env: str
    service: str = "inference"


class ModelHealth(BaseModel):
    """One model's load state."""

    id: str
    task: str
    state: ModelState
    warm: bool
    #: True when this model is in ``preload_models`` and readiness depends on it.
    preloaded: bool
    #: Error code when ``state`` is ``failed`` or ``missing``; otherwise null.
    reason: str | None = None
    dimension: int | None = None


class WarmupHealth(BaseModel):
    started: bool
    complete: bool
    duration_ms: float | None = None
    #: model id -> error code, for the preload targets that did not make it.
    failures: dict[str, str]


class RuntimeHealth(BaseModel):
    """Where inference actually runs, and how loaded it is."""

    device: str
    #: onnxruntime provider preference order for ``device``, most specific first.
    execution_providers: list[str]
    capacity: int
    in_flight: int
    queued: int
    resident_mb: float
    budget_mb: float


class ManifestHealth(BaseModel):
    """Registry state. ``error`` is operator-facing configuration text only."""

    ok: bool
    model_count: int
    error: str | None = None


class ReadinessResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    #: ``ready`` | ``warming`` | ``degraded``.
    status: str
    version: str
    app_env: str
    service: str = "inference"
    warmup: WarmupHealth
    manifest: ManifestHealth
    runtime: RuntimeHealth
    models: list[ModelHealth]


@router.get(
    "/healthz",
    response_model=HealthResponse,
    summary="Liveness probe (no dependency calls)",
)
async def liveness(state: StateDep) -> HealthResponse:
    """Answers from process state alone, even with no model on disk."""
    return HealthResponse(
        status="ok",
        version=__version__,
        app_env=state.settings.app_env.value,
    )


@router.get(
    "/readyz",
    response_model=ReadinessResponse,
    summary="Readiness probe: per-model load state, device and warmup status",
)
async def readiness(response: Response, state: StateDep) -> ReadinessResponse:
    """503 until every preloaded model is resident and warm.

    The body is always complete — the failure case is the one worth reading.
    """
    settings = state.settings
    pool_stats = state.pool.stats()
    loader_stats = state.loader.stats()
    ready = state.is_ready
    READY.set(1 if ready else 0)
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return ReadinessResponse(
        status=state.status_word,
        version=__version__,
        app_env=settings.app_env.value,
        warmup=WarmupHealth(
            started=state.warmup.started,
            complete=state.warmup.complete,
            duration_ms=state.warmup.duration_ms,
            failures=dict(state.warmup.failures),
        ),
        manifest=ManifestHealth(
            ok=state.registry.load_error is None,
            model_count=len(state.registry),
            error=state.registry.load_error,
        ),
        runtime=RuntimeHealth(
            device=settings.device.value,
            execution_providers=list(settings.execution_providers),
            capacity=pool_stats.capacity,
            in_flight=pool_stats.in_flight,
            queued=pool_stats.queued,
            resident_mb=loader_stats.resident_mb,
            budget_mb=loader_stats.budget_mb,
        ),
        models=[
            ModelHealth(
                id=item.id,
                task=item.task,
                state=item.state,
                warm=item.warm,
                preloaded=item.preloaded,
                reason=item.reason,
                dimension=item.dimension,
            )
            for item in state.model_statuses()
        ],
    )


@router.get(
    "/health/live",
    response_model=HealthResponse,
    include_in_schema=False,
    summary="Alias of /healthz",
)
async def liveness_alias(state: StateDep) -> HealthResponse:
    return await liveness(state)


@router.get(
    "/health/ready",
    response_model=ReadinessResponse,
    include_in_schema=False,
    summary="Alias of /readyz",
)
async def readiness_alias(response: Response, state: StateDep) -> ReadinessResponse:
    return await readiness(response, state)


@router.get(
    "/metrics",
    response_class=PlainTextResponse,
    include_in_schema=False,
    summary="Prometheus exposition for this service's private registry",
)
async def metrics(state: StateDep) -> Response:
    """Scrape endpoint.

    Reads the private registry from :mod:`app.core.metrics`, not the global
    default one, so importing the app twice in one interpreter (the test suite
    does) cannot raise "Duplicated timeseries". Every series here is a count, a
    gauge or a latency — nothing is derived from request content.
    """
    if not state.settings.metrics_enabled:
        return PlainTextResponse(
            "metrics are disabled on this deployment\n",
            status_code=status.HTTP_404_NOT_FOUND,
        )
    from prometheus_client import generate_latest

    return Response(
        content=generate_latest(REGISTRY),
        media_type=_PROMETHEUS_CONTENT_TYPE,
    )


__all__ = [
    "HealthResponse",
    "ManifestHealth",
    "ModelHealth",
    "ReadinessResponse",
    "RuntimeHealth",
    "WarmupHealth",
    "router",
]
