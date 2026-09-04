"""``/knowledge-bases`` — knowledge base CRUD and §39 access control.

Business logic (counters, ACL evaluation, cascade to Qdrant) lives in
``app.services.knowledge_service.KnowledgeService``; this module only validates,
authorises, delegates and audits.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.core.deps import AuditDep, Ctx, Permission, provide_service, require_permission
from app.core.rate_limit import rate_limit
from app.domain.audit import AuditAction
from app.domain.common import Acknowledgement, Page, PageParams
from app.domain.enums import ContentStatus
from app.domain.request_response import (
    ContentReviewRequest,
    KnowledgeAclUpdateRequest,
    KnowledgeBaseCreateRequest,
    KnowledgeBaseResponse,
    KnowledgeBaseUpdateRequest,
)
from app.services.knowledge_service import KnowledgeService

router = APIRouter(prefix="/knowledge-bases", tags=["knowledge"])

KnowledgeDep = Annotated[KnowledgeService, Depends(provide_service(KnowledgeService))]
CanRead = Annotated[Ctx, Depends(require_permission(Permission.KNOWLEDGE_READ))]
CanWrite = Annotated[Ctx, Depends(require_permission(Permission.KNOWLEDGE_WRITE))]
CanAdminAcl = Annotated[Ctx, Depends(require_permission(Permission.KNOWLEDGE_ACL_ADMIN))]
CanPublish = Annotated[Ctx, Depends(require_permission(Permission.CONTENT_PUBLISH))]


@router.get(
    "",
    response_model=Page[KnowledgeBaseResponse],
    summary="List knowledge bases visible to the caller (§39)",
    dependencies=[Depends(rate_limit("kb.read", per_minute=120))],
)
async def list_knowledge_bases(
    service: KnowledgeDep,
    ctx: CanRead,
    params: Annotated[PageParams, Depends()],
    status_filter: Annotated[ContentStatus | None, Query(alias="status")] = None,
) -> Page[KnowledgeBaseResponse]:
    """The ACL filter is applied inside the service; this list is never tenant-wide."""
    return await service.list_knowledge_bases(params=params, status=status_filter)


@router.get(
    "/{knowledge_base_id}",
    response_model=KnowledgeBaseResponse,
    summary="Read one knowledge base",
)
async def get_knowledge_base(
    knowledge_base_id: str, service: KnowledgeDep, ctx: CanRead
) -> KnowledgeBaseResponse:
    return await service.get_knowledge_base(knowledge_base_id)


@router.post(
    "",
    response_model=KnowledgeBaseResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a knowledge base",
    dependencies=[Depends(rate_limit("kb.write", per_minute=20))],
)
async def create_knowledge_base(
    payload: KnowledgeBaseCreateRequest,
    service: KnowledgeDep,
    ctx: CanWrite,
    audit: AuditDep,
) -> KnowledgeBaseResponse:
    knowledge_base = await service.create_knowledge_base(payload)
    await audit(
        AuditAction.KNOWLEDGE_CHANGE,
        f"knowledge_base:{knowledge_base.id}",
        detail={"operation": "create"},
    )
    return knowledge_base


@router.patch(
    "/{knowledge_base_id}",
    response_model=KnowledgeBaseResponse,
    summary="Update a knowledge base",
    dependencies=[Depends(rate_limit("kb.write", per_minute=40))],
)
async def update_knowledge_base(
    knowledge_base_id: str,
    payload: KnowledgeBaseUpdateRequest,
    service: KnowledgeDep,
    ctx: CanWrite,
    audit: AuditDep,
) -> KnowledgeBaseResponse:
    knowledge_base = await service.update_knowledge_base(knowledge_base_id, payload)
    await audit(
        AuditAction.KNOWLEDGE_CHANGE,
        f"knowledge_base:{knowledge_base_id}",
        detail={"operation": "update", "fields": sorted(payload.model_dump(exclude_none=True))},
    )
    return knowledge_base


@router.put(
    "/{knowledge_base_id}/acl",
    response_model=KnowledgeBaseResponse,
    summary="Replace the §39 access control list",
    dependencies=[Depends(rate_limit("kb.acl", per_minute=20))],
)
async def update_acl(
    knowledge_base_id: str,
    payload: KnowledgeAclUpdateRequest,
    service: KnowledgeDep,
    ctx: CanAdminAcl,
    audit: AuditDep,
) -> KnowledgeBaseResponse:
    """Admin-only. Recorded as a permission change because it widens data access."""
    knowledge_base = await service.update_acl(knowledge_base_id, payload)
    await audit(
        AuditAction.PERMISSION_CHANGE,
        f"knowledge_base:{knowledge_base_id}/acl",
        detail={
            "scope": payload.acl.scope.value,
            "subjects": len(payload.acl.subject_ids),
            "permissions": [item.value for item in payload.acl.permissions],
        },
    )
    return knowledge_base


@router.post(
    "/{knowledge_base_id}/review",
    response_model=KnowledgeBaseResponse,
    summary="Move a knowledge base through the §38 approval workflow",
    dependencies=[Depends(rate_limit("kb.review", per_minute=30))],
)
async def review_knowledge_base(
    knowledge_base_id: str,
    payload: ContentReviewRequest,
    service: KnowledgeDep,
    ctx: CanPublish,
    audit: AuditDep,
) -> KnowledgeBaseResponse:
    knowledge_base = await service.review_knowledge_base(knowledge_base_id, payload)
    await audit(
        AuditAction.KNOWLEDGE_CHANGE,
        f"knowledge_base:{knowledge_base_id}",
        detail={"operation": "review", "status": payload.status.value},
    )
    return knowledge_base


@router.delete(
    "/{knowledge_base_id}",
    response_model=Acknowledgement,
    summary="Delete a knowledge base (soft delete + retention, §40.2)",
    dependencies=[Depends(rate_limit("kb.write", per_minute=10))],
)
async def delete_knowledge_base(
    knowledge_base_id: str, service: KnowledgeDep, ctx: CanWrite, audit: AuditDep
) -> Acknowledgement:
    """Marks the base deleted and schedules the vector/object purge (§40.2)."""
    await service.delete_knowledge_base(knowledge_base_id)
    await audit(
        AuditAction.FILE_DELETE,
        f"knowledge_base:{knowledge_base_id}",
        detail={"operation": "delete"},
    )
    return Acknowledgement(ok=True, id=knowledge_base_id)
