"""``/knowledge-bases/{id}/documents`` and ``/documents`` — upload + processing (§11 / §29).

Upload model (§40.2 / §73): the API **never proxies file bytes**. A client asks for a
signed upload URL, PUTs the bytes straight to object storage, then calls
``POST /documents/{id}/ingest`` which enqueues the async pipeline
(parse -> chunk -> embed -> index, §65). That keeps large payloads out of the API
process and keeps storage credentials server-side.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.core.deps import AuditDep, Ctx, Permission, provide_service, require_permission
from app.core.rate_limit import rate_limit
from app.domain.audit import AuditAction
from app.domain.common import Acknowledgement, Page, PageParams
from app.domain.enums import DocumentState
from app.domain.knowledge import DocumentVersion
from app.domain.request_response import (
    DocumentIngestRequest,
    DocumentJobAccepted,
    DocumentResponse,
    DocumentUploadRequest,
    DocumentUrlIngestRequest,
    SignedUploadResponse,
)
from app.services.knowledge_service import KnowledgeService

router = APIRouter(tags=["documents"])

KnowledgeDep = Annotated[KnowledgeService, Depends(provide_service(KnowledgeService))]
CanRead = Annotated[Ctx, Depends(require_permission(Permission.KNOWLEDGE_READ))]
CanWrite = Annotated[Ctx, Depends(require_permission(Permission.KNOWLEDGE_WRITE))]


@router.get(
    "/knowledge-bases/{knowledge_base_id}/documents",
    response_model=Page[DocumentResponse],
    summary="List documents in a knowledge base",
    dependencies=[Depends(rate_limit("documents.read", per_minute=120))],
)
async def list_documents(
    knowledge_base_id: str,
    service: KnowledgeDep,
    ctx: CanRead,
    params: Annotated[PageParams, Depends()],
    state: Annotated[DocumentState | None, Query()] = None,
) -> Page[DocumentResponse]:
    return await service.list_documents(knowledge_base_id, params=params, state=state)


@router.post(
    "/knowledge-bases/{knowledge_base_id}/documents",
    response_model=SignedUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Reserve a document and get a signed upload URL (§40.2)",
    dependencies=[Depends(rate_limit("documents.upload", per_minute=30))],
)
async def create_upload(
    knowledge_base_id: str,
    payload: DocumentUploadRequest,
    service: KnowledgeDep,
    ctx: CanWrite,
    audit: AuditDep,
) -> SignedUploadResponse:
    """Creates the metadata row in ``uploaded`` state and returns a short-lived URL.

    The response contains no storage credential — only a pre-signed target.
    """
    upload = await service.create_upload(knowledge_base_id, payload)
    await audit(
        AuditAction.FILE_UPLOAD,
        f"knowledge_base:{knowledge_base_id}/document:{upload.document_id}",
        detail={
            "operation": "signed_url_issued",
            "source_kind": payload.source_kind.value,
            "size_bytes": payload.size_bytes,
        },
    )
    return upload


@router.post(
    "/knowledge-bases/{knowledge_base_id}/documents/url",
    response_model=DocumentJobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Ingest a URL instead of a file",
    dependencies=[Depends(rate_limit("documents.upload", per_minute=20))],
)
async def ingest_url(
    knowledge_base_id: str,
    payload: DocumentUrlIngestRequest,
    service: KnowledgeDep,
    ctx: CanWrite,
    audit: AuditDep,
) -> DocumentJobAccepted:
    accepted = await service.ingest_url(knowledge_base_id, payload)
    await audit(
        AuditAction.FILE_UPLOAD,
        f"knowledge_base:{knowledge_base_id}/document:{accepted.document_id}",
        detail={"operation": "ingest_url", "job_id": accepted.job_id},
    )
    return accepted


@router.post(
    "/documents/{document_id}/ingest",
    response_model=DocumentJobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Confirm the upload finished and enqueue the §65 pipeline",
    dependencies=[Depends(rate_limit("documents.ingest", per_minute=30))],
)
async def ingest_document(
    document_id: str,
    payload: DocumentIngestRequest,
    service: KnowledgeDep,
    ctx: CanWrite,
    audit: AuditDep,
) -> DocumentJobAccepted:
    """Returns 202: progress is polled via ``GET /documents/{id}`` (§29)."""
    accepted = await service.ingest_document(document_id, payload)
    await audit(
        AuditAction.KNOWLEDGE_CHANGE,
        f"document:{document_id}",
        detail={"operation": "ingest", "job_id": accepted.job_id},
    )
    return accepted


@router.get(
    "/documents/{document_id}",
    response_model=DocumentResponse,
    summary="Read a document and its §29 processing progress",
)
async def get_document(
    document_id: str, service: KnowledgeDep, ctx: CanRead
) -> DocumentResponse:
    return await service.get_document(document_id)


@router.get(
    "/documents/{document_id}/versions",
    response_model=list[DocumentVersion],
    summary="Version history (§11.5)",
)
async def list_versions(
    document_id: str, service: KnowledgeDep, ctx: CanRead
) -> list[DocumentVersion]:
    return await service.list_document_versions(document_id)


@router.post(
    "/documents/{document_id}/reprocess",
    response_model=DocumentJobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Re-run parse/chunk/embed for a document",
    dependencies=[Depends(rate_limit("documents.ingest", per_minute=10))],
)
async def reprocess_document(
    document_id: str,
    payload: DocumentIngestRequest,
    service: KnowledgeDep,
    ctx: CanWrite,
    audit: AuditDep,
) -> DocumentJobAccepted:
    accepted = await service.reprocess_document(document_id, payload)
    await audit(
        AuditAction.KNOWLEDGE_CHANGE,
        f"document:{document_id}",
        detail={"operation": "reprocess", "job_id": accepted.job_id},
    )
    return accepted


@router.delete(
    "/documents/{document_id}",
    response_model=Acknowledgement,
    summary="Delete a document (soft delete; vectors and object purged by retention)",
    dependencies=[Depends(rate_limit("documents.write", per_minute=20))],
)
async def delete_document(
    document_id: str, service: KnowledgeDep, ctx: CanWrite, audit: AuditDep
) -> Acknowledgement:
    await service.delete_document(document_id)
    await audit(AuditAction.FILE_DELETE, f"document:{document_id}", detail={"operation": "delete"})
    return Acknowledgement(ok=True, id=document_id)
