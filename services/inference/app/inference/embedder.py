"""Batched embedding (spec §2.1 private embedding, §12.1, §72).

Open weights only. This kernel serves BGE / multilingual-e5 class models from
the private environment. It does not and cannot serve OpenAI's
``text-embedding-3-*``: there are no weights to load, and pretending otherwise
would let a knowledge base be indexed with a geometry this service cannot
reproduce. Selecting the hosted API is the API tier's decision
(``apps/api/app/rag/embedder.py::ApiEmbedder``), made under an explicit
enterprise policy, and it never routes through here.

Determinism and ordering
------------------------
The response vector at index *i* is always the embedding of the input at index
*i*, regardless of how the request was split into batches. That is not a
convenience: the caller writes these vectors into Qdrant against chunk ids by
position, so a reordering would silently mis-attribute every chunk in the batch.
Dynamic batching reorders internally and scatters back by original index, and
``tests/test_embedder.py`` asserts that batched output equals one-at-a-time
output element for element.

Dynamic batching
----------------
Inputs are grouped by token length before batching. Padding is charged at the
longest member of each batch, so a request mixing a 12-token query with a
500-token chunk would otherwise pad the query to 500 — 40× the arithmetic for
the same answer. Sorting by length first means each batch pads to nearly its own
natural width. Two ceilings close a batch: the item count
(``max_batch_size``, hard) and the padded token count, so 32 sequences of 8192
tokens cannot be requested as one execution.

The cost of length grouping is that batch composition depends on the request,
which is why numerical equivalence with the unbatched path is a test and not an
assumption.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING

import numpy as np

from app.core.errors import InferenceFailedError
from app.core.logging import get_logger, log_inference
from app.core.metrics import (
    BATCH_SIZE,
    MODEL_DURATION,
    PADDING_TOKENS,
    TOKENS,
    TRUNCATED,
)
from app.models.registry import ModelTask
from app.models.session import batch_feeds, select_output
from app.postprocessing.normalize import l2_normalize, pool as pool_states, to_lists
from app.preprocessing.text import prepare
from app.preprocessing.tokenizer import effective_max_length, pad_batch

if TYPE_CHECKING:
    from collections.abc import Sequence

    from numpy.typing import NDArray

    from app.core.config import Settings
    from app.inference.pool import InferencePool
    from app.models.loader import LoadedModel, ModelLoader
    from app.preprocessing.tokenizer import TokenizedText

logger = get_logger(__name__)


class TextKind(StrEnum):
    """Which instruction prefix to apply.

    e5 needs ``query: `` / ``passage: `` and BGE-zh needs an instruction on the
    query side only, so the asymmetry is a correctness requirement — the same
    reason ``apps/api``'s ``LocalEmbedder`` splits ``embed_query`` from
    ``embed_documents``. ``RAW`` applies no prefix, for a caller that has already
    applied its own.
    """

    QUERY = "query"
    PASSAGE = "passage"
    RAW = "raw"


@dataclass(frozen=True, slots=True)
class EmbeddingResult:
    """Everything the HTTP layer needs, in input order."""

    vectors: list[list[float]]
    dimension: int
    model_id: str
    normalized: bool
    #: Non-padding tokens per input, in input order.
    token_counts: tuple[int, ...]
    total_tokens: int
    padded_tokens: int
    truncated_count: int
    batch_count: int
    max_sequence_length: int
    inference_ms: float
    tokenize_ms: float

    @property
    def count(self) -> int:
        return len(self.vectors)


@dataclass(frozen=True, slots=True)
class _Batch:
    """One ONNX execution: the original indices it covers, in order."""

    indices: tuple[int, ...]
    items: tuple[TokenizedText, ...]


def plan_batches(
    items: Sequence[TokenizedText],
    *,
    max_batch_size: int,
    max_batch_tokens: int,
) -> list[_Batch]:
    """Group inputs by token length into batches under both ceilings.

    Pure and deterministic: the same inputs always produce the same plan, which
    is what makes the batching path reproducible in tests. Ties in length are
    broken by original index so the plan is stable.
    """
    if max_batch_size < 1:
        msg = "max_batch_size must be at least 1"
        raise ValueError(msg)
    order = sorted(range(len(items)), key=lambda i: (items[i].length, i))

    batches: list[_Batch] = []
    current: list[int] = []
    current_width = 0
    for index in order:
        length = max(items[index].length, 1)
        width = max(current_width, length)
        # Padded cost if this item joined the current batch.
        projected = width * (len(current) + 1)
        too_many = len(current) >= max_batch_size
        too_big = bool(current) and projected > max_batch_tokens
        if current and (too_many or too_big):
            batches.append(
                _Batch(indices=tuple(current), items=tuple(items[i] for i in current))
            )
            current = []
            current_width = 0
            width = length
        current.append(index)
        current_width = width
    if current:
        batches.append(_Batch(indices=tuple(current), items=tuple(items[i] for i in current)))
    return batches


class Embedder:
    """Embedding kernel. One instance per process; stateless per request."""

    def __init__(
        self,
        *,
        settings: Settings,
        loader: ModelLoader,
        pool: InferencePool,
    ) -> None:
        self._settings = settings
        self._loader = loader
        self._pool = pool

    async def embed(
        self,
        texts: Sequence[str],
        *,
        model_id: str | None = None,
        kind: TextKind = TextKind.PASSAGE,
        normalize: bool | None = None,
        max_length: int | None = None,
        batch_size: int | None = None,
        request_id: str = "",
    ) -> EmbeddingResult:
        settings = self._settings
        target = model_id or settings.default_embedding_model
        model = await self._loader.get(target, task=ModelTask.EMBEDDING)
        entry = model.entry

        prefix = _prefix_for(model, kind)
        prepared = prepare(
            texts,
            prefix=prefix,
            max_items=settings.max_texts_per_request,
            max_chars=settings.max_input_chars,
            field="body.texts",
        )

        window = effective_max_length(
            global_max=settings.max_sequence_length,
            entry_max=entry.max_sequence_length,
            requested=max_length,
        )

        tokenize_started = time.perf_counter()
        items = await _tokenize(model, prepared, window)
        tokenize_ms = round((time.perf_counter() - tokenize_started) * 1000, 3)

        # Hard cap: a caller cannot raise the batch size above the deployment's.
        cap = min(batch_size or settings.max_batch_size, settings.max_batch_size)
        plan = plan_batches(
            items,
            max_batch_size=cap,
            max_batch_tokens=max(cap, 1) * window,
        )

        dimension = entry.dimension or 0
        vectors = np.zeros((len(items), dimension), dtype=np.float32) if dimension else None
        should_normalize = entry.normalize if normalize is None else normalize

        total_tokens = 0
        padded_tokens = 0
        inference_ms = 0.0

        for batch in plan:
            encoded = pad_batch(batch.items, pad_id=model.pad_id)
            executed = await self._pool.run(
                lambda encoded=encoded, model=model: _forward(model, encoded),
                model_id=entry.id,
            )
            pooled = executed.value
            inference_ms += executed.run_s * 1000
            MODEL_DURATION.labels(model=entry.id, task=entry.task.value).observe(executed.run_s)
            BATCH_SIZE.labels(model=entry.id).observe(encoded.size)

            if should_normalize:
                pooled = l2_normalize(pooled, model_id=entry.id)

            if vectors is None:
                # No declared dimension is a manifest error for an embedding
                # model, but be defensive: allocate from the first result.
                dimension = int(pooled.shape[1])
                vectors = np.zeros((len(items), dimension), dtype=np.float32)
            if pooled.shape[1] != dimension:
                raise InferenceFailedError(
                    f"The model produced {pooled.shape[1]}-dimensional vectors but the "
                    f"manifest declares {dimension}. Indexing them would corrupt the "
                    "vector collection.",
                    log_context={
                        "model": entry.id,
                        "reason": "dimension_mismatch",
                        "dimension": int(pooled.shape[1]),
                    },
                )
            # Scatter back to input order — the invariant this module exists for.
            vectors[list(batch.indices), :] = pooled

            total_tokens += encoded.token_count
            padded_tokens += encoded.padded_token_count

        assert vectors is not None  # plan is non-empty because prepare() rejects []

        truncated_count = sum(1 for item in items if item.truncated)
        TOKENS.labels(model=entry.id, task=entry.task.value).inc(total_tokens)
        PADDING_TOKENS.labels(model=entry.id, task=entry.task.value).inc(
            max(0, padded_tokens - total_tokens)
        )
        if truncated_count:
            TRUNCATED.labels(model=entry.id).inc(truncated_count)

        log_inference(
            logger,
            "embed.completed",
            request_id=request_id,
            model=entry.id,
            model_task=entry.task.value,
            device=settings.device.value,
            item_count=len(items),
            batch_count=len(plan),
            max_batch_size=cap,
            token_count=total_tokens,
            padded_token_count=padded_tokens,
            max_sequence_length=window,
            truncated_count=truncated_count,
            dimension=dimension,
            inference_ms=round(inference_ms, 3),
            tokenize_ms=tokenize_ms,
        )

        return EmbeddingResult(
            vectors=to_lists(vectors, model_id=entry.id),
            dimension=dimension,
            model_id=entry.id,
            normalized=should_normalize,
            token_counts=tuple(item.length for item in items),
            total_tokens=total_tokens,
            padded_tokens=padded_tokens,
            truncated_count=truncated_count,
            batch_count=len(plan),
            max_sequence_length=window,
            inference_ms=round(inference_ms, 3),
            tokenize_ms=tokenize_ms,
        )


def _prefix_for(model: LoadedModel, kind: TextKind) -> str:
    if kind is TextKind.QUERY:
        return model.entry.query_prefix
    if kind is TextKind.PASSAGE:
        return model.entry.passage_prefix
    return ""


async def _tokenize(
    model: LoadedModel,
    texts: Sequence[str],
    window: int,
) -> list[TokenizedText]:
    """Tokenise off the event loop.

    Deliberately *not* inside :class:`~app.inference.pool.InferencePool`: that
    pool's permits represent device slots, and holding one for pure-CPU
    tokenisation would idle the accelerator. ``asyncio.to_thread`` uses the
    default executor, which is bounded by the interpreter (``min(32, cpu+4)``),
    and the character-level guard in ``preprocessing.text`` already caps how much
    work any one request can hand it.
    """
    import asyncio

    return await asyncio.to_thread(model.tokenizer.encode, list(texts), max_length=window)


def _forward(model: LoadedModel, encoded: object) -> NDArray[np.float32]:
    """Run one batch and pool it. Executes on a worker thread."""
    from app.preprocessing.tokenizer import EncodedBatch

    assert isinstance(encoded, EncodedBatch)
    feeds = batch_feeds(
        model.session,
        input_ids=encoded.input_ids,
        attention_mask=encoded.attention_mask,
        token_type_ids=encoded.token_type_ids,
    )
    outputs = model.session.run(feeds)
    tensor = select_output(
        model.session,
        outputs,
        preferred=("last_hidden_state", "sentence_embedding", "token_embeddings"),
    )
    return pool_states(
        np.asarray(tensor),
        encoded.attention_mask,
        strategy=model.entry.pooling,
        model_id=model.entry.id,
    )


__all__ = [
    "Embedder",
    "EmbeddingResult",
    "TextKind",
    "plan_batches",
]
