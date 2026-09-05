"""A bounded worker pool in front of the device (spec §49.3 / §49.4).

The problem
-----------
``onnxruntime.InferenceSession.run`` is a blocking native call. Called directly
from an async handler it would stall the event loop; called from an unbounded
thread pool it would let N concurrent requests each allocate their own activation
buffers until the accelerator's memory is gone. GPU memory exhaustion is not a
graceful failure — it can take the whole process with it.

The shape
---------
* A semaphore of ``max_concurrent_requests`` gates *device* access.
* A thread pool of the same size actually runs the blocking call, so a permit
  always corresponds to an available worker thread.
* Waiting for a permit has a deadline (``queue_timeout_s``). On expiry the
  request is **shed** with a 503 rather than queued indefinitely, because a
  caller that has already given up does not benefit from eventually being
  served, and its work would displace a caller that is still waiting (§49.4).
* Execution has its own deadline (``request_timeout_s``) and expires as a 504.

One subtlety worth stating plainly: **a thread cannot be cancelled.** When a
request times out, the native call keeps running to completion. So the permit is
released by the future's done-callback, not in a ``finally`` block — releasing it
at timeout would let a new request in while the old one still owns a worker
thread and device memory, which is exactly the oversubscription this module
exists to prevent. The consequence is that a pool full of slow work keeps
shedding until that work finishes, which is the correct behaviour: it is
backpressure, not a bug.
"""

from __future__ import annotations

import asyncio
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import TYPE_CHECKING, Generic, TypeVar

from app.core.errors import (
    InferenceServiceError,
    InferenceTimeoutError,
    QueueTimeoutError,
    ResourceExhaustedError,
)
from app.core.logging import get_logger, log_inference
from app.core.metrics import IN_FLIGHT, QUEUED, QUEUE_WAIT

if TYPE_CHECKING:
    from collections.abc import Callable
    from concurrent.futures import Future

logger = get_logger(__name__)

T = TypeVar("T")


def _consume_exception(future: asyncio.Future[object]) -> None:
    """Retrieve a discarded future's exception so asyncio does not warn."""
    if future.cancelled():
        return
    future.exception()


@dataclass(frozen=True, slots=True)
class Executed(Generic[T]):
    """A completed unit of work plus its timings."""

    value: T
    queue_wait_s: float
    run_s: float

    @property
    def queue_wait_ms(self) -> float:
        return round(self.queue_wait_s * 1000, 3)

    @property
    def run_ms(self) -> float:
        return round(self.run_s * 1000, 3)


@dataclass(frozen=True, slots=True)
class PoolStats:
    capacity: int
    in_flight: int
    queued: int
    closed: bool

    @property
    def saturated(self) -> bool:
        return self.in_flight >= self.capacity


class InferencePool:
    """Bounded execution of blocking model calls."""

    def __init__(
        self,
        *,
        capacity: int,
        queue_timeout_s: float,
        request_timeout_s: float,
        thread_name_prefix: str = "inference",
    ) -> None:
        if capacity < 1:
            msg = "pool capacity must be at least 1"
            raise ValueError(msg)
        self._capacity = capacity
        self._queue_timeout_s = queue_timeout_s
        self._request_timeout_s = request_timeout_s
        self._semaphore = asyncio.Semaphore(capacity)
        self._executor = ThreadPoolExecutor(
            max_workers=capacity,
            thread_name_prefix=thread_name_prefix,
        )
        self._in_flight = 0
        self._queued = 0
        self._closed = False
        IN_FLIGHT.set(0)
        QUEUED.set(0)

    # ------------------------------------------------------------------ #
    # introspection
    # ------------------------------------------------------------------ #

    @property
    def capacity(self) -> int:
        return self._capacity

    def stats(self) -> PoolStats:
        return PoolStats(
            capacity=self._capacity,
            in_flight=self._in_flight,
            queued=self._queued,
            closed=self._closed,
        )

    # ------------------------------------------------------------------ #
    # execution
    # ------------------------------------------------------------------ #

    async def run(
        self,
        fn: Callable[[], T],
        *,
        model_id: str = "",
        queue_timeout_s: float | None = None,
        request_timeout_s: float | None = None,
    ) -> Executed[T]:
        """Run ``fn`` on a worker thread, subject to both deadlines.

        Raises :class:`QueueTimeoutError` (503) when no slot frees up in time,
        :class:`InferenceTimeoutError` (504) when the call itself overruns, and
        :class:`ResourceExhaustedError` (503) on an allocator failure. Any
        :class:`InferenceServiceError` raised by ``fn`` passes through unchanged
        so the kernels keep their own typed failures.
        """
        if self._closed:
            raise QueueTimeoutError(
                "The service is shutting down and is not accepting work.",
                log_context={"model": model_id, "reason": "pool_closed"},
            )

        wait_budget = self._queue_timeout_s if queue_timeout_s is None else queue_timeout_s
        run_budget = self._request_timeout_s if request_timeout_s is None else request_timeout_s

        queue_started = time.perf_counter()
        await self._acquire(wait_budget, model_id=model_id)
        queue_wait_s = time.perf_counter() - queue_started
        QUEUE_WAIT.observe(queue_wait_s)

        self._in_flight += 1
        IN_FLIGHT.set(self._in_flight)

        future: Future[T] = self._executor.submit(fn)
        # Release the permit when the *thread* finishes, never at timeout. See
        # the module docstring.
        future.add_done_callback(self._on_done)

        run_started = time.perf_counter()
        wrapped = asyncio.wrap_future(future)
        # If we abandon `wrapped` on timeout, its eventual exception must still
        # be retrieved or asyncio logs "Future exception was never retrieved".
        wrapped.add_done_callback(_consume_exception)
        try:
            value = await asyncio.wait_for(asyncio.shield(wrapped), timeout=run_budget)
        except TimeoutError as exc:
            log_inference(
                logger,
                "pool.timeout",
                model=model_id,
                queue_wait_ms=round(queue_wait_s * 1000, 3),
                duration_ms=round((time.perf_counter() - run_started) * 1000, 3),
                reason="request_timeout",
            )
            raise InferenceTimeoutError(
                "The model did not produce a result within the configured budget.",
                log_context={"model": model_id, "reason": "request_timeout"},
            ) from exc
        except InferenceServiceError:
            # A typed failure from the kernel: propagate verbatim.
            raise
        except MemoryError as exc:
            raise ResourceExhaustedError(
                "The service ran out of memory for this request. Retry with a smaller batch.",
                log_context={"model": model_id, "reason": "oom"},
            ) from exc
        except asyncio.CancelledError:
            # The client disconnected. The thread keeps running; the done-callback
            # still returns the permit.
            raise
        run_s = time.perf_counter() - run_started
        return Executed(value=value, queue_wait_s=queue_wait_s, run_s=run_s)

    async def _acquire(self, timeout_s: float, *, model_id: str) -> None:
        """Acquire a permit or raise :class:`QueueTimeoutError`.

        Written out rather than using ``wait_for(sem.acquire())`` directly so a
        permit granted in the same tick as the timeout cannot be lost: the task
        is shielded, and if cancellation loses the race the permit is handed
        straight back.
        """
        self._queued += 1
        QUEUED.set(self._queued)
        task = asyncio.ensure_future(self._semaphore.acquire())
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=timeout_s)
        except TimeoutError as exc:
            if not task.cancel() and not task.cancelled() and task.exception() is None:
                # It succeeded between the timeout firing and the cancel landing.
                self._semaphore.release()
            log_inference(
                logger,
                "pool.queue_timeout",
                model=model_id,
                queue_wait_ms=round(timeout_s * 1000, 3),
                item_count=self._queued,
                reason="queue_timeout",
            )
            raise QueueTimeoutError(
                "The service is at capacity. Retry with backoff.",
                headers={"Retry-After": str(max(1, int(timeout_s)))},
                log_context={"model": model_id, "reason": "queue_timeout"},
            ) from exc
        except asyncio.CancelledError:
            if not task.cancel() and not task.cancelled() and task.exception() is None:
                self._semaphore.release()
            raise
        finally:
            self._queued -= 1
            QUEUED.set(self._queued)

    def _on_done(self, _future: Future[object]) -> None:
        """Return the permit and the slot. Runs on the worker thread."""
        self._in_flight = max(0, self._in_flight - 1)
        IN_FLIGHT.set(self._in_flight)
        # `Semaphore.release` is not thread-safe, so it is bounced onto the loop.
        # If the loop is already gone (interpreter shutdown) there is nothing
        # left to unblock and dropping the release is correct.
        try:
            loop = self._loop
        except AttributeError:  # pragma: no cover - defensive
            return
        if loop is None or loop.is_closed():
            return
        loop.call_soon_threadsafe(self._release_permit)

    def _release_permit(self) -> None:
        self._semaphore.release()

    # ------------------------------------------------------------------ #
    # lifecycle
    # ------------------------------------------------------------------ #

    _loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop | None = None) -> None:
        """Record the loop the pool belongs to. Called once during startup."""
        self._loop = loop or asyncio.get_running_loop()

    async def aclose(self, *, drain_timeout_s: float = 30.0) -> None:
        """Stop accepting work and wait for in-flight calls to finish.

        Waits rather than killing: a half-finished ONNX run holding device memory
        is worse than a slightly slower shutdown, and Kubernetes gives us a grace
        period precisely for this.
        """
        self._closed = True
        deadline = time.perf_counter() + drain_timeout_s
        while self._in_flight > 0 and time.perf_counter() < deadline:
            await asyncio.sleep(0.05)
        if self._in_flight > 0:
            logger.error(
                "pool.drain_incomplete",
                item_count=self._in_flight,
                reason="drain_timeout",
            )
        # cancel_futures drops work that never started; started threads finish.
        self._executor.shutdown(wait=False, cancel_futures=True)
        IN_FLIGHT.set(0)
        QUEUED.set(0)


__all__ = ["Executed", "InferencePool", "PoolStats"]
