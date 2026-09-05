"""Pooling, L2 normalisation, score calibration, and the NaN/Inf guard.

The guard is the important part of this module. A NaN that reaches Qdrant is
**silent corruption**: the point is accepted, the index is built, and cosine
similarity against that vector returns NaN, which sorts unpredictably. Nobody
gets an error — retrieval just gets worse, weeks later, with no event to
correlate against. So every array leaving this service passes
:func:`ensure_finite`, and a non-finite value is a typed 502 with a metric
attached, never a zero-fill.

Non-finite outputs are not hypothetical: fp16 overflow on an accelerator, a
zero-length attention mask producing 0/0 in the mean pool, and a corrupted
weight file all produce them.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Final

import numpy as np

from app.core.errors import NumericalError
from app.core.metrics import NUMERICAL_FAILURES
from app.models.registry import Pooling, ScoreActivation

if TYPE_CHECKING:
    from collections.abc import Sequence

    from numpy.typing import NDArray

#: Below this, a vector is treated as the zero vector rather than divided by.
_EPSILON: Final[float] = 1e-12


def ensure_finite(array: NDArray[np.floating], *, model_id: str, stage: str) -> None:
    """Raise :class:`NumericalError` if the array holds NaN or ±Inf.

    ``stage`` names where it happened (``pool`` / ``normalize`` / ``score``) so
    the log distinguishes "the model emitted garbage" from "our arithmetic
    produced garbage".
    """
    if array.size == 0:
        return
    if not np.isfinite(array).all():
        NUMERICAL_FAILURES.labels(model=model_id).inc()
        raise NumericalError(
            "The model produced a non-finite value; the result was discarded.",
            log_context={"model": model_id, "reason": f"non_finite_{stage}"},
        )


def pool(
    hidden_states: NDArray[np.floating],
    attention_mask: NDArray[np.integer],
    *,
    strategy: Pooling,
    model_id: str,
) -> NDArray[np.float32]:
    """Collapse ``(batch, seq, hidden)`` token states to ``(batch, hidden)``.

    ``Pooling.NONE`` means the graph already emitted a pooled tensor, which may
    arrive as either 2-D or a 3-D tensor with a singleton sequence axis.
    """
    states = np.asarray(hidden_states, dtype=np.float32)

    if states.ndim == 2:
        # Already pooled by the graph.
        pooled = states
    elif states.ndim == 3:
        if strategy is Pooling.CLS:
            pooled = states[:, 0, :]
        elif strategy is Pooling.MEAN:
            mask = np.asarray(attention_mask, dtype=np.float32)
            if mask.shape[:2] != states.shape[:2]:
                raise NumericalError(
                    "The model output shape does not match the attention mask.",
                    log_context={"model": model_id, "reason": "mask_shape_mismatch"},
                )
            expanded = mask[:, :, None]
            summed = (states * expanded).sum(axis=1)
            # Never divide by zero: pad_batch guarantees at least one attended
            # slot per row, and this clamp makes that guarantee load-bearing
            # rather than assumed.
            counts = np.maximum(expanded.sum(axis=1), _EPSILON)
            pooled = summed / counts
        else:  # Pooling.NONE with a 3-D output: take the first position.
            pooled = states[:, 0, :]
    else:
        raise NumericalError(
            "The model returned a tensor of unexpected rank.",
            log_context={"model": model_id, "reason": f"rank_{states.ndim}"},
        )

    result = np.ascontiguousarray(pooled, dtype=np.float32)
    ensure_finite(result, model_id=model_id, stage="pool")
    return result


def l2_normalize(vectors: NDArray[np.floating], *, model_id: str) -> NDArray[np.float32]:
    """Row-wise L2 normalisation.

    A zero row stays zero rather than becoming NaN — cosine similarity against a
    zero vector is 0, which is a defensible "no signal", whereas NaN is not.
    """
    array = np.asarray(vectors, dtype=np.float32)
    ensure_finite(array, model_id=model_id, stage="pre_normalize")
    norms = np.linalg.norm(array, axis=-1, keepdims=True)
    safe = np.where(norms < _EPSILON, 1.0, norms)
    normalised = np.ascontiguousarray(array / safe, dtype=np.float32)
    ensure_finite(normalised, model_id=model_id, stage="normalize")
    return normalised


def sigmoid(values: NDArray[np.floating]) -> NDArray[np.float32]:
    """Numerically stable logistic function.

    ``1/(1+exp(-x))`` overflows for x ≈ -750; the piecewise form does not, which
    matters because a cross-encoder logit of -800 is not exotic for an obviously
    irrelevant pair.
    """
    array = np.asarray(values, dtype=np.float64)
    out = np.empty_like(array)
    positive = array >= 0
    out[positive] = 1.0 / (1.0 + np.exp(-array[positive]))
    exp_negative = np.exp(array[~positive])
    out[~positive] = exp_negative / (1.0 + exp_negative)
    return out.astype(np.float32)


def softmax(values: NDArray[np.floating], *, axis: int = -1) -> NDArray[np.float32]:
    """Stable softmax (max-subtracted)."""
    array = np.asarray(values, dtype=np.float64)
    shifted = array - np.max(array, axis=axis, keepdims=True)
    exponentiated = np.exp(shifted)
    total = np.sum(exponentiated, axis=axis, keepdims=True)
    return (exponentiated / np.maximum(total, _EPSILON)).astype(np.float32)


def calibrate_scores(
    logits: NDArray[np.floating],
    *,
    activation: ScoreActivation,
    model_id: str,
) -> NDArray[np.float32]:
    """Turn a reranker's raw output into comparable scores.

    Shapes handled: ``(n,)``, ``(n, 1)`` — single logit, sigmoid convention — and
    ``(n, 2)`` — two-class, softmax over the positive class. The activation comes
    from the manifest because it is a property of how the checkpoint was
    exported, and guessing it inverts the ranking for the two-class case.
    """
    array = np.asarray(logits, dtype=np.float32)
    ensure_finite(array, model_id=model_id, stage="score")

    if array.ndim == 1:
        raw = array
    elif array.ndim == 2:
        if array.shape[1] == 1:
            raw = array[:, 0]
        elif array.shape[1] == 2 and activation is ScoreActivation.SOFTMAX:
            probabilities = softmax(array, axis=-1)
            ensure_finite(probabilities, model_id=model_id, stage="score_softmax")
            return np.ascontiguousarray(probabilities[:, 1], dtype=np.float32)
        else:
            # More than one column with a non-softmax activation: the first
            # column is the relevance logit by convention.
            raw = array[:, 0]
    else:
        raise NumericalError(
            "The reranker returned a tensor of unexpected rank.",
            log_context={"model": model_id, "reason": f"rank_{array.ndim}"},
        )

    if activation is ScoreActivation.SIGMOID:
        scores = sigmoid(raw)
    elif activation is ScoreActivation.SOFTMAX:
        # A single logit with a softmax activation degenerates to a sigmoid.
        scores = sigmoid(raw)
    else:
        scores = np.ascontiguousarray(raw, dtype=np.float32)

    ensure_finite(scores, model_id=model_id, stage="score_activation")
    return scores


def to_lists(vectors: NDArray[np.floating], *, model_id: str) -> list[list[float]]:
    """Convert to JSON-serialisable nested lists, checked once more on the way out.

    This is the last gate before the response body, so it is checked even though
    the callers already did: it is the only place guaranteed to run for every
    vector that leaves the process.
    """
    array = np.asarray(vectors, dtype=np.float32)
    ensure_finite(array, model_id=model_id, stage="serialize")
    return [[float(value) for value in row] for row in array]


def scores_to_list(scores: NDArray[np.floating], *, model_id: str) -> list[float]:
    array = np.asarray(scores, dtype=np.float32)
    ensure_finite(array, model_id=model_id, stage="serialize")
    return [float(value) for value in array]


def top_k_view(scores: Sequence[float], *, top_k: int | None) -> list[int]:
    """Indices of the highest scores, highest first, ties broken by input order.

    Returned as indices rather than reordered data so the caller keeps the
    input-order array *and* the ranked view from one call — the ``/rerank``
    contract needs both.
    """
    order = sorted(range(len(scores)), key=lambda i: (-scores[i], i))
    if top_k is None or top_k >= len(order):
        return order
    return order[: max(0, top_k)]


__all__ = [
    "calibrate_scores",
    "ensure_finite",
    "l2_normalize",
    "pool",
    "scores_to_list",
    "sigmoid",
    "softmax",
    "to_lists",
    "top_k_view",
]
