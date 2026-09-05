"""Async job plumbing (spec §64 Jobs, §49.4 reliability).

The design goal is that a job handler is an ordinary `async def` that knows nothing
about Celery:

    @job("document.process", max_retries=3)
    async def process_document(ctx: JobContext, payload: Mapping[str, Any]) -> ...

`JobQueue` then has two implementations:

* `CeleryQueue` — production. `enqueue()` returns immediately with a task id; the
  worker runs `run_job` which looks the handler up in `HANDLERS` and drives it with
  `asyncio.run`. Retries use Celery's own `retry(countdown=...)` with the exponential
  backoff computed by `backoff_seconds()` (§49.4).
* `InlineQueue` — dev/CI. Awaits the handler in-process, so the whole document
  pipeline is testable without a broker.

A job payload always carries `tenant_id` / `workspace_id` / `user_id`, and
`JobContext` reconstructs a `RequestContext`-shaped object from it — a worker must
never operate without a tenant scope (§10, §74).
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

import structlog

log = structlog.get_logger(__name__)

MAX_RETRIES = 3
BASE_BACKOFF_SECONDS = 5
MAX_BACKOFF_SECONDS = 600


@dataclass(slots=True)
class JobContext:
    """Tenant scope + identity for a background job.

    Duck-types `app.core.context.RequestContext` (`tenant_id`, `workspace_id`,
    `user_id`, `roles`, `request_id`) so services accept it unchanged.
    """

    tenant_id: str
    workspace_id: str
    user_id: str = "system"
    roles: tuple[str, ...] = ("admin",)
    request_id: str = ""
    job_name: str = ""
    attempt: int = 1

    @classmethod
    def from_payload(
        cls, payload: Mapping[str, Any], *, job_name: str = "", attempt: int = 1
    ) -> JobContext:
        tenant_id = str(payload.get("tenant_id") or "")
        workspace_id = str(payload.get("workspace_id") or "")
        if not tenant_id or not workspace_id:
            raise JobPayloadError(
                f"job '{job_name}' payload is missing tenant_id/workspace_id; "
                "a worker must never run unscoped"
            )
        return cls(
            tenant_id=tenant_id,
            workspace_id=workspace_id,
            # Jobs run as the platform, not as the uploader, but the uploader is kept
            # for the audit trail.
            user_id=str(payload.get("user_id") or "system"),
            roles=tuple(payload.get("roles") or ("admin",)),
            request_id=str(payload.get("request_id") or f"job_{uuid.uuid4().hex[:12]}"),
            job_name=job_name,
            attempt=attempt,
        )


class JobPayloadError(ValueError):
    """The payload is unusable — retrying will not help."""


class JobRetry(Exception):
    """Raised by a handler to request a retry with backoff."""

    def __init__(self, reason: str, *, countdown: int | None = None) -> None:
        super().__init__(reason)
        self.reason = reason
        self.countdown = countdown


JobHandler = Callable[[JobContext, Mapping[str, Any]], Awaitable[Any]]


@dataclass(slots=True)
class JobSpec:
    name: str
    handler: JobHandler
    max_retries: int = MAX_RETRIES
    #: soft time limit in seconds
    timeout_s: float = 900.0
    queue: str = "default"


HANDLERS: dict[str, JobSpec] = {}


def job(
    name: str,
    *,
    max_retries: int = MAX_RETRIES,
    timeout_s: float = 900.0,
    queue: str = "default",
) -> Callable[[JobHandler], JobHandler]:
    """Register an async handler under a job name."""

    def decorator(handler: JobHandler) -> JobHandler:
        if name in HANDLERS:
            log.warning("job.handler_replaced", job=name)
        HANDLERS[name] = JobSpec(
            name=name, handler=handler, max_retries=max_retries, timeout_s=timeout_s, queue=queue
        )
        return handler

    return decorator


def backoff_seconds(attempt: int) -> int:
    """Exponential backoff with a cap (§49.4)."""
    return min(BASE_BACKOFF_SECONDS * (2 ** max(attempt - 1, 0)), MAX_BACKOFF_SECONDS)


@runtime_checkable
class JobQueue(Protocol):
    async def enqueue(
        self, name: str, payload: Mapping[str, Any], *, delay_s: int = 0
    ) -> str | None: ...


class InlineQueue:
    """Runs handlers in-process. Dev, CI and tests."""

    def __init__(self, *, record_only: bool = False) -> None:
        self.record_only = record_only
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.results: dict[str, Any] = {}

    async def enqueue(
        self, name: str, payload: Mapping[str, Any], *, delay_s: int = 0
    ) -> str | None:
        self.calls.append((name, dict(payload)))
        if self.record_only:
            return None
        job_id = f"inline_{uuid.uuid4().hex[:12]}"
        self.results[job_id] = await run_handler(name, payload)
        return job_id


class CeleryQueue:
    """Production queue. Broker + result backend are the Redis instance from §64."""

    def __init__(self, app: Any | None = None) -> None:
        self._app = app

    def app(self) -> Any:
        if self._app is None:
            self._app = get_celery()
        return self._app

    async def enqueue(
        self, name: str, payload: Mapping[str, Any], *, delay_s: int = 0
    ) -> str | None:
        spec = HANDLERS.get(name)
        task = self.app().signature(
            "app.workers.queue.run_job",
            kwargs={"name": name, "payload": dict(payload)},
            queue=spec.queue if spec is not None else "default",
        )
        # `apply_async` is synchronous but non-blocking (it only publishes), so a
        # thread hand-off would add latency without removing any blocking I/O.
        result = task.apply_async(countdown=delay_s or None)
        return str(getattr(result, "id", "") or "")


_CELERY: Any | None = None


def get_celery() -> Any:
    """Build (once) the Celery app. Config comes from settings, never from env here."""
    global _CELERY
    if _CELERY is not None:
        return _CELERY
    from celery import Celery

    try:
        from app.core.config import get_settings  # assumed: app.core.config.get_settings

        settings = get_settings()
        broker = str(getattr(settings, "redis_url", "redis://redis:6379/0"))
    except Exception:  # noqa: BLE001 - allow a worker to boot with defaults
        broker = "redis://redis:6379/0"
    app = Celery("ai_coach", broker=broker, backend=broker)
    app.conf.update(
        task_acks_late=True,
        task_reject_on_worker_lost=True,
        worker_prefetch_multiplier=1,
        task_track_started=True,
        result_expires=3600,
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        timezone="UTC",
        beat_schedule={
            # §40.2 data retention / deletion sweep
            "retention-sweep": {
                "task": "app.workers.queue.run_job",
                "schedule": 24 * 60 * 60.0,
                "kwargs": {"name": "retention.sweep", "payload": {"scope": "all"}},
            }
        },
    )
    _CELERY = app
    _register_celery_task(app)
    return app


def _register_celery_task(app: Any) -> None:
    @app.task(
        bind=True,
        name="app.workers.queue.run_job",
        max_retries=MAX_RETRIES,
        acks_late=True,
    )
    def run_job(self: Any, name: str, payload: dict[str, Any]) -> Any:  # pragma: no cover
        attempt = int(getattr(self.request, "retries", 0)) + 1
        try:
            return asyncio.run(run_handler(name, payload, attempt=attempt))
        except JobPayloadError:
            raise  # not retryable
        except JobRetry as retry:
            countdown = retry.countdown or backoff_seconds(attempt)
            raise self.retry(exc=retry, countdown=countdown) from retry
        except Exception as exc:
            spec = HANDLERS.get(name)
            limit = spec.max_retries if spec is not None else MAX_RETRIES
            if attempt > limit:
                log.error("job.failed_permanently", job=name, attempts=attempt, error=repr(exc))
                raise
            raise self.retry(exc=exc, countdown=backoff_seconds(attempt)) from exc


async def run_handler(
    name: str, payload: Mapping[str, Any], *, attempt: int = 1
) -> Any:
    """Look up and run a handler with its timeout and a scoped context."""
    spec = HANDLERS.get(name)
    if spec is None:
        # Import the job modules lazily so registration happens on first use without
        # a circular import at module load.
        _load_handlers()
        spec = HANDLERS.get(name)
    if spec is None:
        raise JobPayloadError(f"no handler registered for job '{name}'")
    ctx = JobContext.from_payload(payload, job_name=name, attempt=attempt)
    log.info("job.start", job=name, attempt=attempt, tenant=ctx.tenant_id)
    try:
        async with asyncio.timeout(spec.timeout_s):
            result = await spec.handler(ctx, payload)
    except TimeoutError as exc:
        log.warning("job.timeout", job=name, attempt=attempt, limit_s=spec.timeout_s)
        raise JobRetry(f"job '{name}' exceeded {spec.timeout_s}s") from exc
    log.info("job.done", job=name, attempt=attempt)
    return result


def _load_handlers() -> None:
    import importlib

    for module in (
        "app.workers.document_jobs",
        "app.workers.evaluation_jobs",
        "app.workers.mining_jobs",
        "app.workers.retention_jobs",
    ):
        try:
            importlib.import_module(module)
        except Exception as exc:  # noqa: BLE001 - one broken module must not hide others
            log.warning("job.module_import_failed", module=module, error=repr(exc))


_QUEUE: JobQueue | None = None


def get_queue() -> JobQueue:
    """Process-wide queue. `inline` for dev/CI, Celery otherwise."""
    global _QUEUE
    if _QUEUE is not None:
        return _QUEUE
    mode = "celery"
    try:
        from app.core.config import get_settings

        mode = str(getattr(get_settings(), "job_queue", "celery")).lower()
    except Exception:  # noqa: BLE001
        mode = "celery"
    _QUEUE = InlineQueue() if mode == "inline" else CeleryQueue()
    return _QUEUE


def set_queue(queue: JobQueue | None) -> None:
    """Test seam: install a fake queue (or reset with `None`)."""
    global _QUEUE
    _QUEUE = queue


def registered_jobs() -> Sequence[str]:
    _load_handlers()
    return tuple(sorted(HANDLERS))


__all__ = [
    "BASE_BACKOFF_SECONDS",
    "HANDLERS",
    "MAX_RETRIES",
    "CeleryQueue",
    "InlineQueue",
    "JobContext",
    "JobPayloadError",
    "JobQueue",
    "JobRetry",
    "JobSpec",
    "backoff_seconds",
    "get_celery",
    "get_queue",
    "job",
    "registered_jobs",
    "run_handler",
    "set_queue",
]
