"""`RagPipeline` — ingest and query (spec §11.3, §12, §65).

Ingest (emits `DocumentState` transitions so §29 "Document Processing Visual" can
animate them, and so a failure lands in `failed` with a readable reason):

    uploaded -> validating -> parsing -> chunking -> embedding -> indexing -> ready
                                                                          \\-> failed

Query (spec §65):

    query -> retrieve -> rerank -> context assembly -> citations -> boundary verdict

The pipeline holds a `TenantScope`, which is built once from `RequestContext`. That is
what lets it satisfy `KnowledgeAgent`'s retrieval port with a signature that has no
tenant argument at all: there is no way for a caller to pass a *different* tenant.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable, Sequence
from enum import StrEnum
from typing import Any

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.rag.chunker import ChunkConfig, Chunker, TextChunk
from app.rag.citation import Citation, build_citations, coverage, dedupe_citations
from app.rag.embedder import EmbedderPort, EmbeddingSpec
from app.rag.parser import DocumentParser, DocumentPayload, ParsedDocument, ParserError
from app.rag.quality import QualityReport, apply_report, check_chunks
from app.rag.reranker import Reranker
from app.rag.retriever import RetrievalConfig, RetrievalResult, Retriever
from app.rag.vectorstore import TenantScope, VectorRecord, VectorStore

log = structlog.get_logger(__name__)

#: Mirrors `DOCUMENT_STATES` in packages/shared-types/src/state-machines.ts
class DocumentState(StrEnum):
    UPLOADED = "uploaded"
    VALIDATING = "validating"
    PARSING = "parsing"
    CHUNKING = "chunking"
    EMBEDDING = "embedding"
    INDEXING = "indexing"
    READY = "ready"
    FAILED = "failed"


#: progress % reported alongside each state (`KnowledgeDocument.progress`, §29)
STATE_PROGRESS: dict[DocumentState, int] = {
    DocumentState.UPLOADED: 5,
    DocumentState.VALIDATING: 10,
    DocumentState.PARSING: 30,
    DocumentState.CHUNKING: 50,
    DocumentState.EMBEDDING: 75,
    DocumentState.INDEXING: 90,
    DocumentState.READY: 100,
    DocumentState.FAILED: 100,
}

StateCallback = Callable[[DocumentState, int, str | None], Awaitable[None] | None]


class KnowledgeBoundary(StrEnum):
    """§12.6 verdict attached to every query result."""

    SUFFICIENT = "sufficient"
    PARTIAL = "partial"
    INSUFFICIENT = "insufficient"


class IngestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str
    knowledge_base_id: str
    document_version: int = 1
    document_name: str = ""
    payload: DocumentPayload
    chunk_config: ChunkConfig = Field(default_factory=ChunkConfig)
    #: ACL subjects allowed to retrieve this document's chunks (§39)
    acl_subject_ids: list[str] = Field(default_factory=list)
    #: fingerprints already indexed in this KB, for duplicate detection (§11.2)
    known_fingerprints: list[str] = Field(default_factory=list)
    index_parents: bool = True


class IngestResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_id: str
    state: DocumentState
    chunk_count: int = 0
    indexed_count: int = 0
    rejected_count: int = 0
    page_count: int = 0
    ocr_applied: bool = False
    embedding_model: str = ""
    quality_score: float = 0.0
    quality_summary: dict[str, int] = Field(default_factory=dict)
    outline: list[dict[str, Any]] = Field(default_factory=list)
    failure_reason: str | None = None
    duration_ms: int = 0
    chunks: list[TextChunk] = Field(default_factory=list)


class RagQueryResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str
    citations: list[Citation] = Field(default_factory=list)
    #: assembled context for the LLM, in citation order
    context: str = ""
    verdict: KnowledgeBoundary = KnowledgeBoundary.INSUFFICIENT
    max_similarity: float = 0.0
    latency_ms: int = 0
    trace: dict[str, Any] = Field(default_factory=dict)


#: Boundary thresholds. Deliberately conservative: it is much cheaper to ask a
#: clarifying question than to state a policy the KB does not support (§12.6).
SUFFICIENT_SCORE = 0.55
PARTIAL_SCORE = 0.35
CONTEXT_TOKEN_BUDGET = 2400


class RagPipeline:
    """Ingest + query for one tenant/workspace scope."""

    def __init__(
        self,
        *,
        store: VectorStore,
        embedder: EmbedderPort,
        scope: TenantScope,
        parser: DocumentParser | None = None,
        reranker: Reranker | None = None,
        retriever: Retriever | None = None,
        config: RetrievalConfig | None = None,
        document_names: dict[str, str] | None = None,
    ) -> None:
        self.store = store
        self.embedder = embedder
        self.scope = scope
        self.parser = parser or DocumentParser()
        self.config = config or RetrievalConfig()
        self.retriever = retriever or Retriever(
            store=store, embedder=embedder, reranker=reranker, config=self.config
        )
        self.document_names = dict(document_names or {})

    @property
    def spec(self) -> EmbeddingSpec:
        return self.embedder.spec

    # ------------------------------------------------------------------
    # ingest
    # ------------------------------------------------------------------
    async def ingest(
        self, request: IngestRequest, *, on_state: StateCallback | None = None
    ) -> IngestResult:
        started = time.perf_counter()
        result = IngestResult(
            document_id=request.document_id,
            state=DocumentState.UPLOADED,
            embedding_model=self.spec.model_id,
        )

        async def transition(state: DocumentState, reason: str | None = None) -> None:
            result.state = state
            if on_state is not None:
                outcome = on_state(state, STATE_PROGRESS[state], reason)
                if outcome is not None and hasattr(outcome, "__await__"):
                    await outcome

        try:
            await transition(DocumentState.UPLOADED)
            await transition(DocumentState.VALIDATING)

            await transition(DocumentState.PARSING)
            parsed: ParsedDocument = await self.parser.parse(request.payload)
            result.page_count = parsed.page_count
            result.ocr_applied = parsed.ocr_applied
            result.outline = parsed.outline

            await transition(DocumentState.CHUNKING)
            document_metadata = {
                "document_id": request.document_id,
                "document_name": request.document_name or request.payload.filename,
                "document_version": request.document_version,
                "knowledge_base_id": request.knowledge_base_id,
                "source_kind": str(request.payload.source_kind),
                "parser": parsed.parser,
            }
            chunks = Chunker(request.chunk_config).chunk(
                parsed.blocks,
                document_metadata=document_metadata,
                config=request.chunk_config,
            )
            report: QualityReport = check_chunks(
                chunks,
                min_tokens=max(request.chunk_config.min_length // 2, 8),
                max_tokens=request.chunk_config.max_length,
                known_fingerprints=request.known_fingerprints,
            )
            keep, rejected = apply_report(chunks, report)
            result.chunk_count = len(keep)
            result.rejected_count = len(rejected)
            result.quality_score = report.score
            result.quality_summary = report.summary()
            result.chunks = keep
            if not keep:
                raise ParserError(
                    "every chunk failed the quality check "
                    f"({', '.join(f'{k}={v}' for k, v in report.summary().items())})"
                )

            await transition(DocumentState.EMBEDDING)
            indexable = [c for c in keep if request.index_parents or not c.is_parent]
            vectors = await self.embedder.embed_documents([c.text for c in indexable])
            if len(vectors) != len(indexable):
                raise ParserError(
                    f"embedder returned {len(vectors)} vectors for {len(indexable)} chunks"
                )

            await transition(DocumentState.INDEXING)
            records = [
                self._to_record(chunk, vector, request, keep)
                for chunk, vector in zip(indexable, vectors, strict=True)
            ]
            result.indexed_count = await self.store.upsert(records, spec=self.spec)

            await transition(DocumentState.READY)
        except Exception as exc:  # noqa: BLE001 - the state machine owns the outcome
            reason = str(exc) if isinstance(exc, ParserError) else f"{type(exc).__name__}: {exc}"
            result.failure_reason = reason[:500]
            await transition(DocumentState.FAILED, result.failure_reason)
            log.warning(
                "rag.ingest_failed",
                document_id=request.document_id,
                error=result.failure_reason,
            )
        result.duration_ms = int((time.perf_counter() - started) * 1000)
        return result

    def _to_record(
        self,
        chunk: TextChunk,
        vector: Sequence[float],
        request: IngestRequest,
        all_chunks: Sequence[TextChunk],
    ) -> VectorRecord:
        chunk_id = self.chunk_id(request.document_id, request.document_version, chunk.index)
        parent_chunk_id: str | None = None
        if chunk.parent_index is not None and 0 <= chunk.parent_index < len(all_chunks):
            parent_chunk_id = self.chunk_id(
                request.document_id,
                request.document_version,
                all_chunks[chunk.parent_index].index,
            )
        return VectorRecord(
            id=uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"{self.scope.tenant_id}/{request.document_id}/{request.document_version}/"
                f"{chunk.index}",
            ).hex,
            vector=list(vector),
            tenant_id=self.scope.tenant_id,
            workspace_id=self.scope.workspace_id,
            knowledge_base_id=request.knowledge_base_id,
            document_id=request.document_id,
            document_version=request.document_version,
            chunk_id=chunk_id,
            chunk_index=chunk.index,
            text=chunk.text,
            page=chunk.page,
            section=chunk.section,
            parent_chunk_id=parent_chunk_id,
            is_parent=chunk.is_parent,
            tags=list(chunk.tags),
            excluded_from_retrieval=False,
            acl_subject_ids=list(request.acl_subject_ids),
            metadata={
                **chunk.metadata,
                "document_name": request.document_name or request.payload.filename,
                "strategy": str(chunk.strategy),
                "token_count": chunk.token_count,
            },
        )

    @staticmethod
    def chunk_id(document_id: str, version: int, index: int) -> str:
        return f"{document_id}:v{version}:{index}"

    async def delete_document(self, document_id: str) -> int:
        return await self.store.delete_document(
            document_id, scope=self.scope, spec=self.spec
        )

    async def reembed_chunks(
        self,
        chunks: Sequence[TextChunk],
        *,
        document_id: str,
        knowledge_base_id: str,
        document_version: int = 1,
        acl_subject_ids: Sequence[str] = (),
    ) -> int:
        """§11.5 Chunk Editor — re-embed after an edit/split/merge."""
        if not chunks:
            return 0
        vectors = await self.embedder.embed_documents([c.text for c in chunks])
        request = IngestRequest(
            document_id=document_id,
            knowledge_base_id=knowledge_base_id,
            document_version=document_version,
            payload=DocumentPayload(filename=document_id),
            acl_subject_ids=list(acl_subject_ids),
        )
        records = [
            self._to_record(chunk, vector, request, chunks)
            for chunk, vector in zip(chunks, vectors, strict=True)
        ]
        return await self.store.upsert(records, spec=self.spec)

    # ------------------------------------------------------------------
    # query
    # ------------------------------------------------------------------
    async def query(
        self,
        query: str,
        *,
        knowledge_base_ids: Sequence[str] = (),
        top_k: int = 8,
        similarity_threshold: float = PARTIAL_SCORE,
        metadata_filter: dict[str, Any] | None = None,
        context_turns: Sequence[tuple[str, str]] = (),
        client_rerank_order: Sequence[str] | None = None,
        config: RetrievalConfig | None = None,
    ) -> RagQueryResult:
        """Retrieve -> rerank -> assemble context -> citations -> boundary verdict."""
        started = time.perf_counter()
        scope = self.scope.narrowed_to(knowledge_base_ids) if knowledge_base_ids else self.scope
        if metadata_filter:
            scope = TenantScope(
                tenant_id=scope.tenant_id,
                workspace_id=scope.workspace_id,
                knowledge_base_ids=scope.knowledge_base_ids,
                acl_subject_ids=scope.acl_subject_ids,
                metadata_filter={**dict(scope.metadata_filter), **metadata_filter},
            )
        effective = (config or self.config).model_copy(
            update={"top_k": top_k, "similarity_threshold": similarity_threshold}
        )
        retrieval: RetrievalResult = await self.retriever.retrieve(
            query,
            scope=scope,
            config=effective,
            context=context_turns,
            client_rerank_order=client_rerank_order,
        )

        citations = dedupe_citations(
            build_citations(
                [chunk.hit for chunk in retrieval.chunks],
                document_names=self.document_names,
                rerank_scores={
                    chunk.id: chunk.rerank_score
                    for chunk in retrieval.chunks
                    if chunk.rerank_score is not None
                },
                query=query,
            )
        )
        verdict, max_similarity = self.boundary_verdict(citations, threshold=similarity_threshold)
        return RagQueryResult(
            query=query,
            citations=citations,
            context=assemble_context(citations),
            verdict=verdict,
            max_similarity=max_similarity,
            latency_ms=int((time.perf_counter() - started) * 1000),
            trace={
                **retrieval.trace,
                "rewritten_queries": retrieval.rewritten_queries,
                "reranker": retrieval.reranker,
                "coverage": coverage(citations),
                "retrieval_latency_ms": retrieval.latency_ms,
            },
        )

    @staticmethod
    def boundary_verdict(
        citations: Sequence[Citation], *, threshold: float = PARTIAL_SCORE
    ) -> tuple[KnowledgeBoundary, float]:
        """§12.6 — how much the KB actually supports an answer.

        Uses the rerank score when present (it is the authoritative relevance signal,
        §54) and the cosine similarity otherwise.
        """
        if not citations:
            return KnowledgeBoundary.INSUFFICIENT, 0.0
        scores = [
            c.rerank_score if c.rerank_score is not None else c.similarity for c in citations
        ]
        best = max(scores)
        supporting = sum(1 for score in scores if score >= threshold)
        if best >= SUFFICIENT_SCORE and supporting >= 2:
            return KnowledgeBoundary.SUFFICIENT, best
        if best >= threshold:
            return KnowledgeBoundary.PARTIAL, best
        return KnowledgeBoundary.INSUFFICIENT, best


def assemble_context(
    citations: Sequence[Citation], *, token_budget: int = CONTEXT_TOKEN_BUDGET
) -> str:
    """Numbered context block. The indexes match the citation list the agent sees."""
    from app.rag.chunker import estimate_tokens

    lines: list[str] = []
    used = 0
    for index, citation in enumerate(citations):
        header = f"[{index}] {citation.document_name}"
        if citation.page is not None:
            header += f" p.{citation.page}"
        if citation.section:
            header += f" · {citation.section}"
        body = f"{header}\n{citation.snippet}"
        cost = estimate_tokens(body)
        if used + cost > token_budget and lines:
            break
        lines.append(body)
        used += cost
    return "\n\n".join(lines)


__all__ = [
    "CONTEXT_TOKEN_BUDGET",
    "PARTIAL_SCORE",
    "STATE_PROGRESS",
    "SUFFICIENT_SCORE",
    "DocumentState",
    "IngestRequest",
    "IngestResult",
    "KnowledgeBoundary",
    "RagPipeline",
    "RagQueryResult",
    "StateCallback",
    "assemble_context",
]
