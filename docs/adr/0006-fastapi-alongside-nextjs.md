# ADR-0006 — FastAPI for AI orchestration, alongside Next.js for the frontend

- **Status:** accepted
- **Date:** initial architecture pass
- **Spec:** Part II §63 (backend architecture), §64 (stack), §66 (multi-agent backend), §69 (API direction), §70/§71 (provider integration), §101; Part I §56 (API surface), §49 (NFR)
- **Related:** [ADR-0001](0001-pnpm-workspace-plus-separate-python-app.md)

## Context

Next.js can serve an API. Route handlers, server actions and middleware are
capable, and a single-language stack has real advantages: one dependency graph,
one deployment, shared types with no mirroring, one CI job. Given
[ADR-0002](0002-typescript-as-contract-source-of-truth.md) exists entirely to
manage the cost of *not* doing that, the option deserves a serious answer.

Part II §64 and §101 both specify Python FastAPI for the AI layer. The reasons
hold up independently of the spec:

**The AI ecosystem is Python.** Not marginally — decisively, for the specific
things this platform does. Document parsing (`pypdf`, `python-docx`,
`python-pptx`, `unstructured`), OCR bindings (`pytesseract`), tokenizers,
cross-encoder reranking, embedding models when self-hosted, and the mature
Qdrant client are all Python-first. Part II §65's pipeline —
`Parser → OCR → Structure → Chunking → Metadata → Embedding` — is a Python
pipeline. The Node equivalents exist and are consistently thinner, less
maintained, or wrappers around a Python or native tool.

**AMD AUP private inference is Python.** Part II §72 puts local embedding, the
reranker, a private LLM, the document parser and the evaluation model inside a
private compute environment. Whatever serves those models exposes a Python
client. A Node orchestrator would call Python over HTTP anyway — the same
process boundary, with less control.

**The workload is long-running and CPU-bound, which Next.js is not built for.**
Part II §65 is an async job (Part I §5.1 requires async document processing and a
queue/worker architecture). A 200-page scanned PDF is minutes of OCR and
parsing. Next.js has no first-class worker story; Celery is a solved problem.

**Multi-agent orchestration wants structured LLM output.** Part II §66 requires
every agent to return structured data. Pydantic is the model of that in the
Python LLM ecosystem — validators, discriminated unions, retry-on-parse-failure
— and it is the same library the domain layer already uses.

## Decision

**Next.js owns the browser experience. FastAPI owns AI orchestration and the
data plane. The boundary is `/api/v1` plus `/ws`.**

```text
Browser
   │  REST + WebSocket
   ▼
Next.js (apps/web)          ── rendering, routing, session cookies,
                               the BFF surface for view-shaped data
   │  server-to-server
   ▼
FastAPI (apps/api)          ── Part I §56 router surface,
                               Part II §63's seven services,
                               Part II §66's seven agents,
                               Part II §65's RAG pipeline
   │
   ├── Postgres · Qdrant · Redis · S3/MinIO
   └── OpenAI · ElevenLabs · AMD AUP      ← credentials live ONLY here
```

Division of responsibility:

| Concern | Owner |
|---|---|
| Rendering, routing, layout, theme | Next.js |
| Session cookie, CSRF, auth redirect | Next.js (tokens minted by FastAPI) |
| Reshaping API data for a view | Next.js route handlers, where it helps |
| Everything in Part I §56 | FastAPI |
| Agents, RAG, evaluation, safety | FastAPI |
| The session WebSocket and its event stream | FastAPI |
| Async document and evaluation jobs | Celery workers, same codebase as FastAPI |
| Provider credentials | **FastAPI only** |

That last row is a hard rule, not a preference. Part I §56 and Part II §70/§71
require that OpenAI and ElevenLabs long-lived keys never reach the browser, and
the paths are specified: `Browser → BFF → AI Orchestration → OpenAI`, and
`Browser → Voice Session Service → ElevenLabs → streaming audio`. Keeping the
credential-holding process in a different language and a different container
than the one that renders HTML makes the boundary physical rather than a
convention. There is no `NEXT_PUBLIC_OPENAI_KEY` to accidentally add, because
the key is not in that process at all.

FastAPI specifically, over Django or Flask: native async (the orchestrator is
I/O-bound on the LLM, the vector store and the database simultaneously), native
WebSocket support (Part I §55's event stream), Pydantic-based request and
response models that reuse the domain layer directly, and generated OpenAPI for
free.

## Consequences

### Good

- **The right library is always available.** Every document-processing, OCR,
  tokenizing and reranking need is a `pip install`, not a search for a Node
  port.
- **The credential boundary is physical.** A different process, image and
  language. The mistake of shipping a key to the browser is not one step away.
- **Async workers are natural.** The `documents` / `evaluation` /
  `maintenance` queues run the same code as the request path, from the same
  image — see `infra/docker/worker.Dockerfile`, which shares the API's
  dependency closure specifically so the RAG code cannot drift between them.
- **Statelessness is easy to hold.** Session continuity is Postgres plus Redis,
  never process memory, so API replicas are interchangeable and a WebSocket
  reconnect can land anywhere (Part I §49.3).
- **AUP deployment is a configuration change**, not a rewrite.
- **Two independent scaling knobs.** Rendering and orchestration have completely
  different resource profiles and now scale separately.

### Bad, and what we do about it

- **The contract must be mirrored.** The direct cost, addressed in
  [ADR-0002](0002-typescript-as-contract-source-of-truth.md) and enforced by
  `scripts/check-contracts.sh`.
- **Two toolchains, two CI jobs, two dependency-audit flows.** Accepted; see
  [ADR-0001](0001-pnpm-workspace-plus-separate-python-app.md).
- **An extra network hop for browser→API traffic.** Real, and mostly irrelevant:
  the dominant latency in this product is the LLM turn, measured in seconds.
  Where it does matter — the streaming event channel — the browser connects to
  FastAPI's WebSocket directly through the proxy, not via Next.js, so there is
  no extra hop on the latency-sensitive path.
- **Auth spans two services.** FastAPI mints and validates tokens; Next.js holds
  the cookie and redirects. The shared secret is `JWT_SECRET`, and the API
  refuses to boot outside local with the placeholder value.
- **Local development needs two processes.** `pnpm dev` and `pnpm api:dev`.
  `scripts/bootstrap.sh` prints both, and the compose `app` profile runs
  the whole thing in containers when you want the production shape.
- **Duplicated cross-cutting concerns.** CORS, security headers and rate limits
  need thinking about at the proxy, in Next.js and in FastAPI. This is
  documented rather than deduplicated, and it has a real gotcha:
  `apps/web/next.config.mjs` emits the CSP, and the proxy deliberately does not
  add a second one, because two CSP headers are enforced as their intersection
  and would silently break the inference worker. See
  [ARCHITECTURE §7](../architecture.md#7-cross-origin-isolation-why-the-edge-sets-coop--coep).

### Rejected alternatives

- **Next.js route handlers only, no Python** — rejected. The document pipeline,
  OCR, reranking and AUP private inference would each be a fight, and the
  credential boundary would become a convention inside one process rather than a
  property of the deployment.
- **Django or Flask** — rejected on async and WebSocket support. Part I §55's
  event stream and the orchestrator's concurrent I/O are what FastAPI is for.
- **A separate WebSocket service** — considered and deferred. Part I §49.3 says
  "WebSocket gateway where required", which is a scaling decision, not a day-one
  one. `app/ws/` is a module boundary today and can be lifted into its own
  deployment when connection counts justify it.
- **gRPC between Next.js and FastAPI** — rejected. The browser needs REST and
  WebSocket regardless, so gRPC would add a third protocol serving only the
  server-to-server leg.
