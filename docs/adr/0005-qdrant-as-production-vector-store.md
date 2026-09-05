# ADR-0005 — Qdrant is the production vector store; Chroma and FAISS are POC-only

- **Status:** accepted
- **Date:** initial architecture pass
- **Spec:** Part I §12.2 (vector database), §12.3 (retrieval controls), §10 (tenant model), Part II §64 (stack), §65 (RAG pipeline), §74 (data isolation), §5.1 (vector DB horizontal scaling), §72 (AMD AUP)

## Context

Part I §12.2 ranks the options rather than leaving them open:

```text
Qdrant   — recommended primary choice for production B2B
ChromaDB — POC / smaller deployment
FAISS    — local / embedded experiment
```

Part II §74 then imposes a requirement that turns out to be the real
discriminator. Every point must carry:

```text
tenant_id
workspace_id
knowledge_base_id
```

That is not metadata for display. It is the isolation boundary: a search must be
*filtered* by those keys, at the vector store, before results are returned. A
vector store that cannot filter efficiently at query time forces one of two bad
designs — a separate index per tenant (which does not scale to thousands of
workspaces and makes cross-workspace admin queries impossible), or
post-filtering after retrieval (which silently degrades recall, because top-K is
computed before the filter and a tenant with few documents can get an empty
result set from a full index).

Part I §5.1 additionally requires a vector-DB horizontal scaling strategy, and
Part I §12.3 requires a substantial retrieval-control surface: top-K, similarity
threshold, metadata filter, hybrid search, keyword search, reranker, query
rewrite, multi-query retrieval, and parent-document expansion.

Part II §72 adds a deployment constraint: the vector database is one of the
services intended to run inside AMD AUP / a private compute environment. A
managed-only service is therefore not viable as the primary choice.

## Decision

**Qdrant is the production vector store.** Chroma and FAISS may be used for
local experiments and are explicitly not a deployment target.

Every collection uses payload-based multi-tenancy with **payload indexes on
`tenant_id`, `workspace_id` and `knowledge_base_id`**, and every search passes a
payload filter on all three. This is what makes filtered search a pre-filter
rather than a post-filter, so recall is unaffected by tenant size.

Additional payload carried per point, from Part II §65's metadata step:
`document_id`, `document_version`, `chunk_id`, `page`, `section`, `tags`.
`document_version` is what allows a re-parsed document's old vectors to be
retired without touching another version's.

Concrete reasons for Qdrant over the alternatives:

- **Filtered vector search is a first-class feature**, with indexed payload
  keys, and it is designed for exactly the multi-tenant shape §74 describes.
- **Hybrid search is native.** Part I §12.3 requires dense + keyword. Qdrant
  supports sparse vectors alongside dense in one collection, so hybrid retrieval
  does not need a second system with its own consistency problem.
- **Self-hostable and available as a managed service.** Local development may
  use the in-memory store; production uses a native or managed Qdrant endpoint.
- **Horizontal scaling exists** — sharding and replication, satisfying §5.1
  without a rewrite.
- **Snapshots and a real persistence story**, which matters when re-embedding a
  large knowledge base has a genuine dollar cost on the external-API embedding
  path.
- **API-key auth**, so the store is not open on the network in any shared
  environment. `QDRANT_API_KEY` is wired through configuration.

Why the alternatives are POC-only:

- **ChromaDB** — good ergonomics, and adequate for a single-tenant prototype.
  Its filtering and scaling story is materially weaker, and §12.2 already
  designates it for POC / smaller deployments.
- **FAISS** — a library, not a service. No payload filtering, no auth, no
  persistence model of its own, no horizontal scaling. Excellent for an offline
  embedding-quality experiment; not a database.

## Consequences

### Good

- **Tenant isolation is enforced at the store.** Combined with the
  `TenantScoped` shape in the relational layer, there is one consistent rule:
  filter on `tenant_id` *and* `workspace_id`, everywhere. See
  [ARCHITECTURE §8.1](../architecture.md#81-tenant-isolation).
- **No dev/prod vector-store split.** The most reliable way to discover that
  your filters do not scale is to develop against a different store than you
  deploy; that path is closed.
- **Hybrid search without a second system.** §12.3 is satisfiable inside one
  store, so there is no dense/sparse consistency problem to manage.
- **Private deployment is unblocked.** §72's AUP path needs a self-hostable
  store, and this is one.

### Bad, and what we do about it

- **Another stateful service to operate.** Postgres, Redis, Qdrant and object
  storage is four. Accepted: §64 specifies all four, and each is doing a job the
  others do not.
- **Vectors and rows can diverge.** A chunk row in Postgres and its point in
  Qdrant are two writes with no shared transaction. The mitigation is that
  Postgres is the source of truth (`Chunk.id` is the point id), the document
  pipeline is idempotent per `(document_id, document_version)`, and a
  reconciliation sweep on the worker's `maintenance` queue is Phase 1 work.
- **Re-embedding is a real operation with a real cost.** Changing
  `EMBEDDING_MODEL` changes the dimension, so the collection is recreated rather
  than migrated. `KnowledgeBase.embedding_model` and
  `DocumentVersion.embedding_version` exist so a knowledge base knows which
  model produced its vectors. This is also the migration path a private-AUP
  deployment must take when moving off the external-API embedding model — see
  [ARCHITECTURE §5](../architecture.md#5-the-rag-pipeline).
- **Health checks use Qdrant's `/readyz` endpoint.** Native and managed
  deployments can probe it directly with the platform health-check mechanism.
- **Payload indexes must actually be created.** A filtered search against an
  unindexed payload key still returns correct results — slowly — so the missing
  index is a performance bug that hides. The API creates them on startup, which
  keeps the invariant with the code that depends on it rather than in a runbook.
