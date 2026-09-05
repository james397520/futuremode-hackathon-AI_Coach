"""Process-wide service state and the dependencies every route shares.

One object owns the machinery
-----------------------------
:class:`ServiceState` holds the registry, the pool, the loader and the two
kernels, and is stashed on ``app.state.service``. Routes reach it through
:func:`get_state` rather than through module-level globals, which is what lets a
test build a second app with fake session/tokenizer factories in the same
interpreter — no import-time singletons, no monkeypatching.

Warmup is a background task, deliberately
-----------------------------------------
Startup does **not** block on loading models. A model directory that is still
being mounted, a sha256 that takes 20 seconds on a 2 GB graph, or an accelerator
that is not there yet would otherwise turn into "the container never opened its
port", which is the hardest failure to diagnose in a locked-down environment
(§49.4: degrade, do not disappear). Instead the port opens immediately,
``/healthz`` answers, ``/metrics`` answers, and ``/readyz`` reports *warming* —
and then *degraded*, with the reason, if a model never arrives. An orchestrator
keeps the pod out of rotation either way, but a human can now see why.

Auth
----
``shared_secret`` is service-to-service defence in depth: the deployment binds
this service to the private network and the secret covers the case where the
network is flatter than the diagram claims. It is compared with
:func:`hmac.compare_digest` and is never logged (``shared_secret`` is in
:data:`app.core.logging.SENSITIVE_KEYS`, and the header name is not echoed).
Probes and ``/metrics`` are exempt: a kubelet has no credential.
"""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import time
import uuid
from dataclasses import dataclass, field
from enum import StrEnum
from typing import TYPE_CHECKING, Annotated

from fastapi import Depends, Request

from app.core.config import SECRET_HEADER, Settings, get_settings
from app.core.errors import UnauthenticatedError
from app.core.logging import get_logger, log_inference
from app.core.metrics import READY
from app.inference.embedder import Embedder
from app.inference.pool import InferencePool
from app.inference.reranker import Reranker
from app.models.loader import ModelLoader
from app.models.registry import ModelRegistry

if TYPE_CHECKING:
    from app.models.session import SessionFactory
    from app.preprocessing.tokenizer import TokenizerFactory

logger = get_logger(__name__)


def new_request_id() -> str:
    """A fresh request id, same shape as ``apps/api``'s."""
    return uuid.uuid4().hex


class ModelState(StrEnum):
    """What ``/readyz`` and ``/models`` say about one model."""

    #: Resident and warmed: it will serve the next request at full speed.
    READY = "ready"
    #: Resident but not warmed yet (or warmup is disabled by configuration).
    LOADED = "loaded"
    #: Not resident and no failure recorded — it loads on first use.
    AVAILABLE = "available"
    #: A load or warmup attempt failed; ``reason`` carries the error code.
    FAILED = "failed"
    #: In the allowlist / preload list but not in the manifest at all.
    MISSING = "missing"


@dataclass(frozen=True, slots=True)
class ModelStatus:
    """Per-model readiness, safe to serialise: ids and enums only."""

    id: str
    task: str
    state: ModelState
    warm: bool
    preloaded: bool
    reason: str | None = None
    dimension: int | None = None


@dataclass(slots=True)
class WarmupState:
    """Progress of the background preload."""

    started: bool = False
    complete: bool = False
    started_at: float | None = None
    finished_at: float | None = None
    #: model id -> error code for the ones that did not make it.
    failures: dict[str, str] = field(default_factory=dict)

    @property
    def duration_ms(self) -> float | None:
        if self.started_at is None or self.finished_at is None:
            return None
        return round((self.finished_at - self.started_at) * 1000, 3)


class ServiceState:
    """Everything the request path needs, built once per application."""

    def __init__(
        self,
        settings: Settings,
        *,
        session_factory: SessionFactory | None = None,
        tokenizer_factory: TokenizerFactory | None = None,
    ) -> None:
        self.settings = settings
        self.registry = ModelRegistry(settings)
        self.pool = InferencePool(
            capacity=settings.max_concurrent_requests,
            queue_timeout_s=settings.queue_timeout_s,
            request_timeout_s=settings.request_timeout_s,
        )
        self.loader = ModelLoader(
            settings=settings,
            registry=self.registry,
            pool=self.pool,
            session_factory=session_factory,
            tokenizer_factory=tokenizer_factory,
        )
        self.embedder = Embedder(settings=settings, loader=self.loader, pool=self.pool)
        self.reranker = Reranker(settings=settings, loader=self.loader, pool=self.pool)
        self.warmup = WarmupState()
        self._warmup_task: asyncio.Task[None] | None = None
        self._warm_event = asyncio.Event()
        READY.set(0)

    # ------------------------------------------------------------------ #
    # lifecycle
    # ------------------------------------------------------------------ #

    async def start(self) -> None:
        """Load the manifest, bind the pool, and kick off warmup in the background."""
        self.pool.bind_loop()
        # Reading and hashing the manifest is blocking file I/O.
        await asyncio.to_thread(self.registry.load)
        self.loader.start_sweeper()
        if self._warmup_task is None:
            self.warmup.started = True
            self.warmup.started_at = time.monotonic()
            self._warmup_task = asyncio.create_task(self._warm(), name="model-warmup")

    async def _warm(self) -> None:
        try:
            failures = await self.loader.preload()
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - warmup must never take the app down
            logger.error(
                "warmup.failed",
                error_type=type(exc).__name__,
                reason="unexpected",
            )
            failures = {model_id: "internal_error" for model_id in self.settings.preload_models}
        self.warmup.failures = failures
        self.warmup.finished_at = time.monotonic()
        self.warmup.complete = True
        self._warm_event.set()
        log_inference(
            logger,
            "warmup.completed",
            device=self.settings.device.value,
            loaded_models=len(self.loader.loaded_ids()),
            item_count=len(failures),
            duration_ms=self.warmup.duration_ms or 0.0,
            reason="degraded" if failures else "ok",
        )
        READY.set(1 if self.is_ready else 0)

    async def wait_until_warm(self, timeout: float = 30.0) -> bool:
        """Block until the background warmup finishes. For tests and CLI tooling."""
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._warm_event.wait(), timeout=timeout)
        return self.warmup.complete

    async def aclose(self) -> None:
        """Cancel warmup, release every session, drain the pool."""
        task = self._warmup_task
        self._warmup_task = None
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        await self.loader.aclose()
        await self.pool.aclose()
        READY.set(0)

    # ------------------------------------------------------------------ #
    # readiness
    # ------------------------------------------------------------------ #

    def model_statuses(self) -> tuple[ModelStatus, ...]:
        """Per-model load state, for ``/readyz`` and ``/models``.

        Covers the union of the manifest and the preload list, so a preload
        target that is missing from the manifest is *visible* rather than simply
        absent — that is the difference between "readiness is red" and "readiness
        is red and here is why".
        """
        stats = self.loader.stats()
        loaded = set(stats.loaded)
        warm = set(stats.warm)
        statuses: list[ModelStatus] = []
        seen: set[str] = set()
        for entry in self.registry.entries():
            seen.add(entry.id)
            failure = stats.load_failures.get(entry.id)
            if failure is not None:
                state = ModelState.FAILED
            elif entry.id in warm:
                state = ModelState.READY
            elif entry.id in loaded:
                state = ModelState.LOADED
            else:
                state = ModelState.AVAILABLE
            statuses.append(
                ModelStatus(
                    id=entry.id,
                    task=entry.task.value,
                    state=state,
                    warm=entry.id in warm,
                    preloaded=entry.id in self.settings.preload_models,
                    reason=failure,
                    dimension=entry.dimension,
                )
            )
        for model_id in self.settings.preload_models:
            if model_id in seen:
                continue
            statuses.append(
                ModelStatus(
                    id=model_id,
                    task="unknown",
                    state=ModelState.MISSING,
                    warm=False,
                    preloaded=True,
                    reason=self.warmup.failures.get(model_id, "not_in_manifest"),
                )
            )
        return tuple(sorted(statuses, key=lambda status: status.id))

    @property
    def is_ready(self) -> bool:
        """Honest readiness: every preload target resident and warm, manifest good.

        Not ready while models are still loading, and not ready when one of them
        failed — a half-loaded service that answers ``/embed`` with a 503 on every
        second request is worse than one the load balancer skips.
        """
        if self.registry.load_error is not None:
            return False
        if not self.warmup.complete or self.warmup.failures:
            return False
        targets = self.settings.preload_models
        if not targets:
            # Nothing to preload: readiness reduces to "the manifest is usable".
            return len(self.registry) > 0
        warm = set(self.loader.stats().warm)
        return all(model_id in warm or self.loader.is_loaded(model_id) for model_id in targets)

    @property
    def status_word(self) -> str:
        if self.is_ready:
            return "ready"
        if not self.warmup.complete:
            return "warming"
        return "degraded"


def build_state(
    settings: Settings | None = None,
    *,
    session_factory: SessionFactory | None = None,
    tokenizer_factory: TokenizerFactory | None = None,
) -> ServiceState:
    """Construct the service state. Factories are injected by the test suite."""
    return ServiceState(
        settings or get_settings(),
        session_factory=session_factory,
        tokenizer_factory=tokenizer_factory,
    )


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------


def get_state(request: Request) -> ServiceState:
    """The application's :class:`ServiceState`."""
    state: ServiceState = request.app.state.service
    return state


def get_request_id(request: Request) -> str:
    """The id assigned by the request-context middleware."""
    value = getattr(request.state, "request_id", "")
    return value if isinstance(value, str) else ""


def _presented_secret(request: Request) -> str:
    """Read the credential from either accepted location."""
    header = request.headers.get(SECRET_HEADER)
    if header:
        return header.strip()
    authorization = request.headers.get("Authorization", "")
    if authorization[:7].lower() == "bearer ":
        return authorization[7:].strip()
    return ""


async def require_service_auth(request: Request) -> None:
    """Reject a caller without the shared secret, when one is configured.

    A `local` deployment with no secret is open by design (see
    :class:`~app.core.config.Settings`); every other environment fails settings
    validation at import time unless a secret is set, so there is no
    configuration in which this silently becomes a no-op in production.
    """
    settings: Settings = request.app.state.service.settings
    if not settings.auth_required:
        return
    expected = settings.shared_secret.get_secret_value()
    if not hmac.compare_digest(_presented_secret(request), expected):
        raise UnauthenticatedError(
            "A valid service credential is required.",
            headers={"WWW-Authenticate": "Bearer"},
            # No echo of what was presented: it may be a real credential.
            log_context={"reason": "bad_service_credential"},
        )


StateDep = Annotated[ServiceState, Depends(get_state)]
RequestIdDep = Annotated[str, Depends(get_request_id)]
AuthDep = Annotated[None, Depends(require_service_auth)]


__all__ = [
    "AuthDep",
    "ModelState",
    "ModelStatus",
    "RequestIdDep",
    "ServiceState",
    "StateDep",
    "WarmupState",
    "build_state",
    "get_request_id",
    "get_state",
    "new_request_id",
    "require_service_auth",
]
