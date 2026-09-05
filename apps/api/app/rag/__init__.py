"""Advanced RAG (spec §11.3, §12, §65).

    Document -> Parser -> OCR? -> Structure -> Chunking -> Metadata -> Embedding
             -> Qdrant -> Retrieve -> Rerank -> Context -> LLM -> Citation

`RagPipeline` is the entry point for both halves (ingest and query). See
`app/rag/README.md` for the embedding-provider split (§2.1) and the tenant-isolation
guarantee (§39/§74).
"""

from app.rag.pipeline import (
    DocumentState,
    IngestRequest,
    IngestResult,
    KnowledgeBoundary,
    RagPipeline,
    RagQueryResult,
)
from app.rag.vectorstore import TenantIsolationError, TenantScope

__all__ = [
    "DocumentState",
    "IngestRequest",
    "IngestResult",
    "KnowledgeBoundary",
    "RagPipeline",
    "RagQueryResult",
    "TenantIsolationError",
    "TenantScope",
]
