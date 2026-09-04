"""Model introspection — what this deployment can serve, and from which bytes.

This endpoint exists to make a deployment **auditable**. "Which reranker was
actually running when this evaluation was produced?" is a question that gets
asked months later, and the answer has to come from the running process rather
than from a wiki page: the manifest is mounted configuration, the allowlist can
narrow it further, and an alias can point two ids at the same weights. So each
entry reports the resolved identity — canonical id, aliases, ``revision``, the
quantisation variant, the source it came from — together with the sha256 of the
graph and tokenizer files this process verified.

Digests are the load-bearing part. The registry refuses to load a file whose
digest does not match the manifest (a mismatched ``model.onnx`` produces
plausible-looking vectors from the wrong weights, which Qdrant accepts silently),
and reporting the digest here is what lets an auditor tie a vector collection to
the exact bytes that produced it.

``GET /v1/models`` mirrors the OpenAI listing shape (``{"object": "list",
"data": [...]}``) for the same reason ``/v1/embeddings`` does: the private
deployment is meant to be swappable with the tooling that already exists.

Nothing here is authenticated data, but the route still sits behind the shared
secret: the list of installed models is deployment topology, and there is no
caller that needs it without a credential.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Final

from fastapi import APIRouter, status
from pydantic import BaseModel, ConfigDict

from app.api.deps import AuthDep, ModelState, StateDep
from app.core.errors import ProblemDetail

if TYPE_CHECKING:
    from app.api.deps import ServiceState
    from app.models.registry import ModelEntry


router = APIRouter(tags=["models"])

_RESPONSES: Final[dict[int | str, dict[str, Any]]] = {
    401: {"model": ProblemDetail, "description": "Missing or invalid service credential"},
    404: {"model": ProblemDetail, "description": "Model not in the manifest"},
    400: {"model": ProblemDetail, "description": "Model not permitted on this deployment"},
}


class ModelFileInfo(BaseModel):
    """One file and the digest this process verified it against."""

    name: str
    sha256: str
    bytes: int


class ModelInfo(BaseModel):
    """Everything needed to audit or reproduce one served model."""

    model_config = ConfigDict(protected_namespaces=())

    id: str
    object: str = "model"
    #: Alternative ids that resolve to these same weights (the browser tier's
    #: short names, so §54's client/server comparison is meaningful).
    aliases: list[str]
    task: str
    #: Current load state in this process — see ``/readyz`` for the same vocabulary.
    state: ModelState
    warm: bool
    preloaded: bool
    #: True once the sha256 of every file has been checked in this process.
    verified: bool
    #: Failure code when the last load attempt failed.
    reason: str | None = None

    # --- geometry / behaviour, all manifest data ---
    dimension: int | None = None
    max_sequence_length: int
    #: The window actually applied, after the deployment's global ceiling.
    effective_max_length: int
    pooling: str
    normalize: bool
    score_activation: str
    query_prefix: str
    passage_prefix: str

    # --- provenance ---
    #: Upstream revision (commit / tag) the weights were exported from.
    revision: str
    #: Quantisation variant: ``none``, ``int8``, ``fp16``, …
    quantization: str
    source: str
    license: str
    notes: str
    resident_mb: float
    files: list[ModelFileInfo]

    # --- execution ---
    device: str
    execution_providers: list[str]


class ModelListResponse(BaseModel):
    object: str = "list"
    data: list[ModelInfo]
    #: True when the allowlist is narrowing the manifest, so an operator can tell
    #: "not installed" from "installed but not permitted here".
    allowlist_active: bool


def _describe(state: ServiceState, entry: ModelEntry) -> ModelInfo:
    settings = state.settings
    stats = state.loader.stats()
    failure = stats.load_failures.get(entry.id)
    if failure is not None:
        model_state = ModelState.FAILED
    elif entry.id in set(stats.warm):
        model_state = ModelState.READY
    elif entry.id in set(stats.loaded):
        model_state = ModelState.LOADED
    else:
        model_state = ModelState.AVAILABLE
    return ModelInfo(
        id=entry.id,
        aliases=list(entry.aliases),
        task=entry.task.value,
        state=model_state,
        warm=entry.id in set(stats.warm),
        preloaded=entry.id in settings.preload_models,
        verified=state.registry.is_verified(entry.id),
        reason=failure,
        dimension=entry.dimension,
        max_sequence_length=entry.max_sequence_length,
        effective_max_length=settings.effective_max_length(entry.max_sequence_length),
        pooling=entry.pooling.value,
        normalize=entry.normalize,
        score_activation=entry.score_activation.value,
        query_prefix=entry.query_prefix,
        passage_prefix=entry.passage_prefix,
        revision=entry.revision,
        quantization=entry.quantization,
        source=entry.source,
        license=entry.license,
        notes=entry.notes,
        resident_mb=entry.estimated_resident_mb,
        files=[
            ModelFileInfo(name=spec.name, sha256=spec.sha256, bytes=spec.bytes)
            for spec in entry.files
        ],
        device=settings.device.value,
        execution_providers=list(settings.execution_providers),
    )


@router.get(
    "/models",
    status_code=status.HTTP_200_OK,
    response_model=ModelListResponse,
    summary="List the models this deployment may serve, with resolved provenance",
    responses=_RESPONSES,
)
async def list_models(state: StateDep, _auth: AuthDep) -> ModelListResponse:
    """Everything in the manifest that survived the allowlist, sorted by id.

    An empty list with a healthy manifest means the allowlist excluded
    everything; an empty list with ``manifest.ok == false`` on ``/readyz`` means
    the manifest itself could not be read.
    """
    return ModelListResponse(
        data=[_describe(state, entry) for entry in state.registry.entries()],
        allowlist_active=bool(state.settings.model_allowlist),
    )


@router.get(
    # `:path` because canonical ids are HuggingFace-style and contain a slash
    # (`BAAI/bge-m3`); without it the router would 404 on every real model.
    "/models/{model_id:path}",
    status_code=status.HTTP_200_OK,
    response_model=ModelInfo,
    summary="Describe one model, resolving aliases to the canonical entry",
    responses=_RESPONSES,
)
async def get_model(model_id: str, state: StateDep, _auth: AuthDep) -> ModelInfo:
    """Aliases resolve here, so the response's ``id`` may differ from the path.

    ``resolve`` enforces the allowlist before manifest membership, so a caller
    probing for names cannot distinguish "not permitted" from "not installed"
    for anything off the list.
    """
    entry = state.registry.resolve(model_id)
    return _describe(state, entry)


__all__ = ["ModelFileInfo", "ModelInfo", "ModelListResponse", "router"]
