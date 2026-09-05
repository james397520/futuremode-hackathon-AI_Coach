"""Embedding endpoints (spec §2.1 private embedding, §12.1, §65 ingest).

Two shapes, one kernel
----------------------
``POST /v1/embeddings``
    The OpenAI-compatible shape, because that is what the caller already speaks:
    ``apps/api/app/rag/embedder.py::LocalEmbedder`` posts
    ``{"model", "input"}`` to ``{base_url}/embeddings`` and reads
    ``data[].embedding`` sorted by ``data[].index``. vLLM, Infinity and TEI all
    expose the same shape, so a deployment can put any of them behind the same
    API-tier configuration and this service is a drop-in.

    Note what it deliberately does **not** do: it applies **no instruction
    prefix**. ``LocalEmbedder`` applies ``spec.query_prefix`` /
    ``spec.passage_prefix`` itself before it posts, and applying the manifest's
    prefix again here would embed ``"query: query: …"`` for an e5 model —
    silently, and only for the query side, which is the shape of bug that makes
    retrieval mysteriously worse. A caller that wants the server to own the
    prefix uses the native route below and says which side it is on.

``POST /v1/embed``
    The native shape: explicit ``kind`` (query / passage / raw), per-request
    normalisation, sequence-length and batch-size overrides, and a usage block
    with token counts, truncation count and timings. This is the one to reach for
    when building something new against this service.

Batch is the important path
---------------------------
RAG ingest embeds every chunk of a document (§65 parse → chunk → embed → index),
so a request of a few hundred texts is the normal case, not the exotic one. Both
routes accept a list; the kernel groups by token length, executes in batches of
at most ``max_batch_size``, and scatters results back into input order. **The
vector at index i is always the embedding of the input at index i** — the caller
writes these against chunk ids by position, so any reordering would
mis-attribute every chunk in the batch.

Limits, and why they are checked here
-------------------------------------
``max_texts_per_request`` and ``max_input_chars`` are re-checked at the route,
before the loader is asked for a model. The kernel checks them too (in
``preprocessing.text.prepare``), but only after ``loader.get`` has possibly spent
seconds hashing a 2 GB graph — and a caller that sent 10 000 chunks deserves a
413 that names the limit, not a timeout. ``batch_size`` above the deployment's
ceiling is a 422 rather than a silent clamp: a caller asking for 512-item
batches has made a sizing assumption that is wrong, and telling it so is kinder
than quietly serving 32.

Content never reaches the logs. These routes log nothing themselves — the
middleware records the route template and the kernel records counts, model ids
and timings through ``log_inference``, whose typed field set has no key that can
hold text (§49.5).
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Annotated, Any, Final

from fastapi import APIRouter, status
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.api.deps import AuthDep, RequestIdDep, StateDep
from app.core.errors import FieldError, ProblemDetail, ValidationFailedError
from app.inference.embedder import TextKind
from app.preprocessing.text import guard_length

if TYPE_CHECKING:
    from app.api.deps import ServiceState
    from app.inference.embedder import EmbeddingResult


router = APIRouter(tags=["embedding"])

#: Every failure body on these routes is a :class:`ProblemDetail`.
ERROR_RESPONSES: Final[dict[int | str, dict[str, Any]]] = {
    400: {"model": ProblemDetail, "description": "Model not permitted or wrong kind"},
    401: {"model": ProblemDetail, "description": "Missing or invalid service credential"},
    404: {"model": ProblemDetail, "description": "Model not in the manifest"},
    413: {"model": ProblemDetail, "description": "Too many inputs, or an input too long"},
    422: {"model": ProblemDetail, "description": "Validation failed"},
    503: {"model": ProblemDetail, "description": "Model not ready, or at capacity"},
}


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class Usage(BaseModel):
    """Token accounting. Counts only — never the tokens themselves."""

    #: Non-padding tokens actually fed to the model.
    prompt_tokens: int
    total_tokens: int
    #: Tokens including padding. The gap shows how well batching worked.
    padded_tokens: int
    #: Inputs that hit the sequence limit and lost their tail.
    truncated_count: int
    #: ONNX executions this request was split into.
    batch_count: int
    #: The effective sequence window, after every ceiling was applied.
    max_sequence_length: int


class Timings(BaseModel):
    """Server-side latency breakdown, for the caller's own tracing."""

    tokenize_ms: float
    inference_ms: float
    total_ms: float


class EmbeddingsRequest(BaseModel):
    """OpenAI-compatible ``/v1/embeddings`` body."""

    model_config = ConfigDict(extra="ignore", protected_namespaces=())

    #: ``None`` selects ``default_embedding_model``.
    model: str | None = None
    #: A single string or a list of them. A single string yields one vector.
    input: str | list[str]
    #: Accepted for compatibility; ``base64`` is not supported (see the validator).
    encoding_format: str = "float"
    #: OpenAI's dimension-truncation parameter. Refused rather than ignored: a
    #: silently full-width vector would be indexed against a narrower collection.
    dimensions: int | None = None
    #: Ignored; present so a client that always sends it is not rejected.
    user: str | None = None

    @field_validator("encoding_format")
    @classmethod
    def _float_only(cls, value: str) -> str:
        if value != "float":
            msg = "only the 'float' encoding_format is supported"
            raise ValueError(msg)
        return value

    @property
    def texts(self) -> list[str]:
        return [self.input] if isinstance(self.input, str) else list(self.input)


class EmbedRequest(BaseModel):
    """Native ``/v1/embed`` body."""

    model_config = ConfigDict(extra="forbid", protected_namespaces=())

    texts: list[str]
    model: str | None = None
    #: Which instruction prefix the manifest should apply. ``raw`` for a caller
    #: that has already applied its own.
    kind: TextKind = TextKind.PASSAGE
    #: ``None`` defers to the manifest's ``normalize`` flag for the model.
    normalize: bool | None = None
    #: Per-request sequence ceiling. Never *raises* the deployment's ceiling.
    max_length: Annotated[int, Field(ge=1)] | None = None
    #: Items per ONNX execution. Never *raises* ``max_batch_size``.
    batch_size: Annotated[int, Field(ge=1)] | None = None


class EmbedQueryRequest(BaseModel):
    """Native single-text convenience body, mirroring ``embed_query``."""

    model_config = ConfigDict(extra="forbid", protected_namespaces=())

    text: str
    model: str | None = None
    kind: TextKind = TextKind.QUERY
    normalize: bool | None = None
    max_length: Annotated[int, Field(ge=1)] | None = None


class EmbeddingItem(BaseModel):
    object: str = "embedding"
    index: int
    embedding: list[float]


class EmbeddingsResponse(BaseModel):
    """OpenAI-compatible response, plus the fields an index needs to stay honest."""

    model_config = ConfigDict(protected_namespaces=())

    object: str = "list"
    data: list[EmbeddingItem]
    #: The **resolved** model id, never the alias the caller sent.
    model: str
    #: Not in OpenAI's shape, and load-bearing here: the vector store namespaces
    #: collections by (model, dimension) and mixing geometries corrupts an index.
    dimension: int
    normalized: bool
    usage: Usage


class EmbedResponse(BaseModel):
    """Native response: vectors in input order, with per-item token counts."""

    model_config = ConfigDict(protected_namespaces=())

    model: str
    dimension: int
    normalized: bool
    vectors: list[list[float]]
    #: Non-padding token count per input, in input order.
    token_counts: list[int]
    usage: Usage
    timings: Timings


class EmbedQueryResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    model: str
    dimension: int
    normalized: bool
    vector: list[float]
    usage: Usage
    timings: Timings


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _guard(
    state: ServiceState,
    texts: list[str],
    *,
    field: str,
    batch_size: int | None = None,
) -> None:
    """Apply the deployment's request-shape limits before touching a model."""
    settings = state.settings
    guard_length(
        texts,
        max_items=settings.max_texts_per_request,
        max_chars=settings.max_input_chars,
        field=field,
    )
    if batch_size is not None and batch_size > settings.max_batch_size:
        raise ValidationFailedError(
            f"batch_size {batch_size} exceeds this deployment's maximum of "
            f"{settings.max_batch_size}.",
            errors=[
                FieldError(
                    field="body.batch_size",
                    message=f"at most {settings.max_batch_size}",
                )
            ],
            log_context={
                "reason": "batch_size_too_large",
                "batch_size": batch_size,
                "max_batch_size": settings.max_batch_size,
            },
        )


def _usage(result: EmbeddingResult) -> Usage:
    return Usage(
        prompt_tokens=result.total_tokens,
        total_tokens=result.total_tokens,
        padded_tokens=result.padded_tokens,
        truncated_count=result.truncated_count,
        batch_count=result.batch_count,
        max_sequence_length=result.max_sequence_length,
    )


def _timings(result: EmbeddingResult, *, started: float) -> Timings:
    return Timings(
        tokenize_ms=result.tokenize_ms,
        inference_ms=result.inference_ms,
        total_ms=round((time.perf_counter() - started) * 1000, 3),
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post(
    "/embeddings",
    status_code=status.HTTP_200_OK,
    summary="Embed one or many texts (OpenAI-compatible shape)",
    # `response_model=None` with an explicit `responses` entry: the body is a
    # float matrix that can run to megabytes, and letting FastAPI re-validate it
    # through the response model would double the CPU cost of every ingest batch
    # for no added safety — the kernel already guarantees shape and finiteness.
    # OpenAPI still documents the real model.
    response_model=None,
    responses={200: {"model": EmbeddingsResponse}, **ERROR_RESPONSES},
)
async def create_embeddings(
    body: EmbeddingsRequest,
    state: StateDep,
    request_id: RequestIdDep,
    _auth: AuthDep,
) -> ORJSONResponse:
    if body.dimensions is not None:
        raise ValidationFailedError(
            "Dimension truncation is not supported: a knowledge base is indexed at "
            "the model's native width and mixing widths corrupts the collection.",
            errors=[FieldError(field="body.dimensions", message="not supported")],
            log_context={"reason": "dimensions_unsupported"},
        )
    texts = body.texts
    _guard(state, texts, field="body.input")

    result = await state.embedder.embed(
        texts,
        model_id=body.model,
        # See the module docstring: the caller owns the prefix on this route.
        kind=TextKind.RAW,
        request_id=request_id,
    )
    payload = {
        "object": "list",
        "data": [
            {"object": "embedding", "index": index, "embedding": vector}
            for index, vector in enumerate(result.vectors)
        ],
        "model": result.model_id,
        "dimension": result.dimension,
        "normalized": result.normalized,
        "usage": _usage(result).model_dump(),
    }
    return ORJSONResponse(content=payload)


@router.post(
    "/embed",
    status_code=status.HTTP_200_OK,
    summary="Embed a batch of texts (native shape, explicit query/passage side)",
    response_model=None,
    responses={200: {"model": EmbedResponse}, **ERROR_RESPONSES},
)
async def embed_batch(
    body: EmbedRequest,
    state: StateDep,
    request_id: RequestIdDep,
    _auth: AuthDep,
) -> ORJSONResponse:
    _guard(state, body.texts, field="body.texts", batch_size=body.batch_size)

    started = time.perf_counter()
    result = await state.embedder.embed(
        body.texts,
        model_id=body.model,
        kind=body.kind,
        normalize=body.normalize,
        max_length=body.max_length,
        batch_size=body.batch_size,
        request_id=request_id,
    )
    payload = {
        "model": result.model_id,
        "dimension": result.dimension,
        "normalized": result.normalized,
        "vectors": result.vectors,
        "token_counts": list(result.token_counts),
        "usage": _usage(result).model_dump(),
        "timings": _timings(result, started=started).model_dump(),
    }
    return ORJSONResponse(content=payload)


@router.post(
    "/embed/query",
    status_code=status.HTTP_200_OK,
    summary="Embed a single query (native shape, query-side prefix by default)",
    response_model=EmbedQueryResponse,
    responses=ERROR_RESPONSES,
)
async def embed_query(
    body: EmbedQueryRequest,
    state: StateDep,
    request_id: RequestIdDep,
    _auth: AuthDep,
) -> EmbedQueryResponse:
    """One text, one vector.

    Returned as a model rather than a hand-built response: a single vector is
    small enough that validation costs nothing, and the typed body is what the
    OpenAPI consumer sees.
    """
    _guard(state, [body.text], field="body.text")

    started = time.perf_counter()
    result = await state.embedder.embed(
        [body.text],
        model_id=body.model,
        kind=body.kind,
        normalize=body.normalize,
        max_length=body.max_length,
        request_id=request_id,
    )
    return EmbedQueryResponse(
        model=result.model_id,
        dimension=result.dimension,
        normalized=result.normalized,
        vector=result.vectors[0],
        usage=_usage(result),
        timings=_timings(result, started=started),
    )


__all__ = [
    "EmbedQueryRequest",
    "EmbedQueryResponse",
    "EmbedRequest",
    "EmbedResponse",
    "EmbeddingsRequest",
    "EmbeddingsResponse",
    "Timings",
    "Usage",
    "router",
]
