"""Cross-encoder reranking (spec §54 server-authoritative rescoring, §72).

Why a cross-encoder and not another cosine
------------------------------------------
The retrieval stage in ``apps/api/app/rag/retriever.py`` produces candidates from
a bi-encoder (each side embedded independently, so the query never sees the
document). A cross-encoder scores the *pair* in one forward pass, which is much
more accurate and much more expensive — so it runs on the shortlist, never on
the corpus.

Server-authoritative ordering
-----------------------------
§54 lets the browser rerank locally for latency, but
``apps/api/app/rag/reranker.py`` always recomputes the order here and treats the
client's ordering as a hint to compare against. That means two things for this
module:

1. **Scores are comparable across requests.** The raw logit of a cross-encoder is
   not; the calibration in :func:`app.postprocessing.normalize.calibrate_scores`
   (sigmoid for the single-logit bge-reranker convention, softmax over the
   positive class for the two-class ms-marco convention) is what makes a
   threshold like "drop below 0.3" mean the same thing twice. The activation is
   manifest data because guessing it inverts the ranking for the two-class case.
2. **The mapping from score to input index must survive batching.** Like the
   embedder, this kernel groups pairs by token length, and scatters results back
   by original index. The response carries the original index of every document,
   never a reordered copy of the caller's list, so a caller that lost track of
   the order still cannot mis-attribute a citation.

Truncation asymmetry
--------------------
Pair encoding uses the tokenizer's ``longest_first`` strategy (see
``preprocessing/tokenizer.py``), so a 2000-token document is trimmed rather than
pushing the query out of the window. A query that is itself longer than the
window is a caller error, not something to silently truncate around, and the
character guard in ``preprocessing/text.py`` catches the pathological case first.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

import numpy as np

from app.core.logging import get_logger, log_inference
from app.core.metrics import (
    BATCH_SIZE,
    MODEL_DURATION,
    PADDING_TOKENS,
    TOKENS,
    TRUNCATED,
)
from app.inference.embedder import plan_batches
from app.models.registry import ModelTask
from app.models.session import batch_feeds, select_output
from app.postprocessing.normalize import calibrate_scores, scores_to_list, top_k_view
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


@dataclass(frozen=True, slots=True)
class ScoredDocument:
    """One document's calibrated relevance, tied to its position in the request."""

    #: Index into the caller's ``documents`` list. The contract of this module.
    index: int
    score: float


@dataclass(frozen=True, slots=True)
class RerankResult:
    """Both views of the answer: ranked, and in input order."""

    #: Highest score first; ties broken by input order so the result is stable.
    ranking: tuple[ScoredDocument, ...]
    #: Every score in *input* order, including documents cut by ``top_k``.
    scores: tuple[float, ...]
    model_id: str
    activation: str
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
        return len(self.scores)


class Reranker:
    """Reranking kernel. One instance per process; stateless per request."""

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

    async def rerank(
        self,
        query: str,
        documents: Sequence[str],
        *,
        model_id: str | None = None,
        top_k: int | None = None,
        max_length: int | None = None,
        batch_size: int | None = None,
        request_id: str = "",
    ) -> RerankResult:
        settings = self._settings
        target = model_id or settings.default_rerank_model
        model = await self._loader.get(target, task=ModelTask.RERANK)
        entry = model.entry

        # The query is guarded and normalised on its own so that a 50 MB "query"
        # is a 413 naming `body.query`, not a confusing error about the documents.
        prepared_query = prepare(
            [query],
            prefix=entry.query_prefix,
            max_items=1,
            max_chars=settings.max_input_chars,
            field="body.query",
        )[0]
        prepared_docs = prepare(
            documents,
            prefix=entry.passage_prefix,
            max_items=settings.max_texts_per_request,
            max_chars=settings.max_input_chars,
            field="body.documents",
        )

        window = effective_max_length(
            global_max=settings.max_sequence_length,
            entry_max=entry.max_sequence_length,
            requested=max_length,
        )

        tokenize_started = time.perf_counter()
        items = await _tokenize_pairs(model, prepared_query, prepared_docs, window)
        tokenize_ms = round((time.perf_counter() - tokenize_started) * 1000, 3)

        cap = min(batch_size or settings.max_batch_size, settings.max_batch_size)
        plan = plan_batches(items, max_batch_size=cap, max_batch_tokens=max(cap, 1) * window)

        scores = np.zeros(len(items), dtype=np.float32)
        total_tokens = 0
        padded_tokens = 0
        inference_ms = 0.0

        for batch in plan:
            encoded = pad_batch(batch.items, pad_id=model.pad_id)
            executed = await self._pool.run(
                lambda encoded=encoded, model=model: _forward(model, encoded),
                model_id=entry.id,
            )
            inference_ms += executed.run_s * 1000
            MODEL_DURATION.labels(model=entry.id, task=entry.task.value).observe(executed.run_s)
            BATCH_SIZE.labels(model=entry.id).observe(encoded.size)
            # Scatter back to input order before anything looks at a score.
            scores[list(batch.indices)] = executed.value
            total_tokens += encoded.token_count
            padded_tokens += encoded.padded_token_count

        in_order = scores_to_list(scores, model_id=entry.id)
        ranked_indices = top_k_view(in_order, top_k=top_k)
        ranking = tuple(
            ScoredDocument(index=index, score=in_order[index]) for index in ranked_indices
        )

        truncated_count = sum(1 for item in items if item.truncated)
        TOKENS.labels(model=entry.id, task=entry.task.value).inc(total_tokens)
        PADDING_TOKENS.labels(model=entry.id, task=entry.task.value).inc(
            max(0, padded_tokens - total_tokens)
        )
        if truncated_count:
            TRUNCATED.labels(model=entry.id).inc(truncated_count)

        log_inference(
            logger,
            "rerank.completed",
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
            top_k=len(ranking),
            inference_ms=round(inference_ms, 3),
            tokenize_ms=tokenize_ms,
        )

        return RerankResult(
            ranking=ranking,
            scores=tuple(in_order),
            model_id=entry.id,
            activation=entry.score_activation.value,
            token_counts=tuple(item.length for item in items),
            total_tokens=total_tokens,
            padded_tokens=padded_tokens,
            truncated_count=truncated_count,
            batch_count=len(plan),
            max_sequence_length=window,
            inference_ms=round(inference_ms, 3),
            tokenize_ms=tokenize_ms,
        )


async def _tokenize_pairs(
    model: LoadedModel,
    query: str,
    documents: Sequence[str],
    window: int,
) -> list[TokenizedText]:
    """Encode ``(query, document)`` pairs off the event loop.

    Outside the device pool for the same reason as the embedder's tokenisation:
    a permit represents an accelerator slot, and holding one for pure-CPU work
    would idle the device.
    """
    pairs = [(query, document) for document in documents]
    return await asyncio.to_thread(model.tokenizer.encode_pairs, pairs, max_length=window)


def _forward(model: LoadedModel, encoded: object) -> NDArray[np.float32]:
    """Run one batch of pairs and calibrate its logits. Worker thread only."""
    from app.preprocessing.tokenizer import EncodedBatch

    assert isinstance(encoded, EncodedBatch)
    feeds = batch_feeds(
        model.session,
        input_ids=encoded.input_ids,
        attention_mask=encoded.attention_mask,
        token_type_ids=encoded.token_type_ids,
    )
    outputs = model.session.run(feeds)
    tensor = select_output(model.session, outputs, preferred=("logits", "score", "scores"))
    return calibrate_scores(
        np.asarray(tensor),
        activation=model.entry.score_activation,
        model_id=model.entry.id,
    )


__all__ = ["RerankResult", "Reranker", "ScoredDocument"]
