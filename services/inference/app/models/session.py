"""The ONNX session port and its real onnxruntime implementation.

Every call into a model goes through :class:`SessionPort`. That is what lets the
test suite run with a deterministic fake and no weights, no ONNX runtime and no
network — see ``tests/fakes.py``. Nothing above this module imports
``onnxruntime``, and the import here is lazy so a machine without the wheel can
still import the app (and run the tests).

Failure translation happens here too. onnxruntime raises its own exception
family with messages that contain file paths and, for shape errors, tensor
contents; those must never reach the caller, so they are caught at this seam and
re-raised as the typed errors in :mod:`app.core.errors`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Final, Protocol, runtime_checkable

import numpy as np

from app.core.errors import (
    InferenceFailedError,
    ModelLoadError,
    ResourceExhaustedError,
)
from app.core.logging import get_logger

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence
    from pathlib import Path

    from numpy.typing import NDArray

    from app.core.config import Settings

logger = get_logger(__name__)

#: Substrings onnxruntime uses for allocator failures. Matched case-insensitively
#: so an OOM becomes a retryable 503 rather than an opaque 502.
_OOM_MARKERS: Final[tuple[str, ...]] = (
    "out of memory",
    "bad_alloc",
    "failed to allocate",
    "cudaerrormemoryallocation",
    "hiperroroutofmemory",
)


@runtime_checkable
class SessionPort(Protocol):
    """The minimum surface the inference kernels need from a model session."""

    @property
    def input_names(self) -> tuple[str, ...]:
        """Graph input names, e.g. ``("input_ids", "attention_mask", "token_type_ids")``."""
        ...

    @property
    def output_names(self) -> tuple[str, ...]: ...

    def run(self, feeds: Mapping[str, NDArray[Any]]) -> list[NDArray[Any]]:
        """Execute the graph. Synchronous and CPU/GPU-blocking by nature, which is
        why every caller goes through :class:`~app.inference.pool.InferencePool`."""
        ...

    def close(self) -> None:
        """Release native resources. Must be idempotent."""
        ...


@runtime_checkable
class SessionFactory(Protocol):
    """Builds a session for a model directory. Swapped wholesale in tests."""

    def __call__(
        self,
        *,
        model_path: Path,
        settings: Settings,
        model_id: str,
    ) -> SessionPort: ...


class OnnxRuntimeSession:
    """A real ``onnxruntime.InferenceSession``, wrapped and error-translated."""

    def __init__(
        self,
        *,
        model_path: Path,
        settings: Settings,
        model_id: str,
    ) -> None:
        try:
            import onnxruntime as ort
        except ImportError as exc:  # pragma: no cover - environment problem
            raise ModelLoadError(
                "The inference runtime is not installed in this image.",
                log_context={"model": model_id, "reason": "onnxruntime_missing"},
            ) from exc

        options = ort.SessionOptions()
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        # Sequential execution: we get our parallelism from batching and from the
        # worker pool, and ORT's parallel mode fights the pool for cores.
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        if settings.intra_op_threads:
            options.intra_op_num_threads = settings.intra_op_threads
        if settings.inter_op_threads:
            options.inter_op_num_threads = settings.inter_op_threads
        # ORT's own logs are verbose and can echo tensor metadata. 3 = ERROR.
        options.log_severity_level = 3

        providers = list(settings.execution_providers)
        try:
            self._session: Any = ort.InferenceSession(
                str(model_path),
                sess_options=options,
                providers=providers,
            )
        except Exception as exc:  # noqa: BLE001 - ORT raises a wide family here
            raise _translate_runtime_error(
                exc,
                model_id=model_id,
                default=ModelLoadError(
                    "The model could not be loaded by the inference runtime.",
                    log_context={"model": model_id, "reason": "session_init"},
                ),
            ) from exc

        self._input_names: tuple[str, ...] = tuple(i.name for i in self._session.get_inputs())
        self._output_names: tuple[str, ...] = tuple(o.name for o in self._session.get_outputs())
        self._closed = False
        active = self._session.get_providers()
        logger.info(
            "session.opened",
            model=model_id,
            device=settings.device.value,
            provider=active[0] if active else "unknown",
        )
        if providers[0] not in active:
            # Not fatal — the CPU provider is intentionally last in the fallback
            # list (§49.4) — but an operator who provisioned GPU nodes needs to
            # know the accelerator did not engage.
            logger.error(
                "session.provider_unavailable",
                model=model_id,
                device=settings.device.value,
                provider=active[0] if active else "none",
                reason="requested_provider_not_active",
            )

    @property
    def input_names(self) -> tuple[str, ...]:
        return self._input_names

    @property
    def output_names(self) -> tuple[str, ...]:
        return self._output_names

    def run(self, feeds: Mapping[str, NDArray[Any]]) -> list[NDArray[Any]]:
        if self._closed:
            raise InferenceFailedError(
                "The model session was released while the request was in flight.",
                log_context={"reason": "session_closed"},
            )
        try:
            outputs = self._session.run(None, dict(feeds))
        except Exception as exc:  # noqa: BLE001 - see _translate_runtime_error
            raise _translate_runtime_error(
                exc,
                model_id="",
                default=InferenceFailedError(
                    "The model failed to produce a result.",
                    log_context={"reason": "run_failed"},
                ),
            ) from exc
        return [np.asarray(output) for output in outputs]

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        # onnxruntime frees native memory when the Python object is collected;
        # dropping the reference is the documented way to release a session.
        self._session = None


def _translate_runtime_error(
    exc: BaseException,
    *,
    model_id: str,
    default: Exception,
) -> Exception:
    """Map a runtime exception onto our typed hierarchy, discarding its message.

    The original message is deliberately dropped from the caller-visible error:
    ORT includes the model path, and shape-mismatch messages can include tensor
    values. It is logged as a type name only; the full text is available in the
    unhandled-exception path's ``exc_info`` when the operator needs it.
    """
    text = str(exc).lower()
    if isinstance(exc, MemoryError) or any(marker in text for marker in _OOM_MARKERS):
        return ResourceExhaustedError(
            "The service ran out of memory for this request. Retry with a smaller batch.",
            log_context={
                "model": model_id,
                "reason": "oom",
                "error_type": type(exc).__name__,
            },
        )
    if isinstance(exc, FileNotFoundError) or "no such file" in text:
        return ModelLoadError(
            "The model graph is missing on disk.",
            log_context={"model": model_id, "reason": "file_missing"},
        )
    return default


def create_session(
    *,
    model_path: Path,
    settings: Settings,
    model_id: str,
) -> SessionPort:
    """Default :class:`SessionFactory`."""
    return OnnxRuntimeSession(model_path=model_path, settings=settings, model_id=model_id)


def batch_feeds(
    session: SessionPort,
    *,
    input_ids: NDArray[np.int64],
    attention_mask: NDArray[np.int64],
    token_type_ids: NDArray[np.int64] | None = None,
) -> dict[str, NDArray[np.int64]]:
    """Build a feed dict containing only the inputs this graph actually declares.

    Encoder graphs differ: some BERT exports want ``token_type_ids``, e5/XLM-R
    exports do not, and feeding an undeclared input is a hard ORT error. So the
    caller always produces all three and this function selects.
    """
    available = set(session.input_names)
    feeds: dict[str, NDArray[np.int64]] = {}
    if "input_ids" in available:
        feeds["input_ids"] = input_ids
    if "attention_mask" in available:
        feeds["attention_mask"] = attention_mask
    if "token_type_ids" in available:
        feeds["token_type_ids"] = (
            token_type_ids
            if token_type_ids is not None
            else np.zeros_like(input_ids, dtype=np.int64)
        )
    missing = available - set(feeds)
    if missing:
        # An unexpected required input means the export does not match what the
        # manifest claims. Typed error, not a KeyError from deep inside ORT.
        raise InferenceFailedError(
            "The model graph expects inputs this service does not provide.",
            log_context={"reason": "unexpected_graph_inputs", "error_type": ",".join(
                sorted(missing)
            )},
        )
    return feeds


def select_output(
    session: SessionPort,
    outputs: Sequence[NDArray[Any]],
    *,
    preferred: Sequence[str] = ("last_hidden_state", "logits", "sentence_embedding"),
) -> NDArray[Any]:
    """Pick the tensor we care about by name, falling back to the first output."""
    names = session.output_names
    for wanted in preferred:
        if wanted in names:
            return outputs[names.index(wanted)]
    if not outputs:
        raise InferenceFailedError(
            "The model returned no outputs.",
            log_context={"reason": "empty_output"},
        )
    return outputs[0]


__all__ = [
    "OnnxRuntimeSession",
    "SessionFactory",
    "SessionPort",
    "batch_feeds",
    "create_session",
    "select_output",
]
