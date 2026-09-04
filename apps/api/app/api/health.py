"""Liveness and readiness probes.

* ``GET /healthz`` — liveness. Answers from process state only; it must never touch a
  dependency, otherwise a Redis blip would make Kubernetes kill healthy pods.
* ``GET /readyz`` — readiness. Probes Postgres, Redis, Qdrant and object storage in
  parallel with a hard timeout and reports 503 when any is down, so a starting or
  degraded replica is pulled out of the load balancer instead of failing requests.

Both routes are unauthenticated (a probe has no session) and therefore expose no
tenant data: only dependency names, booleans and latencies (§49.5).
"""

from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING, Final

import httpx
from fastapi import APIRouter, Response, status

from app import __version__
from app.core.config import Settings, get_settings
from app.core.logging import get_logger
from app.core.rate_limit import ping_redis
from app.db.session import ping_database
from app.domain.request_response import (
    DependencyHealth,
    HealthResponse,
    ReadinessResponse,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

router = APIRouter(tags=["health"])
logger = get_logger(__name__)

PROBE_TIMEOUT_SECONDS: Final[float] = 3.0


async def _timed(name: str, probe: Callable[[], Awaitable[bool]]) -> DependencyHealth:
    """Run one probe with a timeout, never letting an exception escape."""
    started = time.perf_counter()
    try:
        ok = await asyncio.wait_for(probe(), timeout=PROBE_TIMEOUT_SECONDS)
        detail = None if ok else "probe returned false"
    except TimeoutError:
        ok, detail = False, "timeout"
    except Exception as exc:
        ok = False
        # Only the exception *type* is surfaced: a driver message can contain a DSN.
        detail = type(exc).__name__
        logger.warning("readiness_probe_failed", dependency=name, exc_info=exc)
    return DependencyHealth(
        name=name, ok=ok, latency_ms=(time.perf_counter() - started) * 1000, detail=detail
    )


async def _probe_qdrant(settings: Settings) -> bool:
    async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_SECONDS) as client:
        response = await client.get(f"{settings.qdrant_url.rstrip('/')}/readyz")
    return response.status_code < 500


async def _probe_object_storage(settings: Settings) -> bool:
    """``head_bucket`` via boto3, off the event loop (botocore is blocking)."""

    def _head() -> bool:
        import boto3

        client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key.get_secret_value(),
            region_name=settings.s3_region,
        )
        client.head_bucket(Bucket=settings.s3_bucket)
        return True

    return await asyncio.to_thread(_head)


@router.get(
    "/healthz",
    response_model=HealthResponse,
    summary="Liveness probe (no dependency calls)",
)
async def liveness() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(status="ok", version=__version__, app_env=settings.app_env)


@router.get(
    "/readyz",
    response_model=ReadinessResponse,
    summary="Readiness probe: Postgres, Redis, Qdrant, object storage",
)
async def readiness(response: Response) -> ReadinessResponse:
    """503 when any dependency is unavailable; the body always lists every probe."""
    settings = get_settings()
    dependencies = await asyncio.gather(
        _timed("postgres", lambda: ping_database(settings)),
        _timed("redis", lambda: ping_redis(settings)),
        _timed("qdrant", lambda: _probe_qdrant(settings)),
        _timed("object_storage", lambda: _probe_object_storage(settings)),
    )
    healthy = all(dependency.ok for dependency in dependencies)
    if not healthy:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return ReadinessResponse(
        status="ready" if healthy else "degraded", dependencies=list(dependencies)
    )
