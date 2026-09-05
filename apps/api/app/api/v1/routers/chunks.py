"""``/chunks`` — the §30 Chunk Viewer surface.

Editing a chunk re-embeds *that chunk only* and is audited as ``chunk_edit`` (§42).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.deps import AuditDep, Ctx, Permission, provide_service, require_permission
from app.core.rate_limit import rate_limit
from app.domain.audit import AuditAction
from app.domain.common import Acknowledgement, Page, PageParams
from app.domain.request_response import ChunkResponse, ChunkUpdateRequest
from app.services.knowledge_service import KnowledgeService

router = APIRouter(prefix="/chunks", tags=["chunks"])

KnowledgeDep = Annotated[KnowledgeService, Depends(provide_service(KnowledgeService))]
CanRead = Annotated[Ctx, Depends(require_permission(Permission.KNOWLEDGE_READ))]
CanWrite = Annotated[Ctx, Depends(require_permission(Permission.KNOWLEDGE_WRITE))]


@router.get(
    "",
    response_model=Page[ChunkResponse],
    summary="List chunks of a document or knowledge base",
    dependencies=[Depends(rate_limit("chunks.read", per_minute=180))],
)
async def list_chunks(
    service: KnowledgeDep,
    ctx: CanRead,
    params: Annotated[PageParams, Depends()],
    document_id: Annotated[str | None, Query()] = None,
    knowledge_base_id: Annotated[str | None, Query()] = None,
    q: Annotated[str | None, Query(max_length=200, description="Substring search")] = None,
) -> Page[ChunkResponse]:
    """At least one of ``document_id`` / ``knowledge_base_id`` must be supplied."""
    return await service.list_chunks(
        params=params,
        document_id=document_id,
        knowledge_base_id=knowledge_base_id,
        query=q,
    )


@router.get("/{chunk_id}", response_model=ChunkResponse, summary="Read one chunk")
async def get_chunk(chunk_id: str, service: KnowledgeDep, ctx: CanRead) -> ChunkResponse:
    return await service.get_chunk(chunk_id)


@router.patch(
    "/{chunk_id}",
    response_model=ChunkResponse,
    summary="Edit chunk text, tags or retrieval exclusion",
    dependencies=[Depends(rate_limit("chunks.write", per_minute=60))],
)
async def update_chunk(
    chunk_id: str,
    payload: ChunkUpdateRequest,
    service: KnowledgeDep,
    ctx: CanWrite,
    audit: AuditDep,
) -> ChunkResponse:
    chunk = await service.update_chunk(chunk_id, payload)
    await audit(
        AuditAction.CHUNK_EDIT,
        f"chunk:{chunk_id}",
        detail={"fields": sorted(payload.model_dump(exclude_none=True))},
    )
    return chunk


@router.delete(
    "/{chunk_id}",
    response_model=Acknowledgement,
    summary="Delete a chunk and its vector",
    dependencies=[Depends(rate_limit("chunks.write", per_minute=30))],
)
async def delete_chunk(
    chunk_id: str, service: KnowledgeDep, ctx: CanWrite, audit: AuditDep
) -> Acknowledgement:
    await service.delete_chunk(chunk_id)
    await audit(AuditAction.CHUNK_EDIT, f"chunk:{chunk_id}", detail={"operation": "delete"})
    return Acknowledgement(ok=True, id=chunk_id)
