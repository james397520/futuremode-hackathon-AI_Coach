"""Cross-encoder reranking endpoint (spec §54, §72).

Wire shape
----------
``POST /v1/rerank`` speaks the common TEI / Infinity contract, because that is
what ``apps/api/app/rag/reranker.py::CrossEncoderReranker`` already posts::

    {"model": "BAAI/bge-reranker-v2-m3", "query": "…", "texts": ["…", "…"]}
    -> {"results": [{"index": 3, "score": 0.91}, {"index": 0, "score": 0.42}]}

``documents`` is accepted as an alias for ``texts`` (the Cohere spelling) and
``top_n`` as an alias for ``top_k``, so a deployment can swap this service in
behind either client without editing the caller. The response carries both
``score`` and ``relevance_score`` with the same value: the API tier reads
``row.get("score", row.get("relevance_score"))``, and other clients in this
family read the latter.

Ordering is the contract
------------------------
``results`` is sorted by **descending score**, ties broken by input order, and
every entry carries the ``index`` of the document in the caller's list. The API
tier is server-authoritative here (§54): the browser may have reranked locally
for latency, but this ordering is the one that decides which chunks become
citations, so it is recomputed rather than trusted. Documents are never returned
reordered in place — the index mapping is what makes a mis-attribution
impossible.

``scores`` (input order, every document, even those cut by ``top_k``) is
returned alongside, because a caller that blends the rerank score with its own
retrieval score — ``apps/api``'s ``blend_retrieval`` does — needs the score for
candidates that did not make the cut.

Text is not echoed by default. ``return_documents`` exists for interactive
debugging, but the caller already has the text it sent, and echoing it doubles
the size of every response that crosses the AUP boundary for no new information.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Annotated, Any, Final

from fastapi import APIRouter, status
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from app.api.deps import AuthDep, RequestIdDep, StateDep
from app.api.routes_embed import ERROR_RESPONSES, Timings
from app.core.errors import FieldError, ProblemDetail, ValidationFailedError
from app.preprocessing.text import guard_length

if TYPE_CHECKING:
    from app.api.deps import ServiceState


router = APIRouter(tags=["rerank"])

_RERANK_RESPONSES: Final[dict[int | str, dict[str, Any]]] = {
    **ERROR_RESPONSES,
    400: {"model": ProblemDetail, "description": "Model not permitted, or not a reranker"},
}


class RerankUsage(BaseModel):
    """Token accounting for a pair batch. Counts only."""

    prompt_tokens: int
    total_tokens: int
    padded_tokens: int
    truncated_count: int
    batch_count: int
    max_sequence_length: int


class RerankRequest(BaseModel):
    """TEI/Infinity-compatible body, with the Cohere spellings as aliases."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True, protected_namespaces=())

    query: str
    documents: list[str] = Field(
        validation_alias=AliasChoices("texts", "documents"),
        description="Candidate documents, in the caller's own order.",
    )
    #: ``None`` selects ``default_rerank_model``.
    model: str | None = None
    #: How many ranked entries to return. ``None`` returns all of them.
    top_k: Annotated[int, Field(ge=1)] | None = Field(
        default=None,
        validation_alias=AliasChoices("top_k", "top_n"),
    )
    #: Echo the document text in each result. Off by default; see the docstring.
    return_documents: bool = Field(
        default=False,
        validation_alias=AliasChoices("return_documents", "return_text"),
    )
    max_length: Annotated[int, Field(ge=1)] | None = None
    batch_size: Annotated[int, Field(ge=1)] | None = None


class RerankResultItem(BaseModel):
    """One ranked document."""

    #: Position in the caller's ``documents`` list. Never a reordered copy.
    index: int
    score: float
    #: Same value as ``score``; the two spellings exist in this API family.
    relevance_score: float
    document: str | None = None


class RerankResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    #: Descending by score, ties broken by input order.
    results: list[RerankResultItem]
    #: Every score, in input order — including documents cut by ``top_k``.
    scores: list[float]
    #: The **resolved** model id, never the alias the caller sent.
    model: str
    #: Which calibration the manifest applied (``sigmoid`` / ``softmax`` / ``none``).
    #: Scores are only comparable across requests that report the same value.
    activation: str
    usage: RerankUsage
    timings: Timings


def _guard(state: ServiceState, body: RerankRequest) -> None:
    """Apply the deployment's limits before a model is loaded."""
    settings = state.settings
    guard_length(
        [body.query],
        max_items=1,
        max_chars=settings.max_input_chars,
        field="body.query",
    )
    guard_length(
        body.documents,
        max_items=settings.max_texts_per_request,
        max_chars=settings.max_input_chars,
        field="body.documents",
    )
    if body.batch_size is not None and body.batch_size > settings.max_batch_size:
        raise ValidationFailedError(
            f"batch_size {body.batch_size} exceeds this deployment's maximum of "
            f"{settings.max_batch_size}.",
            errors=[
                FieldError(
                    field="body.batch_size",
                    message=f"at most {settings.max_batch_size}",
                )
            ],
            log_context={
                "reason": "batch_size_too_large",
                "batch_size": body.batch_size,
                "max_batch_size": settings.max_batch_size,
            },
        )


@router.post(
    "/rerank",
    status_code=status.HTTP_200_OK,
    summary="Rerank documents against a query with a cross-encoder",
    response_model=RerankResponse,
    response_model_exclude_none=True,
    responses=_RERANK_RESPONSES,
)
async def rerank(
    body: RerankRequest,
    state: StateDep,
    request_id: RequestIdDep,
    _auth: AuthDep,
) -> RerankResponse:
    _guard(state, body)

    started = time.perf_counter()
    result = await state.reranker.rerank(
        body.query,
        body.documents,
        model_id=body.model,
        top_k=body.top_k,
        max_length=body.max_length,
        batch_size=body.batch_size,
        request_id=request_id,
    )
    return RerankResponse(
        results=[
            RerankResultItem(
                index=scored.index,
                score=scored.score,
                relevance_score=scored.score,
                document=body.documents[scored.index] if body.return_documents else None,
            )
            for scored in result.ranking
        ],
        scores=list(result.scores),
        model=result.model_id,
        activation=result.activation,
        usage=RerankUsage(
            prompt_tokens=result.total_tokens,
            total_tokens=result.total_tokens,
            padded_tokens=result.padded_tokens,
            truncated_count=result.truncated_count,
            batch_count=result.batch_count,
            max_sequence_length=result.max_sequence_length,
        ),
        timings=Timings(
            tokenize_ms=result.tokenize_ms,
            inference_ms=result.inference_ms,
            total_ms=round((time.perf_counter() - started) * 1000, 3),
        ),
    )


__all__ = [
    "RerankRequest",
    "RerankResponse",
    "RerankResultItem",
    "RerankUsage",
    "router",
]
