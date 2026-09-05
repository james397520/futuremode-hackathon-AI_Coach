"""Lazy loading, LRU eviction, idle release and warmup.

Four problems, one object
-------------------------
1. **Loading is expensive and must happen once.** A 2 GB graph takes seconds to
   hash and open. Two concurrent first requests for the same model must not both
   load it — that doubles peak memory at exactly the wrong moment. A per-model
   :class:`asyncio.Lock` serialises loads of the *same* model while leaving loads
   of *different* models concurrent.
2. **Memory is finite.** ``model_memory_budget_mb`` caps the estimated resident
   weight bytes; exceeding it evicts least-recently-used sessions first. The
   estimate comes from the manifest rather than from measurement because
   measuring resident set size per session is not portable and, on a GPU, not
   visible to the process at all.
3. **An idle model should not hold a GPU hostage.** A sweeper releases sessions
   untouched for ``model_idle_release_s``. Preloaded models are exempt: they are
   what readiness is defined against, and releasing one would make
   ``/health/ready`` flap.
4. **The first real request should not pay for warmup.** onnxruntime defers a
   lot of work to the first ``run`` (arena allocation, provider compilation —
   MIGraphX in particular compiles kernels on first execution). :meth:`warmup`
   pays that cost at boot, inside the pool, so the p99 of the first user request
   is not 3 seconds.

Loading is CPU-bound and blocking (hashing, ORT session construction), so it
runs in a worker thread via :func:`asyncio.to_thread` and never on the loop.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import numpy as np

from app.core.errors import (
    InferenceServiceError,
    ModelLoadError,
)
from app.core.logging import get_logger, log_inference
from app.core.metrics import (
    MODEL_EVICTIONS,
    MODEL_LOADS,
    MODELS_LOADED,
    RESIDENT_MB,
)
from app.models.registry import ModelTask
from app.models.session import batch_feeds, create_session, select_output
from app.preprocessing.tokenizer import TokenizedText, create_tokenizer, pad_batch

if TYPE_CHECKING:
    from app.core.config import Settings
    from app.inference.pool import InferencePool
    from app.models.registry import ModelEntry, ModelRegistry
    from app.models.session import SessionFactory, SessionPort
    from app.preprocessing.tokenizer import TokenizerFactory, TokenizerPort

logger = get_logger(__name__)


@dataclass(slots=True)
class LoadedModel:
    """A resident model: its manifest entry, its session and its tokenizer."""

    entry: ModelEntry
    session: SessionPort
    tokenizer: TokenizerPort
    pad_id: int
    resident_mb: float
    loaded_at: float
    last_used_at: float
    warm: bool = False
    #: Requests served since load — useful when deciding what to keep.
    use_count: int = 0

    def touch(self) -> None:
        self.last_used_at = time.monotonic()
        self.use_count += 1

    @property
    def idle_s(self) -> float:
        return time.monotonic() - self.last_used_at


@dataclass(slots=True)
class LoaderStats:
    loaded: tuple[str, ...] = ()
    warm: tuple[str, ...] = ()
    resident_mb: float = 0.0
    budget_mb: float = 0.0
    load_failures: dict[str, str] = field(default_factory=dict)


class ModelLoader:
    """Owns every resident model session in the process."""

    def __init__(
        self,
        *,
        settings: Settings,
        registry: ModelRegistry,
        pool: InferencePool,
        session_factory: SessionFactory | None = None,
        tokenizer_factory: TokenizerFactory | None = None,
    ) -> None:
        self._settings = settings
        self._registry = registry
        self._pool = pool
        self._session_factory: SessionFactory = session_factory or create_session
        self._tokenizer_factory: TokenizerFactory = tokenizer_factory or create_tokenizer
        #: Insertion order is LRU order: re-inserted on every use.
        self._loaded: dict[str, LoadedModel] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._locks_guard = asyncio.Lock()
        #: Last load failure per model, so `/health/ready` can say *why*.
        self._failures: dict[str, str] = {}
        self._sweeper: asyncio.Task[None] | None = None
        self._closed = False

    # ------------------------------------------------------------------ #
    # introspection
    # ------------------------------------------------------------------ #

    @property
    def resident_mb(self) -> float:
        return round(sum(m.resident_mb for m in self._loaded.values()), 2)

    def is_loaded(self, model_id: str) -> bool:
        """True when the model (by canonical id or alias) is resident."""
        if model_id in self._loaded:
            return True
        for entry in self._registry.entries():
            if model_id in entry.all_ids:
                return entry.id in self._loaded
        return False

    def loaded_ids(self) -> tuple[str, ...]:
        return tuple(self._loaded)

    def stats(self) -> LoaderStats:
        return LoaderStats(
            loaded=tuple(self._loaded),
            warm=tuple(k for k, v in self._loaded.items() if v.warm),
            resident_mb=self.resident_mb,
            budget_mb=float(self._settings.model_memory_budget_mb),
            load_failures=dict(self._failures),
        )

    # ------------------------------------------------------------------ #
    # acquisition
    # ------------------------------------------------------------------ #

    async def get(self, model_id: str, *, task: ModelTask | None = None) -> LoadedModel:
        """Resolve, load if necessary, and return a resident model.

        Raises the typed errors from :mod:`app.core.errors`: an unknown or
        disallowed id, a sha256 mismatch, a missing file or a runtime refusal all
        surface as themselves rather than as a 500.
        """
        entry = self._registry.resolve(model_id, task=task)
        existing = self._loaded.get(entry.id)
        if existing is not None:
            existing.touch()
            # Refresh LRU position.
            self._loaded[entry.id] = self._loaded.pop(entry.id)
            return existing

        lock = await self._lock_for(entry.id)
        async with lock:
            # Re-check: another coroutine may have loaded it while we waited.
            existing = self._loaded.get(entry.id)
            if existing is not None:
                existing.touch()
                return existing
            model = await self._load(entry)
            model.touch()
            return model

    async def _lock_for(self, model_id: str) -> asyncio.Lock:
        async with self._locks_guard:
            lock = self._locks.get(model_id)
            if lock is None:
                lock = asyncio.Lock()
                self._locks[model_id] = lock
            return lock

    async def _load(self, entry: ModelEntry) -> LoadedModel:
        if self._closed:
            raise ModelLoadError(
                "The service is shutting down and is not loading models.",
                log_context={"model": entry.id, "reason": "loader_closed"},
            )
        started = time.perf_counter()
        # Make room *before* allocating, not after.
        await self._evict_for(entry.estimated_resident_mb, keeping=entry.id)

        try:
            session, tokenizer, pad_id = await asyncio.to_thread(self._blocking_load, entry)
        except InferenceServiceError as exc:
            self._failures[entry.id] = exc.code.value
            MODEL_LOADS.labels(model=entry.id, outcome=exc.code.value).inc()
            log_inference(
                logger,
                "loader.load_failed",
                model=entry.id,
                code=exc.code.value,
                reason=str(exc.log_context.get("reason", "unknown")),
            )
            raise

        model = LoadedModel(
            entry=entry,
            session=session,
            tokenizer=tokenizer,
            pad_id=pad_id,
            resident_mb=entry.estimated_resident_mb,
            loaded_at=time.monotonic(),
            last_used_at=time.monotonic(),
        )
        self._loaded[entry.id] = model
        self._failures.pop(entry.id, None)
        MODEL_LOADS.labels(model=entry.id, outcome="ok").inc()
        self._publish_gauges()
        log_inference(
            logger,
            "loader.loaded",
            model=entry.id,
            model_task=entry.task.value,
            device=self._settings.device.value,
            resident_mb=model.resident_mb,
            loaded_models=len(self._loaded),
            duration_ms=round((time.perf_counter() - started) * 1000, 3),
        )
        return model

    def _blocking_load(self, entry: ModelEntry) -> tuple[SessionPort, TokenizerPort, int]:
        """Hash-verify, then build the session and tokenizer. Worker thread only."""
        paths = self._registry.verify(entry)
        tokenizer = self._tokenizer_factory(
            tokenizer_path=paths[entry.tokenizer_file],
            entry=entry,
        )
        session = self._session_factory(
            model_path=paths[entry.model_file],
            settings=self._settings,
            model_id=entry.id,
        )
        pad_id = int(getattr(tokenizer, "pad_id", 0))
        return session, tokenizer, pad_id

    # ------------------------------------------------------------------ #
    # eviction
    # ------------------------------------------------------------------ #

    async def _evict_for(self, incoming_mb: float, *, keeping: str) -> None:
        """Evict LRU sessions until ``incoming_mb`` fits in the budget."""
        budget = float(self._settings.model_memory_budget_mb)
        if incoming_mb > budget:
            # Nothing we evict will help; say so rather than thrashing.
            raise ModelLoadError(
                "The model is larger than this deployment's memory budget.",
                log_context={
                    "model": keeping,
                    "reason": "over_budget",
                    "resident_mb": incoming_mb,
                },
            )
        protected = {keeping, *self._settings.preload_models}
        while self.resident_mb + incoming_mb > budget:
            victim = self._pick_victim(protected)
            if victim is None:
                # Only protected models remain and they still do not fit. Better
                # to refuse this load than to evict what readiness depends on.
                raise ModelLoadError(
                    "There is not enough model memory budget to load this model "
                    "alongside the preloaded ones.",
                    log_context={
                        "model": keeping,
                        "reason": "budget_exhausted",
                        "resident_mb": self.resident_mb,
                    },
                )
            await self.release(victim, reason="lru")

    def _pick_victim(self, protected: set[str]) -> str | None:
        for model_id in self._loaded:  # insertion order == LRU order
            if model_id not in protected:
                return model_id
        return None

    async def release(self, model_id: str, *, reason: str) -> bool:
        """Release one session. Returns False when it was not loaded."""
        model = self._loaded.pop(model_id, None)
        if model is None:
            return False
        # `close` frees native memory and can block briefly.
        with contextlib.suppress(Exception):
            await asyncio.to_thread(model.session.close)
        MODEL_EVICTIONS.labels(model=model_id, reason=reason).inc()
        self._publish_gauges()
        log_inference(
            logger,
            "loader.released",
            model=model_id,
            reason=reason,
            evicted=model_id,
            resident_mb=self.resident_mb,
            loaded_models=len(self._loaded),
        )
        return True

    async def release_all(self, *, reason: str = "shutdown") -> None:
        for model_id in list(self._loaded):
            await self.release(model_id, reason=reason)

    def _publish_gauges(self) -> None:
        MODELS_LOADED.set(len(self._loaded))
        RESIDENT_MB.set(self.resident_mb)

    # ------------------------------------------------------------------ #
    # warmup
    # ------------------------------------------------------------------ #

    async def warmup(self, model: LoadedModel) -> None:
        """Run one tiny batch so the first real request does not pay for it.

        Uses synthetic token ids rather than text: warmup must not depend on the
        tokenizer producing anything in particular, and there is no sensible
        "sample sentence" for a service that is language-agnostic by design.
        A failure here is logged, not raised — a model that cannot warm up will
        fail its first real request with a precise error, and refusing to start
        the whole service over a warmup hiccup is worse.
        """
        entry = model.entry
        length = min(16, self._settings.effective_max_length(entry.max_sequence_length))
        item = TokenizedText(
            input_ids=tuple(range(1, length + 1)),
            token_type_ids=(0,) * length,
            truncated=False,
        )
        rows = 2 if entry.task is ModelTask.RERANK else 1
        batch = pad_batch([item] * rows, pad_id=model.pad_id)

        def _run() -> None:
            feeds = batch_feeds(
                model.session,
                input_ids=batch.input_ids,
                attention_mask=batch.attention_mask,
                token_type_ids=batch.token_type_ids,
            )
            outputs = model.session.run(feeds)
            tensor = select_output(model.session, outputs)
            # Touch the data so a lazily-evaluated provider actually executes.
            np.asarray(tensor, dtype=np.float32).sum()

        started = time.perf_counter()
        try:
            await self._pool.run(_run, model_id=entry.id)
        except InferenceServiceError as exc:
            log_inference(
                logger,
                "loader.warmup_failed",
                model=entry.id,
                code=exc.code.value,
                reason="warmup",
            )
            return
        model.warm = True
        log_inference(
            logger,
            "loader.warm",
            model=entry.id,
            model_task=entry.task.value,
            batch_size=batch.size,
            duration_ms=round((time.perf_counter() - started) * 1000, 3),
        )

    async def preload(self) -> dict[str, str]:
        """Load and warm every configured preload target.

        Returns a map of ``model_id -> failure code`` for the ones that did not
        make it; an empty map means readiness can go green.
        """
        failures: dict[str, str] = {}
        for model_id in self._settings.preload_models:
            try:
                model = await self.get(model_id)
            except InferenceServiceError as exc:
                failures[model_id] = exc.code.value
                continue
            if self._settings.warmup_on_startup:
                await self.warmup(model)
                if not model.warm:
                    failures[model_id] = "warmup_failed"
            else:
                # Not warmed, but resident and usable.
                model.warm = True
        return failures

    # ------------------------------------------------------------------ #
    # idle sweeper
    # ------------------------------------------------------------------ #

    def start_sweeper(self) -> None:
        """Start the idle-release loop. No-op when idle release is disabled."""
        if self._settings.model_idle_release_s <= 0 or self._sweeper is not None:
            return
        self._sweeper = asyncio.create_task(self._sweep_loop(), name="model-idle-sweeper")

    async def stop_sweeper(self) -> None:
        task = self._sweeper
        self._sweeper = None
        if task is None:
            return
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    async def _sweep_loop(self) -> None:
        interval = self._settings.model_sweep_interval_s
        idle_limit = self._settings.model_idle_release_s
        protected = set(self._settings.preload_models)
        while not self._closed:
            try:
                await asyncio.sleep(interval)
            except asyncio.CancelledError:
                raise
            try:
                for model_id, model in list(self._loaded.items()):
                    if model_id in protected:
                        continue
                    if model.idle_s >= idle_limit:
                        await self.release(model_id, reason="idle")
            except Exception as exc:  # noqa: BLE001 - a sweeper must never die
                logger.error(
                    "loader.sweep_failed",
                    error_type=type(exc).__name__,
                    reason="sweep",
                )

    # ------------------------------------------------------------------ #
    # lifecycle
    # ------------------------------------------------------------------ #

    async def aclose(self) -> None:
        self._closed = True
        await self.stop_sweeper()
        await self.release_all(reason="shutdown")


__all__ = ["LoadedModel", "LoaderStats", "ModelLoader"]
