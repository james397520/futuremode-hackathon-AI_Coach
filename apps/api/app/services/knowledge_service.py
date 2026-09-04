"""`KnowledgeService` — knowledge bases, documents, chunks, retrieval (§11, §12, §39).

Covers:

* KB CRUD / duplicate / archive / version / publish / unpublish (§11.1, §11.6)
* document upload **registration** (§11.2 validation, duplicate detection) and
  enqueueing the async parse->chunk->embed->index job (§11.3, §65) — the HTTP request
  never blocks on parsing
* the §39 knowledge ACL, enforced on every read *and* on every retrieval call
* the §11.5 chunk editor: view / edit / split / merge / delete / re-embed / add
  metadata / add tags / exclude from retrieval / restore
* the §12.4 retrieval playground

ACL enforcement is deliberately doubled: `_authorise()` checks the KB row before we
touch anything, and the vector query is *additionally* scoped by `TenantScope`
(tenant + workspace + KB allow-list + subject ids). A bug in one layer cannot leak
another tenant's knowledge.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from enum import StrEnum
from typing import Any

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.core.context import RequestContext  # assumed: app.core.context.RequestContext
from app.rag.chunker import ChunkConfig, TextChunk, estimate_tokens, merge_chunks, split_chunk
from app.rag.parser import MAX_UPLOAD_BYTES, MIME_BY_KIND, SourceKind
from app.rag.pipeline import RagPipeline, RagQueryResult
from app.services.base import (
    AUTHORING_ROLES,
    MANAGEMENT_ROLES,
    ROLE_ADMIN,
    BaseService,
    iso_now,
    new_id,
)
from app.services.exceptions import (
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    ValidationFailedError,
)
from app.services.repository import Repository, RepositoryPort, field

log = structlog.get_logger(__name__)


class AclPermission(StrEnum):
    """`KnowledgeAcl.permissions` in shared (§39)."""

    VIEW = "view"
    USE_FOR_RAG = "use_for_rag"
    EDIT = "edit"
    REVIEW = "review"
    PUBLISH = "publish"
    EXPORT = "export"
    DELETE = "delete"


#: §11.1 / §38 content status transitions for a knowledge base.
KB_TRANSITIONS: dict[str, frozenset[str]] = {
    "draft": frozenset({"review_required", "archived"}),
    "generated": frozenset({"review_required", "archived"}),
    "review_required": frozenset({"approved", "draft", "archived"}),
    "approved": frozenset({"published", "review_required", "archived"}),
    "published": frozenset({"archived", "approved"}),
    "archived": frozenset({"draft"}),
}


class CreateKnowledgeBaseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    description: str | None = None
    embedding_model: str = ""
    acl_scope: str = "workspace"
    acl_subject_ids: list[str] = Field(default_factory=list)
    acl_permissions: list[AclPermission] = Field(
        default_factory=lambda: [AclPermission.VIEW, AclPermission.USE_FOR_RAG]
    )


class RegisterUploadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    knowledge_base_id: str
    filename: str
    source_kind: SourceKind
    size_bytes: int = 0
    mime_type: str | None = None
    #: sha256 of the object in S3/MinIO — used for duplicate detection (§11.2)
    content_sha256: str = ""
    storage_key: str = ""
    url: str = ""
    manual_text: str = ""
    chunk_config: ChunkConfig = Field(default_factory=ChunkConfig)
    change_summary: str | None = None


class UploadRegistration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str
    version: int
    state: str = "uploaded"
    progress: int = 5
    job_id: str | None = None
    duplicate_of: str | None = None


class ChunkEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str | None = None
    metadata: dict[str, Any] | None = None
    tags: list[str] | None = None
    excluded_from_retrieval: bool | None = None


class PlaygroundResult(BaseModel):
    """§12.4 Retrieval Playground response."""

    model_config = ConfigDict(extra="forbid")

    query: str
    verdict: str
    max_similarity: float
    citations: list[dict[str, Any]] = Field(default_factory=list)
    context: str = ""
    trace: dict[str, Any] = Field(default_factory=dict)
    latency_ms: int = 0


class KnowledgeService(BaseService):
    """`Service(db_session, ctx)`."""

    def __init__(
        self,
        db: Any,
        ctx: RequestContext,
        *,
        repo: RepositoryPort | None = None,
        rag: RagPipeline | None = None,
        queue: Any | None = None,
    ) -> None:
        super().__init__(db, ctx)
        self.repo: RepositoryPort = repo or Repository(
            db, tenant_id=self.tenant_id, workspace_id=self.workspace_id
        )
        self._rag = rag
        self._queue = queue

    # ------------------------------------------------------------------
    # knowledge base CRUD (§11.1)
    # ------------------------------------------------------------------
    async def create_kb(self, request: CreateKnowledgeBaseRequest) -> Any:
        self.require_role(*AUTHORING_ROLES, action="create a knowledge base")
        if not request.name.strip():
            raise ValidationFailedError("knowledge base name is required")
        embedding_model = request.embedding_model or self._default_embedding_model()
        row = await self.repo.add(
            "KnowledgeBase",
            {
                **self.owned_fields(),
                "id": new_id("kb"),
                "name": request.name.strip(),
                "description": request.description,
                "status": "draft",
                "document_count": 0,
                "chunk_count": 0,
                "embedding_model": embedding_model,
                "acl": {
                    "scope": request.acl_scope,
                    "subject_ids": request.acl_subject_ids or [self.workspace_id],
                    "permissions": [str(p) for p in request.acl_permissions],
                },
                "created_at": iso_now(),
                "updated_at": iso_now(),
            },
        )
        await self.repo.commit()
        self.audit("kb.create", f"kb:{field(row, 'id')}")
        return row

    async def get_kb(self, kb_id: str, *, permission: AclPermission = AclPermission.VIEW) -> Any:
        return await self._authorise(kb_id, permission)

    async def list_kbs(self, *, limit: int = 100) -> list[Any]:
        rows = await self.repo.list("KnowledgeBase", order_by="-updated_at", limit=limit)
        return [row for row in rows if self._acl_allows(row, AclPermission.VIEW)]

    async def rename_kb(self, kb_id: str, name: str) -> Any:
        await self._authorise(kb_id, AclPermission.EDIT)
        if not name.strip():
            raise ValidationFailedError("name is required")
        row = await self.repo.update(
            "KnowledgeBase", kb_id, {"name": name.strip(), "updated_at": iso_now()}
        )
        await self.repo.commit()
        self.audit("kb.rename", f"kb:{kb_id}")
        return row

    async def duplicate_kb(self, kb_id: str, *, name: str | None = None) -> Any:
        source = await self._authorise(kb_id, AclPermission.EDIT)
        row = await self.repo.add(
            "KnowledgeBase",
            {
                **self.owned_fields(),
                "id": new_id("kb"),
                "name": name or f"{field(source, 'name')} (copy)",
                "description": field(source, "description"),
                "status": "draft",
                "document_count": 0,
                "chunk_count": 0,
                "embedding_model": field(source, "embedding_model"),
                "acl": field(source, "acl"),
                "created_at": iso_now(),
                "updated_at": iso_now(),
            },
        )
        await self.repo.commit()
        self.audit("kb.duplicate", f"kb:{kb_id}")
        return row

    async def set_status(self, kb_id: str, status: str) -> Any:
        permission = (
            AclPermission.PUBLISH if status in ("published", "approved") else AclPermission.EDIT
        )
        kb = await self._authorise(kb_id, permission)
        current = str(field(kb, "status", "draft"))
        if status != current and status not in KB_TRANSITIONS.get(current, frozenset()):
            from app.services.exceptions import StateTransitionError

            raise StateTransitionError("knowledge_base", current, status)
        if status == "published":
            ready = await self.repo.list(
                "KnowledgeDocument", filters={"knowledge_base_id": kb_id, "state": "ready"}
            )
            if not ready:
                raise ConflictError(
                    "cannot publish a knowledge base with no successfully indexed document"
                )
        row = await self.repo.update(
            "KnowledgeBase", kb_id, {"status": status, "updated_at": iso_now()}
        )
        await self.repo.commit()
        self.audit(f"kb.{status}", f"kb:{kb_id}")
        return row

    async def archive_kb(self, kb_id: str) -> Any:
        return await self.set_status(kb_id, "archived")

    async def delete_kb(self, kb_id: str) -> bool:
        await self._authorise(kb_id, AclPermission.DELETE)
        self.require_role(ROLE_ADMIN, action="delete a knowledge base")
        documents = await self.repo.list(
            "KnowledgeDocument", filters={"knowledge_base_id": kb_id}
        )
        for document in documents:
            await self._delete_vectors(str(field(document, "id")))
        deleted = await self.repo.delete("KnowledgeBase", kb_id)
        await self.repo.commit()
        self.audit("kb.delete", f"kb:{kb_id}", risk="medium")
        return deleted

    async def transfer_ownership(self, kb_id: str, new_owner_id: str) -> Any:
        await self._authorise(kb_id, AclPermission.EDIT)
        self.require_role(*MANAGEMENT_ROLES, action="transfer knowledge base ownership")
        row = await self.repo.update(
            "KnowledgeBase", kb_id, {"owner_id": new_owner_id, "updated_at": iso_now()}
        )
        await self.repo.commit()
        self.audit("kb.transfer_ownership", f"kb:{kb_id}", new_owner_id=new_owner_id)
        return row

    # ------------------------------------------------------------------
    # documents (§11.2, §11.3, §11.6)
    # ------------------------------------------------------------------
    async def register_upload(self, request: RegisterUploadRequest) -> UploadRegistration:
        """Validate + record the upload, then enqueue the async pipeline (§11.3/§65)."""
        await self._authorise(request.knowledge_base_id, AclPermission.EDIT)
        self._validate_upload(request)

        duplicate = await self._find_duplicate(request)
        if duplicate is not None:
            log.info(
                "document.duplicate_detected",
                kb=request.knowledge_base_id,
                existing=field(duplicate, "id"),
            )
            return UploadRegistration(
                document_id=str(field(duplicate, "id")),
                version=int(field(duplicate, "active_version", 1) or 1),
                state=str(field(duplicate, "state", "ready")),
                progress=int(field(duplicate, "progress", 100) or 100),
                duplicate_of=str(field(duplicate, "id")),
            )

        existing = await self._find_by_filename(request)
        version = int(field(existing, "active_version", 0) or 0) + 1 if existing else 1
        document_id = str(field(existing, "id")) if existing else new_id("doc")

        if existing is None:
            await self.repo.add(
                "KnowledgeDocument",
                {
                    **self.owned_fields(),
                    "id": document_id,
                    "knowledge_base_id": request.knowledge_base_id,
                    "filename": request.filename,
                    "source_kind": str(request.source_kind),
                    "size_bytes": request.size_bytes,
                    "state": "uploaded",
                    "progress": 5,
                    "active_version": version,
                    "content_sha256": request.content_sha256,
                    "storage_key": request.storage_key,
                    "created_at": iso_now(),
                    "updated_at": iso_now(),
                },
            )
        else:
            await self.repo.update(
                "KnowledgeDocument",
                document_id,
                {
                    "state": "uploaded",
                    "progress": 5,
                    "active_version": version,
                    "size_bytes": request.size_bytes,
                    "content_sha256": request.content_sha256,
                    "storage_key": request.storage_key,
                    "failure_reason": None,
                    "updated_at": iso_now(),
                },
            )
        await self.repo.add(
            "DocumentVersion",
            {
                "document_id": document_id,
                "version": version,
                "uploaded_by": self.user_id,
                "uploaded_at": iso_now(),
                "change_summary": request.change_summary,
                "embedding_version": await self._embedding_version(request.knowledge_base_id),
                "archived": False,
            },
        )
        await self.repo.commit()

        job_id = await self._enqueue_document_job(document_id, version, request)
        self.audit("document.register", f"document:{document_id}", version=version)
        return UploadRegistration(
            document_id=document_id, version=version, state="uploaded", progress=5, job_id=job_id
        )

    def _validate_upload(self, request: RegisterUploadRequest) -> None:
        if request.source_kind is SourceKind.MANUAL:
            if not request.manual_text.strip():
                raise ValidationFailedError("manual text is empty")
        elif request.source_kind is SourceKind.URL:
            if not request.url.startswith(("http://", "https://")):
                raise ValidationFailedError("url must start with http:// or https://")
        else:
            if request.size_bytes <= 0:
                raise ValidationFailedError("uploaded file is empty")
            if request.size_bytes > MAX_UPLOAD_BYTES:
                raise ValidationFailedError(
                    f"file exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)}MB limit"
                )
            expected = MIME_BY_KIND.get(request.source_kind)
            if expected and request.mime_type and request.mime_type not in expected:
                raise ValidationFailedError(
                    f"mime type {request.mime_type} does not match {request.source_kind}"
                )

    async def _find_duplicate(self, request: RegisterUploadRequest) -> Any | None:
        if not request.content_sha256:
            return None
        rows = await self.repo.list(
            "KnowledgeDocument",
            filters={
                "knowledge_base_id": request.knowledge_base_id,
                "content_sha256": request.content_sha256,
            },
        )
        return rows[0] if rows else None

    async def _find_by_filename(self, request: RegisterUploadRequest) -> Any | None:
        rows = await self.repo.list(
            "KnowledgeDocument",
            filters={
                "knowledge_base_id": request.knowledge_base_id,
                "filename": request.filename,
            },
        )
        return rows[0] if rows else None

    async def update_document_state(
        self,
        document_id: str,
        state: str,
        *,
        progress: int | None = None,
        failure_reason: str | None = None,
        chunk_count: int | None = None,
    ) -> Any:
        """Called by the worker as the pipeline advances (§29 progress visual)."""
        values: dict[str, Any] = {"state": state, "updated_at": iso_now()}
        if progress is not None:
            values["progress"] = progress
        if failure_reason is not None:
            values["failure_reason"] = failure_reason
        if chunk_count is not None:
            values["chunk_count"] = chunk_count
        row = await self.repo.update("KnowledgeDocument", document_id, values)
        await self.repo.commit()
        return row

    async def list_documents(self, kb_id: str, *, limit: int = 200) -> list[Any]:
        await self._authorise(kb_id, AclPermission.VIEW)
        return await self.repo.list(
            "KnowledgeDocument",
            filters={"knowledge_base_id": kb_id},
            order_by="-updated_at",
            limit=limit,
        )

    async def document_versions(self, document_id: str) -> list[Any]:
        document = await self._require_document(document_id, AclPermission.VIEW)
        return await self.repo.list(
            "DocumentVersion",
            filters={"document_id": str(field(document, "id"))},
            order_by="-version",
        )

    async def rollback_document(self, document_id: str, version: int) -> Any:
        """§11.6 rollback: re-activate an archived version and re-index it."""
        document = await self._require_document(document_id, AclPermission.EDIT)
        versions = await self.repo.list(
            "DocumentVersion", filters={"document_id": document_id, "version": version}
        )
        if not versions:
            raise NotFoundError(f"document {document_id} has no version {version}")
        await self.repo.update(
            "KnowledgeDocument",
            document_id,
            {"active_version": version, "state": "uploaded", "progress": 5},
        )
        await self.repo.commit()
        await self._enqueue_reindex(document_id, version, str(field(document, "knowledge_base_id")))
        self.audit("document.rollback", f"document:{document_id}", version=version)
        return await self.repo.get("KnowledgeDocument", document_id)

    async def delete_document(self, document_id: str) -> bool:
        document = await self._require_document(document_id, AclPermission.DELETE)
        await self._delete_vectors(document_id)
        chunks = await self.repo.list("Chunk", filters={"document_id": document_id})
        for chunk in chunks:
            await self.repo.delete("Chunk", str(field(chunk, "id")))
        deleted = await self.repo.delete("KnowledgeDocument", document_id)
        await self.repo.commit()
        self.audit(
            "document.delete",
            f"document:{document_id}",
            risk="medium",
            kb=str(field(document, "knowledge_base_id")),
        )
        return deleted

    # ------------------------------------------------------------------
    # chunk editor (§11.5)
    # ------------------------------------------------------------------
    async def list_chunks(
        self, document_id: str, *, limit: int = 200, offset: int = 0
    ) -> list[Any]:
        await self._require_document(document_id, AclPermission.VIEW)
        return await self.repo.list(
            "Chunk",
            filters={"document_id": document_id},
            order_by="index",
            limit=limit,
            offset=offset,
        )

    async def edit_chunk(self, chunk_id: str, edit: ChunkEdit) -> Any:
        chunk = await self._require_chunk(chunk_id, AclPermission.EDIT)
        values: dict[str, Any] = {}
        if edit.text is not None:
            if not edit.text.strip():
                raise ValidationFailedError("chunk text cannot be empty")
            values["text"] = edit.text
            values["token_count"] = estimate_tokens(edit.text)
        if edit.metadata is not None:
            values["metadata"] = {**(field(chunk, "metadata") or {}), **edit.metadata}
        if edit.tags is not None:
            values["tags"] = sorted(set(edit.tags))
        if edit.excluded_from_retrieval is not None:
            values["excluded_from_retrieval"] = edit.excluded_from_retrieval
        row = await self.repo.update("Chunk", chunk_id, values)
        await self.repo.commit()
        if "text" in values:
            await self._reembed([row])
        self.audit("chunk.edit", f"chunk:{chunk_id}")
        return row

    async def split_chunk_at(self, chunk_id: str, at_char: int) -> list[Any]:
        chunk = await self._require_chunk(chunk_id, AclPermission.EDIT)
        head, tail = split_chunk(self._to_text_chunk(chunk), at_char)
        updated = await self.repo.update(
            "Chunk", chunk_id, {"text": head.text, "token_count": head.token_count}
        )
        created = await self.repo.add(
            "Chunk",
            {
                **self.owned_fields(),
                "id": new_id("chk"),
                "document_id": field(chunk, "document_id"),
                "document_version": field(chunk, "document_version", 1),
                "index": int(field(chunk, "index", 0) or 0) + 1,
                "text": tail.text,
                "token_count": tail.token_count,
                "page": field(chunk, "page"),
                "section": field(chunk, "section"),
                "parent_chunk_id": field(chunk, "parent_chunk_id"),
                "metadata": field(chunk, "metadata") or {},
                "tags": field(chunk, "tags") or [],
                "excluded_from_retrieval": False,
            },
        )
        await self.repo.commit()
        await self._reembed([updated, created])
        self.audit("chunk.split", f"chunk:{chunk_id}")
        return [updated, created]

    async def merge_chunk_group(self, chunk_ids: Sequence[str]) -> Any:
        if len(chunk_ids) < 2:
            raise ValidationFailedError("merging needs at least two chunks")
        rows = [await self._require_chunk(cid, AclPermission.EDIT) for cid in chunk_ids]
        documents = {str(field(row, "document_id")) for row in rows}
        if len(documents) != 1:
            raise ValidationFailedError("chunks from different documents cannot be merged")
        merged = merge_chunks([self._to_text_chunk(row) for row in rows])
        survivor = rows[0]
        updated = await self.repo.update(
            "Chunk",
            str(field(survivor, "id")),
            {"text": merged.text, "token_count": merged.token_count, "tags": merged.tags},
        )
        for row in rows[1:]:
            await self._delete_chunk_vector(str(field(row, "chunk_id") or field(row, "id")))
            await self.repo.delete("Chunk", str(field(row, "id")))
        await self.repo.commit()
        await self._reembed([updated])
        self.audit("chunk.merge", f"chunk:{field(survivor, 'id')}", merged=len(rows))
        return updated

    async def delete_chunk(self, chunk_id: str) -> bool:
        chunk = await self._require_chunk(chunk_id, AclPermission.EDIT)
        await self._delete_chunk_vector(str(field(chunk, "chunk_id") or chunk_id))
        deleted = await self.repo.delete("Chunk", chunk_id)
        await self.repo.commit()
        self.audit("chunk.delete", f"chunk:{chunk_id}")
        return deleted

    async def set_chunk_excluded(self, chunk_id: str, excluded: bool) -> Any:
        """§11.5 exclude from retrieval / restore.

        The vector row is *not* deleted: `excluded_from_retrieval` is part of the
        mandatory filter (`tenant_filter`), so an excluded chunk becomes invisible to
        retrieval while remaining restorable and auditable.
        """
        chunk = await self._require_chunk(chunk_id, AclPermission.EDIT)
        row = await self.repo.update(
            "Chunk", chunk_id, {"excluded_from_retrieval": excluded}
        )
        await self.repo.commit()
        await self._reembed([row])
        self.audit(
            "chunk.exclude" if excluded else "chunk.restore",
            f"chunk:{chunk_id}",
            document=str(field(chunk, "document_id")),
        )
        return row

    async def reembed_document(self, document_id: str) -> int:
        document = await self._require_document(document_id, AclPermission.EDIT)
        chunks = await self.repo.list("Chunk", filters={"document_id": document_id})
        count = await self._reembed(chunks)
        self.audit("document.reembed", f"document:{document_id}", chunks=count)
        return count

    # ------------------------------------------------------------------
    # retrieval (§12.4)
    # ------------------------------------------------------------------
    async def playground(
        self,
        query: str,
        *,
        knowledge_base_ids: Sequence[str],
        top_k: int = 8,
        similarity_threshold: float = 0.35,
        metadata_filter: dict[str, Any] | None = None,
        rerank: bool = True,
    ) -> PlaygroundResult:
        """Retrieval playground. Every KB is ACL-checked before the query runs."""
        for kb_id in knowledge_base_ids:
            await self._authorise(kb_id, AclPermission.USE_FOR_RAG)
        pipeline = await self._pipeline(knowledge_base_ids)
        from app.rag.retriever import RetrievalConfig

        result: RagQueryResult = await pipeline.query(
            query,
            knowledge_base_ids=knowledge_base_ids,
            top_k=top_k,
            similarity_threshold=similarity_threshold,
            metadata_filter=metadata_filter,
            config=RetrievalConfig(top_k=top_k, rerank=rerank),
        )
        self.audit("retrieval.playground", "retrieval", kbs=list(knowledge_base_ids))
        return PlaygroundResult(
            query=result.query,
            verdict=str(result.verdict),
            max_similarity=result.max_similarity,
            citations=[c.as_dict() for c in result.citations],
            context=result.context,
            trace=result.trace,
            latency_ms=result.latency_ms,
        )

    async def retrieval_pipeline(self, knowledge_base_ids: Sequence[str]) -> RagPipeline:
        """Hand a scoped pipeline to the orchestrator's knowledge agent."""
        for kb_id in knowledge_base_ids:
            await self._authorise(kb_id, AclPermission.USE_FOR_RAG)
        return await self._pipeline(knowledge_base_ids)

    # ------------------------------------------------------------------
    # ACL (§39)
    # ------------------------------------------------------------------
    def _acl_allows(self, kb: Any, permission: AclPermission) -> bool:
        if self.has_role(ROLE_ADMIN):
            return True
        acl = field(kb, "acl") or {}
        permissions = {str(p) for p in (acl.get("permissions") or [])}
        if str(permission) not in permissions and permission is not AclPermission.VIEW:
            # coaches keep authoring rights on knowledge they own
            if not (
                permission in (AclPermission.EDIT, AclPermission.REVIEW)
                and self.has_role(*AUTHORING_ROLES)
                and str(field(kb, "owner_id", "")) == self.user_id
            ):
                return False
        scope = str(acl.get("scope") or "workspace")
        subjects = {str(s) for s in (acl.get("subject_ids") or [])}
        if scope == "organization":
            return True
        if scope == "workspace":
            return not subjects or self.workspace_id in subjects
        # department / team / role / user scopes all match against the caller's subjects
        return bool(subjects & set(self.acl_subjects()))

    async def _authorise(self, kb_id: str, permission: AclPermission) -> Any:
        kb = await self.repo.get("KnowledgeBase", kb_id)
        if kb is None:
            # Deliberately a 404, not a 403: existence of another tenant's KB must not
            # be observable (§39/§74).
            raise NotFoundError(f"knowledge base {kb_id} not found")
        self.assert_same_tenant(kb, resource="knowledge base")
        if not self._acl_allows(kb, permission):
            self.audit(
                "kb.access_denied",
                f"kb:{kb_id}",
                result="denied",
                risk="medium",
                permission=str(permission),
            )
            raise PermissionDeniedError(
                f"knowledge ACL denies '{permission}' on knowledge base {kb_id}"
            )
        return kb

    async def _require_document(self, document_id: str, permission: AclPermission) -> Any:
        document = await self.repo.get("KnowledgeDocument", document_id)
        if document is None:
            raise NotFoundError(f"document {document_id} not found")
        self.assert_same_tenant(document, resource="document")
        await self._authorise(str(field(document, "knowledge_base_id")), permission)
        return document

    async def _require_chunk(self, chunk_id: str, permission: AclPermission) -> Any:
        chunk = await self.repo.get("Chunk", chunk_id)
        if chunk is None:
            raise NotFoundError(f"chunk {chunk_id} not found")
        await self._require_document(str(field(chunk, "document_id")), permission)
        return chunk

    # ------------------------------------------------------------------
    # plumbing
    # ------------------------------------------------------------------
    async def _pipeline(self, knowledge_base_ids: Sequence[str]) -> RagPipeline:
        if self._rag is not None:
            return self._rag
        from app.services.factory import build_rag_pipeline

        return build_rag_pipeline(
            ctx=self.ctx,
            knowledge_base_ids=knowledge_base_ids,
            acl_subject_ids=self.acl_subjects(),
        )

    async def _reembed(self, chunks: Sequence[Any]) -> int:
        """Re-embed edited chunks (§11.5 Re-embed)."""
        usable = [
            chunk
            for chunk in chunks
            if chunk is not None and str(field(chunk, "text", "")).strip()
        ]
        if not usable:
            return 0
        document_id = str(field(usable[0], "document_id"))
        document = await self.repo.get("KnowledgeDocument", document_id)
        kb_id = str(field(document, "knowledge_base_id")) if document else ""
        pipeline = await self._pipeline([kb_id] if kb_id else [])
        text_chunks = [self._to_text_chunk(chunk) for chunk in usable]
        return await pipeline.reembed_chunks(
            text_chunks,
            document_id=document_id,
            knowledge_base_id=kb_id,
            document_version=int(field(usable[0], "document_version", 1) or 1),
            acl_subject_ids=self.acl_subjects(),
        )

    async def _delete_vectors(self, document_id: str) -> None:
        try:
            pipeline = await self._pipeline([])
            await pipeline.delete_document(document_id)
        except Exception as exc:  # noqa: BLE001 - row deletion must still proceed
            log.warning("kb.vector_delete_failed", document_id=document_id, error=repr(exc))

    async def _delete_chunk_vector(self, chunk_id: str) -> None:
        try:
            pipeline = await self._pipeline([])
            await pipeline.store.delete_chunks(
                [chunk_id], scope=pipeline.scope, spec=pipeline.spec
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("kb.chunk_vector_delete_failed", chunk_id=chunk_id, error=repr(exc))

    async def _enqueue_document_job(
        self, document_id: str, version: int, request: RegisterUploadRequest
    ) -> str | None:
        payload = {
            "tenant_id": self.tenant_id,
            "workspace_id": self.workspace_id,
            "user_id": self.user_id,
            "document_id": document_id,
            "document_version": version,
            "knowledge_base_id": request.knowledge_base_id,
            "filename": request.filename,
            "source_kind": str(request.source_kind),
            "storage_key": request.storage_key,
            "url": request.url,
            "manual_text": request.manual_text,
            "chunk_config": request.chunk_config.model_dump(),
            "acl_subject_ids": list(self.acl_subjects()),
        }
        queue = self._queue
        if queue is None:
            from app.workers.queue import get_queue

            queue = get_queue()
        return await queue.enqueue("document.process", payload)

    async def _enqueue_reindex(self, document_id: str, version: int, kb_id: str) -> str | None:
        queue = self._queue
        if queue is None:
            from app.workers.queue import get_queue

            queue = get_queue()
        return await queue.enqueue(
            "document.reindex",
            {
                "tenant_id": self.tenant_id,
                "workspace_id": self.workspace_id,
                "document_id": document_id,
                "document_version": version,
                "knowledge_base_id": kb_id,
            },
        )

    async def _embedding_version(self, kb_id: str) -> str:
        kb = await self.repo.get("KnowledgeBase", kb_id)
        return str(field(kb, "embedding_model", "") or self._default_embedding_model())

    def _default_embedding_model(self) -> str:
        try:
            from app.services.factory import build_embedder

            return build_embedder().spec.model_id
        except Exception:  # noqa: BLE001 - settings may not be loaded in tests
            return "BAAI/bge-m3"

    @staticmethod
    def _to_text_chunk(row: Any) -> TextChunk:
        text = str(field(row, "text", "") or "")
        return TextChunk(
            index=int(field(row, "index", 0) or 0),
            text=text,
            token_count=int(field(row, "token_count", 0) or estimate_tokens(text)),
            page=field(row, "page"),
            section=field(row, "section"),
            metadata=dict(field(row, "metadata") or {}),
            tags=list(field(row, "tags") or []),
        )

    @staticmethod
    def content_hash(content: bytes) -> str:
        return hashlib.sha256(content).hexdigest()


__all__ = [
    "KB_TRANSITIONS",
    "AclPermission",
    "ChunkEdit",
    "CreateKnowledgeBaseRequest",
    "KnowledgeService",
    "PlaygroundResult",
    "RegisterUploadRequest",
    "UploadRegistration",
]
