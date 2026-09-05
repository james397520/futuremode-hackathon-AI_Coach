"""``/retrieval`` — the §31 Retrieval Playground (``POST /api/retrieval/test``, §69).

The route is a thin adapter over ``app.rag.pipeline.RagPipeline``: it authorises the
knowledge bases, forwards the query and returns hits with the latency breakdown §49.5
requires. It performs no embedding or search itself.

Tenant safety: the pipeline receives the request context, and every Qdrant filter it
builds carries ``tenant_id`` + ``workspace_id`` + ``knowledge_base_id`` (§74), mirroring
the SQL guard.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.context import RequestContext
from app.core.deps import (
    AuditDep,
    Ctx,
    DbSession,
    Permission,
    Scope,
    require_permission,
)
from app.core.rate_limit import rate_limit
from app.domain.audit import AuditAction
from app.domain.request_response import RetrievalTestRequest, RetrievalTestResponse
from app.rag.pipeline import RagPipeline

router = APIRouter(prefix="/retrieval", tags=["retrieval"])

CanTest = Annotated[RequestContext, Depends(require_permission(Permission.RETRIEVAL_TEST))]


def _pipeline(db: DbSession, ctx: Ctx, scope: Scope) -> RagPipeline:
    """Construct the RAG pipeline with the guard already armed on this session."""
    _ = scope
    return RagPipeline(db, ctx)


PipelineDep = Annotated[RagPipeline, Depends(_pipeline)]


@router.post(
    "/test",
    response_model=RetrievalTestResponse,
    summary="Run a retrieval query against selected knowledge bases (§31)",
    dependencies=[Depends(rate_limit("retrieval.test", per_minute=30, burst=10, cost=2))],
)
async def test_retrieval(
    payload: RetrievalTestRequest,
    pipeline: PipelineDep,
    ctx: CanTest,
    audit: AuditDep,
) -> RetrievalTestResponse:
    """Retrieve + optionally rerank, returning citations and per-stage latency.

    The query text itself is **not** audited or logged (§49.5): only which knowledge
    bases were searched and how many hits came back.
    """
    result = await pipeline.retrieve_for_test(payload)
    await audit(
        AuditAction.API_ACCESS,
        "retrieval:test",
        detail={
            "knowledge_bases": len(payload.knowledge_base_ids),
            "top_k": payload.top_k,
            "reranked": payload.use_reranker,
            "hits": len(result.hits),
        },
    )
    return result
