"""Knowledge Base / Document / DocumentVersion / Chunk / EmbeddingIndex (§11 / §12 / §53).

Vector storage boundary
-----------------------
**Chunk *vectors* are never stored in Postgres.** This table holds only chunk text and
metadata; the embedding lives in Qdrant, in a collection named by
``embedding_index.collection_name``, with the payload carrying ``tenant_id`` +
``workspace_id`` + ``knowledge_base_id`` exactly as §74 requires. That payload filter is
what makes cross-tenant retrieval impossible on the vector side, mirroring the SQL guard
in :mod:`app.core.tenancy`.

Document bytes are likewise not in Postgres: they live in S3/MinIO under
``storage_key`` and are uploaded directly by the browser through a signed URL (§40.2).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin
from app.db.models.mixins import (
    ContentStatusMixin,
    SoftDeleteMixin,
    TenantScopedMixin,
    enum_column,
    scope_index,
)
from app.domain.enums import ChunkStrategy, DocumentSourceKind, DocumentState


class KnowledgeBase(
    IdMixin, TimestampMixin, TenantScopedMixin, ContentStatusMixin, SoftDeleteMixin, Base
):
    """§11 knowledge base. ``acl`` stores the §39 ``KnowledgeAcl`` object verbatim."""

    __tablename__ = "knowledge_base"
    __table_args__ = (scope_index("knowledge_base", "name"),)

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, default=None)
    document_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    embedding_model: Mapped[str] = mapped_column(String(120), nullable=False)
    acl: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, comment="§39 KnowledgeAcl"
    )

    documents: Mapped[list[Document]] = relationship(
        back_populates="knowledge_base", cascade="all, delete-orphan", lazy="raise"
    )


class Document(IdMixin, TimestampMixin, TenantScopedMixin, SoftDeleteMixin, Base):
    """§11 document record; bytes stay in object storage under ``storage_key``."""

    __tablename__ = "document"
    __table_args__ = (
        scope_index("document", "knowledge_base_id", "state"),
        Index("ix_document_kb_created", "knowledge_base_id", "created_at"),
    )

    knowledge_base_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("knowledge_base.id", ondelete="CASCADE"), nullable=False
    )
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    source_kind: Mapped[DocumentSourceKind] = mapped_column(
        enum_column(DocumentSourceKind, name="document_source_kind"), nullable=False
    )
    source_url: Mapped[str | None] = mapped_column(Text, default=None)
    storage_key: Mapped[str | None] = mapped_column(
        String(500), default=None, comment="S3/MinIO object key (§40.2 signed upload URL)"
    )
    content_type: Mapped[str | None] = mapped_column(String(160), default=None)
    checksum_sha256: Mapped[str | None] = mapped_column(String(64), default=None, index=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    state: Mapped[DocumentState] = mapped_column(
        enum_column(DocumentState, name="document_state"),
        nullable=False,
        default=DocumentState.UPLOADED,
        index=True,
    )
    progress: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    active_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    failure_reason: Mapped[str | None] = mapped_column(Text, default=None)
    uploaded_by: Mapped[str | None] = mapped_column(String(32), default=None)

    knowledge_base: Mapped[KnowledgeBase] = relationship(
        back_populates="documents", lazy="raise"
    )
    versions: Mapped[list[DocumentVersion]] = relationship(
        back_populates="document", cascade="all, delete-orphan", lazy="raise"
    )


class DocumentVersion(IdMixin, TimestampMixin, TenantScopedMixin, Base):
    """§11.5 immutable version row; keeps a report reproducible after a re-upload."""

    __tablename__ = "document_version"
    __table_args__ = (
        UniqueConstraint("document_id", "version", name="uq_document_version_document_version"),
        scope_index("document_version", "document_id"),
    )

    document_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("document.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    uploaded_by: Mapped[str] = mapped_column(String(32), nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(nullable=False)
    change_summary: Mapped[str | None] = mapped_column(Text, default=None)
    embedding_version: Mapped[str] = mapped_column(String(120), nullable=False)
    storage_key: Mapped[str | None] = mapped_column(String(500), default=None)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    document: Mapped[Document] = relationship(back_populates="versions", lazy="raise")


class Chunk(IdMixin, TimestampMixin, TenantScopedMixin, Base):
    """§30 chunk. Text + metadata only — the vector lives in Qdrant (see module docstring).

    The ORM attribute is ``chunk_metadata`` because ``metadata`` is reserved by
    SQLAlchemy's declarative API; the *column* and the wire field are both ``metadata``,
    matching ``Chunk.metadata`` in ``entities.ts``.
    """

    __tablename__ = "chunk"
    __table_args__ = (
        UniqueConstraint(
            "document_id",
            "document_version",
            "index",
            name="uq_chunk_document_version_index",
        ),
        scope_index("chunk", "document_id", "document_version"),
        Index("ix_chunk_retrievable", "tenant_id", "workspace_id", "excluded_from_retrieval"),
    )

    document_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("document.id", ondelete="CASCADE"), nullable=False
    )
    knowledge_base_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("knowledge_base.id", ondelete="CASCADE"), nullable=False
    )
    document_version: Mapped[int] = mapped_column(Integer, nullable=False)
    index: Mapped[int] = mapped_column("index", Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    page: Mapped[int | None] = mapped_column(Integer, default=None)
    section: Mapped[str | None] = mapped_column(String(500), default=None)
    parent_chunk_id: Mapped[str | None] = mapped_column(String(32), default=None)
    chunk_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, default=dict
    )
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    excluded_from_retrieval: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    #: Qdrant point id for this chunk; NULL until the indexing step completes.
    vector_point_id: Mapped[str | None] = mapped_column(String(64), default=None)

    document: Mapped[Document] = relationship(lazy="raise")


class EmbeddingIndex(IdMixin, TimestampMixin, TenantScopedMixin, Base):
    """§65 descriptor of the Qdrant collection backing one knowledge base."""

    __tablename__ = "embedding_index"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "workspace_id", "knowledge_base_id", "embedding_version",
            name="uq_embedding_index_scope_kb_version",
        ),
    )

    knowledge_base_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("knowledge_base.id", ondelete="CASCADE"), nullable=False
    )
    collection_name: Mapped[str] = mapped_column(String(200), nullable=False)
    embedding_model: Mapped[str] = mapped_column(String(120), nullable=False)
    embedding_version: Mapped[str] = mapped_column(String(120), nullable=False)
    dimension: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_strategy: Mapped[ChunkStrategy] = mapped_column(
        enum_column(ChunkStrategy, name="chunk_strategy"),
        nullable=False,
        default=ChunkStrategy.AUTO,
    )
    vector_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_indexed_at: Mapped[datetime | None] = mapped_column(default=None)
