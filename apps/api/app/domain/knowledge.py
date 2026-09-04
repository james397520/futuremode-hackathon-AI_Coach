"""Knowledge Base / Document / Chunk / Citation models (spec §11 / §12 / §39).

Mirrors the "Knowledge" section of ``packages/shared/src/entities.ts``.

Note the Python class name ``KnowledgeDocument`` matches the TypeScript interface
``KnowledgeDocument`` (the wire shape is what matters; ``Document`` alone would collide
with the SQLAlchemy model name).
"""

from __future__ import annotations

from pydantic import Field

from app.domain.common import ID, Confidence, DomainModel, ISODateTime, TenantScoped
from app.domain.enums import (
    ChunkStrategy,
    ContentStatus,
    DocumentSourceKind,
    DocumentState,
    KnowledgeAclScope,
    KnowledgePermission,
)


class KnowledgeAcl(DomainModel):
    """§39 Knowledge Access Control entry.

    Cross-tenant / cross-department retrieval is prevented structurally by
    ``app.core.tenancy`` — this ACL narrows access *within* an already-scoped tenant.
    """

    scope: KnowledgeAclScope
    subject_ids: list[ID] = Field(default_factory=list)
    permissions: list[KnowledgePermission] = Field(default_factory=list)


class KnowledgeBase(TenantScoped):
    """§11 Knowledge Base entity."""

    name: str
    description: str | None = None
    status: ContentStatus
    document_count: int = Field(ge=0)
    chunk_count: int = Field(ge=0)
    embedding_model: str
    acl: KnowledgeAcl


class KnowledgeDocument(TenantScoped):
    """§11 document record. Bytes live in object storage, never in Postgres (§40.2)."""

    knowledge_base_id: ID
    filename: str
    source_kind: DocumentSourceKind
    size_bytes: int = Field(ge=0)
    state: DocumentState
    progress: int = Field(ge=0, le=100, description="0–100 processing progress (§29)")
    active_version: int = Field(ge=1)
    failure_reason: str | None = None


class DocumentVersion(DomainModel):
    """§11.5 immutable document version record."""

    document_id: ID
    version: int = Field(ge=1)
    uploaded_by: ID
    uploaded_at: ISODateTime
    change_summary: str | None = None
    embedding_version: str
    archived: bool = False


class Chunk(DomainModel):
    """§30 Chunk Viewer entity.

    ``metadata`` is stored as JSONB in Postgres; the *vector* for this chunk lives only
    in Qdrant, keyed by ``tenant_id`` + ``workspace_id`` + ``knowledge_base_id`` (§74).
    """

    id: ID
    document_id: ID
    document_version: int = Field(ge=1)
    index: int = Field(ge=0)
    text: str
    token_count: int = Field(ge=0)
    page: int | None = Field(default=None, ge=0)
    section: str | None = None
    parent_chunk_id: ID | None = None
    metadata: dict[str, str | int | float | bool] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)
    excluded_from_retrieval: bool = False


class Citation(DomainModel):
    """§12.5 Citation — every knowledge claim must be traceable."""

    chunk_id: ID
    document_id: ID
    document_name: str
    document_version: int = Field(ge=1)
    page: int | None = Field(default=None, ge=0)
    section: str | None = None
    similarity: Confidence
    rerank_score: float | None = None
    snippet: str


class EmbeddingIndex(TenantScoped):
    """§65 vector-index descriptor: the Qdrant collection backing a knowledge base."""

    knowledge_base_id: ID
    collection_name: str
    embedding_model: str
    embedding_version: str
    dimension: int = Field(ge=1)
    chunk_strategy: ChunkStrategy
    vector_count: int = Field(default=0, ge=0)
    last_indexed_at: ISODateTime | None = None
