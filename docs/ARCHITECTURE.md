# Architecture

Engineering reference for the AI Coach platform. If you have just joined, read
this top to bottom once; after that, use the section-to-directory table at the
end as the index.

**Companion documents**

| Document | What it answers |
|---|---|
| [`docs/spec/AI_Coach_Spec_v3.md`](spec/AI_Coach_Spec_v3.md) | What the product must do. Authoritative. |
| [`docs/PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md) | Where a file goes, and who owns it. Authoritative. |
| [`docs/ROADMAP.md`](ROADMAP.md) | What is actually built today. Honest. |
| [`docs/adr/`](adr/) | Why each decision was made, and what it cost. |
| This file | How the pieces fit together. |

> **A note on section numbers.** The spec contains two independent numbering
> sequences: **Part I** (product and functional requirements, §1–§61) and
> **Part II** (UI, WebGPU, frontend and backend architecture, §0–§102). A bare
> "§55" is therefore ambiguous. This document writes **Part I §n** or
> **Part II §n** wherever confusion is possible. Where the two parts conflict,
> Part I wins on product and business rules; Part II wins on visual and
> frontend engineering.

---

## 1. The two one-line summaries

The spec closes with two sentences that are worth internalising before anything
else, because every decision in this repository is downstream of them.

**The technical decision** (Part II §101):

> Build the complete Soft Aurora glassmorphism UI in Next.js + React +
> TypeScript; use FastAPI as the enterprise AI orchestrator; build the data
> layer from PostgreSQL + Qdrant + Redis + object storage; use OpenAI and
> ElevenLabs as the cloud AI and voice services; and establish a three-tier
> **WebGPU → WASM → Server** inference abstraction in the browser so that some
> embedding, intent, rerank and lightweight-model work can run on a supporting
> client GPU — **while guaranteeing that every enterprise environment can fall
> back and still work normally.**

**The design decision** (Part II §102):

> Port the reference image's soft Aurora background, frosted glass, floating
> cards, document-like transcript, narrow icon rail and pastel AI pill
> faithfully into an enterprise AI Coach — and on the functional side, build a
> genuinely deployable platform: knowledge base, persona, multi-agent, voice,
> WebGPU, scoring, security and administration.

And the product framing that keeps scope honest (Part I §61) — this is **not**
"enterprise ChatGPT". It is an **AI Training Infrastructure**: enterprise
knowledge, expert experience, dynamic character scenarios, realistic voice,
multi-agent AI, capability assessment, personalised learning and safety
governance, integrated into something that can be deployed at scale.

---

## 2. System diagram

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│ BROWSER                                                                       │
│                                                                               │
│  Next.js App Router (apps/web)                                                │
│  ├── app/                     routes + layout only, no business logic         │
│  ├── features/simulation/     the live loop: transcript, persona, coach        │
│  ├── packages/ui              glass components (Radix behaviour, custom skin)  │
│  ├── packages/design-tokens   every colour, blur and radius                    │
│  └── packages/ai-runtime  ──► Web Worker                                       │
│                                ├── WebGPU backend (ONNX Runtime Web)           │
│                                ├── WASM SIMD backend  (needs COOP+COEP)        │
│                                └── Server backend (delegates to the API)       │
└───────┬───────────────────┬───────────────────────────┬───────────────────────┘
        │ HTTPS REST        │ WebSocket  /ws            │ WebRTC (media)
        │                   │ (session events)          │ ── not through nginx ──
        ▼                   ▼                           ▼
┌───────────────────────────────────────────────┐   ┌──────────────────────────┐
│ EDGE  nginx (infra/docker/nginx.conf)         │   │ STUN / TURN              │
│  TLS · gzip/brotli · rate limit · §73 headers │   │ (not yet deployed —      │
│  COOP: same-origin + COEP: require-corp       │   │  see ROADMAP Phase 1)    │
│  WebSocket upgrade · WebRTC signalling only   │   └──────────────────────────┘
└───────────────────────┬───────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│ API GATEWAY / BFF  —  FastAPI app factory (apps/api/app/main.py)              │
│   auth · tenant resolution · RBAC · rate limit · request id · audit           │
│   Part I §56 router surface, one file per endpoint group                      │
└───────────────────────┬───────────────────────────────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│ AI ORCHESTRATION  (apps/api/app/agents/, app/ws/)                             │
│                                                                               │
│                        Conversation Orchestrator                              │
│                                    │                                          │
│         ┌──────────────────┬───────┴────────┬──────────────────┐              │
│         ▼                  ▼                ▼                  ▼              │
│  Scenario Director   Customer Agent   Knowledge Agent    Coach Agent          │
│    phase, difficulty   persona, state    RAG, citation     hint, next step     │
│    hidden vars,        trust/interest/   scope control     missed signal       │
│    event injection     resistance        insufficiency     (training only)     │
│         └──────────────────┴───────┬────────┴──────────────────┘              │
│                                    ▼                                          │
│                       Compliance Agent  ──►  Evaluator Agent                  │
│                       false promise,         score, evidence,                  │
│                       PII, injection,        confidence, rubric                │
│                       restricted topic       (Part I §26–§28)                  │
│                                                                               │
│  Every agent returns STRUCTURED data (Part II §66). Schemas: app/domain/.      │
└───────────────────────┬───────────────────────────────────────────────────────┘
                        │
                        ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│ SERVICE LAYER  (apps/api/app/services/) — the seven services of Part II §63    │
│                                                                               │
│  Session   Persona   Knowledge   Question   Evaluation   Safety   Report       │
└───┬──────────┬──────────┬──────────┬───────────┬──────────┬─────────┬────────┘
    │          │          │          │           │          │         │
    ▼          ▼          ▼          ▼           ▼          ▼         ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│ DATA PLANE                                                                     │
│                                                                                │
│  PostgreSQL 16      every entity of Part I §53. Source of truth. No vectors.   │
│  Qdrant             embeddings, payload-filtered by tenant/workspace/kb (§74). │
│  Redis 7            cache · rate-limit buckets · Celery broker · WS pub/sub.   │
│  S3 / MinIO         source documents, report PDFs, session audio. Signed URLs. │
└────────────────────────────────────────────────────────────────────────────────┘
    ▲                                                    ▲
    │  Celery workers (apps/api/app/workers/)            │
    │  parse → chunk → embed → index (§65)               │
    │  post-session evaluation · retention sweeps        │
    └────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────┐
│ EXTERNAL — reached ONLY from the API process. No credential ever in a browser. │
│                                                                                │
│  OpenAI        LLM turns, optional STT/TTS. Retry, timeout, quota,             │
│                audit, model routing (Part II §70).                             │
│  ElevenLabs    production TTS, streamed back through the Voice Session         │
│                Service so no long-lived credential is exposed (§71).           │
│  AMD AUP       private compute: local/private embedding, reranker, document    │
│                parser, evaluation model, private LLM, vector DB (§72).         │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The three realtime channels

Part II §49 splits browser↔server traffic into three channels with genuinely
different characteristics. Knowing which one a piece of data belongs on is most
of the realtime design.

| Channel | Transport | Carries | Latency budget | Failure mode |
|---|---|---|---|---|
| **REST** | HTTPS, `/api/v1/*` | Everything that is a resource: knowledge bases, documents, chunks, questions, personas, scenarios, assignments, users, teams, reports, audit, integrations, runtime policy (Part I §56). Session creation and session end. | 120 s ceiling at the proxy — report generation and LLM-backed generation endpoints are genuinely slow | Retry with exponential backoff; idempotency keys on mutating calls (§49.4) |
| **WebSocket** | `wss:///ws` | The live session: transcript partials and finals, agent thinking indicators, persona state deltas, coach insights, knowledge citations, score updates, compliance warnings, runtime fallback notices, reconnect notices (Part II §55/§68). Also WebRTC **signalling**. | Sub-second, streaming. Proxy buffering is off; `partial` events must render as they arrive (§95) | Monotonic `seq` on every event. A gap means a lost event: the client requests replay from the last acked `seq`, and `connection.reconnecting` is itself an event on the channel |
| **WebRTC** | SRTP/ICE, UDP | Microphone audio, low-latency voice, optionally avatar media | Voice-grade: barge-in has to interrupt within a few hundred milliseconds | Falls back to WebSocket-framed audio streaming, then to text-only. **Does not traverse the HTTP proxy** — it needs STUN/TURN (and an SFU for avatar media) deployed alongside |

Two consequences worth stating plainly:

- **Nothing that changes during a session travels by REST polling.** Persona
  state, live scores and citations are pushed. Part II §95 requires incremental
  persona-state updates, not refetches.
- **The WebSocket is bidirectional and typed.** Client→server messages are the
  `ClientCommand` union (`message.send`, `session.pause`, `session.resume`,
  `session.end`, `coach.request_hint`, `voice.push_to_talk`,
  `client.intent_hint`, `ack`). `client.intent_hint` is where the browser's
  local intent classification lands — as a *hint*, never as a decision.

### The event timeline of one turn

```text
 t   client                       socket                        server
 ─────────────────────────────────────────────────────────────────────────────
 0   push-to-talk pressed  ──►  voice.push_to_talk
 0   (local VAD, WebGPU)
 0                          ◄──  speech.started {speaker: trainee}
 .   partial ASR            ◄──  speech.partial {text}          streaming STT
 .   local intent classify  ──►  client.intent_hint {intent, confidence}
 1s  utterance ends         ◄──  speech.final {turn}            TranscriptTurn persisted
 ─────────────────────────────────────────────────────────────────────────────
 1s                         ◄──  agent.thinking {orchestrator}
 1s                         ◄──  agent.thinking {knowledge}     RAG retrieval starts
 2s                         ◄──  knowledge.citation {citations}  Part I §12.5
 2s                         ◄──  agent.thinking {customer}
 2s                         ◄──  agent.response.partial {delta}  token streaming
 .                          ◄──  agent.response.partial {delta}
 3s                         ◄──  agent.response.final {turn}
 ─────────────────────────────────────────────────────────────────────────────
 3s                         ◄──  persona.state.updated {state}   drives the right column
 3s                         ◄──  score.updated {skill, ...}      training mode only
 3s                         ◄──  coach.insight {insight}         training mode only
 3s                         ◄──  compliance.warning {finding}     if the turn tripped a rule
 3s  TTS playback begins    ◄──  speech.started {speaker: persona}
 ─────────────────────────────────────────────────────────────────────────────
     ... repeat until the trainee ends, the time limit expires, or the
         persona's exit_condition fires ...
 ─────────────────────────────────────────────────────────────────────────────
 end session.end            ──►
                            ◄──  session.completed {evaluation_id}
     (client navigates to the review page; the Evaluator Agent's full run
      happens on the `evaluation` worker queue, not on the socket)
```

Ordering guarantees that the frontend relies on:

1. `speech.final` for a turn precedes any `agent.*` event caused by that turn.
2. `knowledge.citation` precedes the `agent.response.final` whose text it
   supports — a claim never renders before its citation is available.
3. `persona.state.updated` follows `agent.response.final`, so the state card and
   the transcript never disagree mid-render.
4. `seq` is strictly increasing per session across *all* event types.

**Assessment mode suppresses events, it does not hide them client-side.**
Part I §8.4 and §24 are explicit: in `assessment` mode the server must not emit
`coach.insight` of kind `hint` or `next_strategy`, and `score.updated` is
withheld when `score_live_enabled` is false. A frontend that merely does not
render them is a bug, because the data reached the browser.

---

## 4. The multi-agent turn loop

Part I §19 and Part II §66 define seven agents. The orchestrator is not a
router; it owns the turn.

```text
one turn
────────
1. Ingest         the trainee's utterance (text, or final ASR)
2. Classify       intent. Server-side, optionally seeded by the browser's
                  client.intent_hint. Handles the Part I §21 hard cases:
                  ambiguous, off-topic, over-scope, role escape, prompt
                  injection.
3. Direct         Scenario Director advances scenario_phase, adjusts
                  difficulty, may inject an event or apply time pressure.
4. Retrieve       Knowledge Agent runs the §65 retrieval leg and returns
                  chunks + citations, or reports knowledge insufficiency —
                  which is a first-class answer, not a failure.
5. Respond        Customer Agent produces the persona's reply, constrained by
                  the persona's hidden state, forbidden_knowledge and current
                  goal. Streams as agent.response.partial.
6. Update state   PersonaSimulationState: phase, emotion, trust, interest,
                  resistance, patience, intent, current_goal,
                  hidden_need_revealed, compliance_risk.
7. Screen         Compliance Agent evaluates the trainee's turn (and the
                  persona's) against the tenant's rules. A critical finding
                  can interrupt the turn.
8. Coach          Coach Agent may emit a hint or a missed-signal note.
                  Training mode only.
9. Score          Evaluator Agent updates the running skill scores with
                  evidence. Live scoring is optional per session; the
                  authoritative pass happens after session end.
```

Three rules that are load-bearing:

- **Every agent returns structured data** (Part II §66). Never free text that
  another agent has to re-parse. The schemas live in `apps/api/app/domain/`.
- **The persona's hidden state never leaves the server for a trainee.**
  `PersonaHiddenState` (Part I §16.3) — hidden need, trigger points,
  objections, forbidden knowledge, exit condition — is readable by coach and
  admin only. This is a serialisation-boundary rule, and nested serialisers are
  where it gets broken.
- **Version pinning.** A `TrainingSession` records `scenario_version` and
  `persona_version`. Editing a scenario afterwards must not change what a past
  report says happened. See [ADR-0008](adr/0008-version-pinned-sessions.md).

---

## 5. The RAG pipeline

Part II §65, with the retrieval controls of Part I §12.3:

```text
Document (S3/MinIO, signed upload URL)
    │
    ▼  Parser            pdf / docx / pptx / txt / csv / html / url / manual
    ▼  OCR if needed     scanned PDFs — tesseract, in the worker image only
    ▼  Structure         headings, tables, sections → chunk boundaries
    ▼  Chunking          auto | semantic | heading | paragraph | fixed_token
    │                    | table_aware | faq_aware
    ▼  Metadata          tenant_id, workspace_id, knowledge_base_id,
    │                    document_id, document_version, page, section, tags
    ▼  Embedding         ◄── see the note below; this is the one step where the
    │                        spec corrects itself
    ▼  Qdrant            upsert with the payload above; payload indexes on the
    │                    three tenancy keys (§74)
    ═══ query time ═══
    ▼  Retrieve          top-K, similarity threshold, metadata filter, hybrid
    │                    (dense + keyword), query rewrite, multi-query
    ▼  Rerank            cross-encoder. Server-authoritative.
    ▼  Parent expansion  optional: retrieve the parent chunk for context
    ▼  Context           assembled prompt context
    ▼  LLM               the Knowledge Agent's answer
    ▼  Citation          chunk_id, document_id, document_name,
                         document_version, page, section, similarity,
                         rerank_score, snippet
```

### Local/private embedding vs API embedding — the spec's own correction

Part I §2.1 offers two embedding paths and then explicitly corrects a common
error. It is worth quoting the shape of it, because the mistake is easy:

```text
Private path                          External API path
────────────                          ─────────────────
AMD AUP cloud / private AI env        Approved enterprise policy
        ↓                                     ↓
BGE / multilingual-e5 / another       OpenAI text-embedding-3-* or an
approved OPEN model                   equivalent API
        ↓                                     ↓
Embedding                             Embedding
        ↓                                     ↓
Qdrant / Chroma / FAISS               Vector database
```

> **The correction (Part I §2.1):** `text-embedding-3-*` is an **OpenAI API
> embedding model**. It is *not* an open model that can be deployed inside AMD
> AUP. Documentation must describe "Local / Private Embedding" and "External
> API Embedding" as two separate things.

What that means for this codebase:

- `EMBEDDING_MODEL` / `EMBEDDING_DIMENSION` in the environment select **which
  path is in use**, and the two paths are not interchangeable at runtime. The
  default (`text-embedding-3-large`, 3072 dimensions) is the API path.
- A private AUP deployment must switch to an approved open model and
  **re-embed**. The dimension changes, so the Qdrant collection is *recreated*,
  not migrated. `KnowledgeBase.embedding_model` and
  `DocumentVersion.embedding_version` exist so a knowledge base knows which
  model produced its vectors and can be re-indexed deliberately.
- The `infra/scripts/seed.py` knowledge base carries an inline note to the same
  effect, so nobody reads the seed as an endorsement of self-hosting an OpenAI
  model.

### Where client-side embedding fits

The browser's local embedding (Part II §52.1) is for **query** embedding in the
Retrieval Playground and local semantic search — never for indexing. A document
is embedded exactly once, server-side, by the worker. If the client and the
server used different embedding models, a locally-embedded query would be
searching a space it does not belong to; that is why local embedding is scoped
to playground-style exploration and why the server remains the authority for
what a session actually retrieves.

---

## 6. The three-tier client inference chain

Part II §51 states the constraint before the design: **WebGPU is an
acceleration layer, not the product's only dependency.** Browsers differ,
enterprise environments lock browser versions, and therefore core function
cannot stop when WebGPU is unavailable. Part II §99 lists "treating WebGPU as
the only backend the browser must support" as a forbidden practice.

```text
                     capability detection (in a Worker)
                                   │
                     navigator.gpu available?
                        ┌──────────┴──────────┐
                       yes                    no
                        │                      │
                        ▼                      ▼
                 WebGPU backend          WASM SIMD backend
                 ONNX Runtime Web        (multi-threaded only when
                 transformers.js-         the document is cross-origin
                 compatible models        isolated — see §7)
                        │                      │
                        └──── fallback ────────┤
                        device lost            │
                        memory exceeded        │
                        unsupported operator   │
                        timeout                ▼
                                        Server backend
                                        (the API does the work)
```

**Model lifecycle** (Part II §60):
`detect → select backend → download manifest → cache model → warmup →
inference → idle timeout → release GPU resources`. The idle release matters:
holding a GPU adapter for the length of a workday is a real problem on shared
enterprise hardware.

**What may run locally** (Part II §52–§55), and what the server still owns:

| Task | Local | Server authority |
|---|---|---|
| Query embedding | yes — playground, local semantic search | Indexing embeddings are server-only |
| Intent classification | yes — result sent as `client.intent_hint` | The server classifies too; the hint is advisory input to the orchestrator |
| Reranking | yes, when performance allows: top-20 → top-5 | **Server-authoritative scoring is required** for finance/insurance contexts. The client's order is a UI nicety |
| Safety pre-check | yes — PII patterns, restricted keywords, prompt-injection heuristics, sensitive-phrase masking | **The server Safety Agent is the final authoritative layer.** Always. |
| Visual effects | optional — ambient gradient, particles, voice visualiser, avatar | The UI must be fully presentable in CSS alone. Do not force WebGPU for glass |

**The rule, stated once, unambiguously:**

> The server is always authoritative for safety, reranking and scoring. A
> client may compute any of the three, and the server never trusts the result.
> No score, rerank order or safety verdict arriving from a browser is
> persisted, and none of them can change a compliance finding.

This is not defensive coding for its own sake. A trainee's browser is an
attacker-controlled environment with respect to their own assessment: a client
that could set its own score would make the whole evaluation layer worthless.

**Cache and enterprise mode** (Part II §61, §97): local model cache and
sensitive-data cache are both switchable off, and `clear_on_logout` is
available. `RuntimePolicy` carries these; an admin may force WebGPU to
`on`/`off`/`auto` for the tenant. First-time local acceleration is opt-in
through the §97 prompt, not silent.

**Bundle rule** (Part II §96): the WebGPU/ML packages are dynamically imported
and must not appear in the initial bundle. They preload on the persona and
simulation pages only. CI prints an advisory bundle report for this.

---

## 7. Cross-origin isolation: why the edge sets COOP + COEP

This deserves its own section because it is the least obvious coupling in the
whole system, and the failure mode is confusing.

Multi-threaded WASM needs `SharedArrayBuffer`. `SharedArrayBuffer` needs the
document to be **cross-origin isolated**. Cross-origin isolation needs both:

```
Cross-Origin-Opener-Policy:   same-origin
Cross-Origin-Embedder-Policy: require-corp
```

So the WASM *fallback* tier — the one that exists specifically to serve
locked-down enterprise browsers where WebGPU is unavailable — is single-threaded
and effectively unusable unless the edge sets these headers. WebGPU itself does
not need isolation; the fallback does. That inverts the intuition: the headers
matter most on the machines least likely to have a GPU path.

**The cost.** `COEP: require-corp` makes the browser refuse every cross-origin
subresource that has not opted in via `Cross-Origin-Resource-Policy:
cross-origin` or `crossorigin="anonymous"` plus permissive CORS. Third-party
fonts, avatars, CDN images, analytics pixels and `<iframe>` embeds all break.
Notably it would break audio streamed directly from a provider URL to an
`<audio>` element — which is not a problem today only because Part II §71
routes TTS through our own Voice Session Service rather than handing the browser
a provider URL. If someone "optimises" that into a direct provider fetch, COEP
is where it will fail.

**Opting a route out**, in order of preference — the full recipes are in
[`infra/docker/nginx.conf`](../infra/docker/nginx.conf):

1. `COEP: credentialless` — keeps isolation, drops the CORP requirement for
   no-cors subresources. Chromium and Firefox support it; Safari does not.
2. Drop isolation for that route (`COEP: unsafe-none`, and
   `COOP: same-origin-allow-popups` if it is an OAuth popup flow — plain
   `same-origin` severs `window.opener` and the popup can never return a
   token). Appropriate for routes that must embed a third-party frame (SSO
   consent, an embedded LMS view — Part I §43) and that do not run local
   inference.
3. Proxy the offending asset through our own origin. The best long-term answer
   for fonts and avatars, and it also satisfies the §73 CSP.

**One nginx gotcha:** a `location` that sets any `add_header` replaces the
entire inherited set. Every opt-out block therefore has to re-state the headers
it still wants. The config does this explicitly; it is not duplication by
accident.

**And one CSP note:** `apps/web/next.config.mjs` already emits a CSP tuned for
the local runtime (`wasm-unsafe-eval`, `worker-src blob:`). The proxy
deliberately does **not** add a second CSP for the web upstream, because two CSP
headers are enforced as their *intersection* — a second one would silently break
the inference worker in a way that only reproduces behind the proxy. The API's
location block gets its own narrow CSP, because it serves no HTML.

---

## 8. Security model

### 8.1 Tenant isolation

Part I §10 / Part II §74. The tenancy chain is:

```text
Organization → Workspace → Team → User
```

Rules:

- **Every tenant-scoped row carries both `tenant_id` and `workspace_id`.**
  `TenantScoped` in `packages/shared-types` makes this structural rather than a
  convention. A table with one but not the other is a bug.
- **Every query filters on both.** Filtering on `workspace_id` alone is the
  specific mistake this rule exists to prevent: workspace ids are unique in
  practice, so such a query *works* — until an id collides or an id is guessed.
- **Qdrant points carry `tenant_id`, `workspace_id` and `knowledge_base_id` in
  their payload**, with payload indexes on all three, and every search is
  payload-filtered. A vector store without tenant filters is a cross-tenant
  data leak with extra steps.
- **Knowledge access control is a second layer on top** (Part I §39):
  `KnowledgeAcl` scopes a knowledge base to organization / workspace /
  department / team / role / user, with per-permission grants (`view`,
  `use_for_rag`, `edit`, `review`, `publish`, `export`, `delete`). Being inside
  the right tenant does not imply access to a knowledge base within it.

### 8.2 RBAC

Part I §9. Five roles: `trainee`, `coach`, `manager`, `admin`, `reviewer`. Deny
by default. The role checks that carry real weight:

- `PersonaHiddenState` (§16.3) — coach and admin only. Never in a
  trainee-scoped response, including through a nested serialiser.
- Coach hints and `next_strategy` insights — suppressed server-side in
  `assessment` mode (§8.4 / §24).
- Another trainee's evaluation, evidence and transcript — manager/coach scope,
  and only for their own team.
- Audit log, integrations, model settings, security findings — admin.
- Content approval transitions (§38) — reviewer/admin. An author cannot publish
  their own generated question.

### 8.3 Where secrets live

Part I §56, Part II §70 / §71 are unambiguous, and it is the single rule with
the least room for judgement in the entire codebase:

> **OpenAI and ElevenLabs long-lived API keys must not be placed in the
> browser.**

Concretely:

```text
Browser → BFF → AI Orchestration → OpenAI          (§70)
Browser → Voice Session Service → ElevenLabs        (§71)
```

- Provider keys are read only by the API process, only from the environment,
  via `apps/api/app/core/config.py`, and are typed as `SecretStr` so they
  cannot be accidentally serialised into a response model.
- Outside `APP_ENV=local`, the API **refuses to boot** with a placeholder
  `JWT_SECRET` or a missing key for an enabled provider. Failing at startup is
  better than failing at the first request.
- `NEXT_PUBLIC_*` is inlined into the client bundle by Next.js, so anything in
  that namespace is public by construction. `.github/workflows/security.yml`
  has a dedicated check that fails the build on a credential-shaped
  `NEXT_PUBLIC_*` name — not on its value, on its *name*, because the value
  being empty today is not a defence.
- The audio and LLM paths above exist so the browser never holds a provider
  credential even transiently. Where a short-lived, narrowly-scoped ephemeral
  token is genuinely required, it is minted server-side per session with a
  minimal TTL — it is not the long-lived key.

### 8.4 Browser-side security

Part II §73: CSP, secure cookies, CSRF protection, XSS sanitation, HTTPS only.
Implemented across `apps/web/next.config.mjs` (CSP, HSTS, Permissions-Policy)
and `infra/docker/nginx.conf` (transport headers, HTTP→HTTPS redirect, rate
limits). Session cookies are `Secure` outside local, and there is a separate
CSRF cookie.

### 8.5 PII and the safety layer

Part I §40 and the Compliance Agent (§19.5). The layered design:

1. **Client pre-check** (optional, Part II §55) — PII patterns, restricted
   keywords, prompt-injection heuristics, sensitive-phrase masking. Fast
   feedback only.
2. **Server Safety Agent** — authoritative. Produces `ComplianceFinding` rows
   typed by `ComplianceFindingType`: `false_promise`,
   `misleading_statement`, `unsupported_claim`, `privacy_issue`,
   `unauthorized_advice`, `sensitive_information`, `missing_disclosure`,
   `prompt_injection`, `restricted_topic`.
3. **Evidence, always.** A finding carries the transcript quote, the policy rule
   it violates, an explanation and a suggested correction. Part I §27 forbids a
   bare number in scoring, and the same principle applies here: a finding
   without evidence is not reviewable and therefore not actionable.
4. **Proxy logs exclude query strings and bodies.** Transcripts and knowledge
   queries are trainee content; they belong in the database under retention
   policy, not in an access log.

### 8.6 Audit

Part I §42. Recorded: login, logout, file upload, file delete, knowledge
change, chunk edit, persona change, scenario change, prompt change, rubric
change, model change, permission change, report export, API access, security
finding. Fields: time, user, action, resource, workspace, IP/session, result,
risk. `AuditEvent` in `shared-types` is that row. The nginx `$request_id` is
propagated as `X-Request-Id` so a proxy log line, a structured API log line and
an audit row can be correlated.

### 8.7 Retention

`TRANSCRIPT_RETENTION_DAYS` (default 365) drives a periodic sweep on the
worker's `maintenance` queue. Object storage carries a 30-day expiry rule on the
`tmp/` prefix for parser and OCR intermediates, and bucket versioning is on so a
bad re-parse is recoverable. Deletion is a real deletion, not a flag — Part I
§40.2.

### 8.8 External audit

Part I §41 and Part II §100 both call for an external security audit before the
platform handles real enterprise data. §41 is deliberately cautious about how
this is described: CertiK is known primarily for Web3 / blockchain security, so
a general enterprise AI SaaS proposal should claim only demonstrable scope, and
until an engagement exists should say **"CertiK or an equivalent external
security audit provider"** rather than naming one. Findings surface in-product
under **Security & Audit** with severity, component, scan time, status and
recommendation. This sits in [ROADMAP Phase 3](ROADMAP.md).

Everything in `.github/workflows/security.yml` — dependency review, `pip-audit`,
`pnpm audit`, gitleaks, CodeQL — is the automated floor beneath that, not a
substitute for it.

---

## 9. Non-functional targets

From Part I §49 and Part II §95.

### Performance

| Target | Value | Where it is won |
|---|---|---|
| First interaction | < 2.5 s on the target enterprise desktop | Server components, §96 bundle discipline, no ML in the initial bundle |
| Animation | 60 fps | Transform/opacity-only animation; no layout thrash on state updates |
| Main-thread ML inference | **none** | All local inference in a Worker (Part II §58) |
| Transcript | partial streaming, rendered as it arrives | `speech.partial` / `agent.response.partial`; `proxy_buffering off` |
| Persona state | incremental event updates | `persona.state.updated` deltas, never a refetch |

### Voice latency

The principle is *perceived* latency (Part I §49.2): partial ASR, incremental
LLM output where the model supports it, streaming TTS, and barge-in. Do not wait
for a complete long sentence before updating the UI.

### Scalability

Horizontally scalable: stateless API, async workers, vector DB, queue, object
storage, and a WebSocket gateway where required (§49.3). Concretely — session
continuity lives in Postgres plus Redis, not in an API process's memory, so
replicas are interchangeable and a reconnect can land on any of them.

### Reliability

Retry, exponential backoff, reconnect, idempotency where applicable, session
recovery, job retry, circuit breaker (§49.4). The two that shape the code most:
the monotonic `seq` on streaming events (which is what makes session recovery
possible at all), and idempotency on mutating REST calls (so a retried
`POST /sessions` does not create two).

### Observability

Structured logs, tracing, metrics, and specifically: LLM latency, token usage,
STT latency, TTS latency, retrieval latency, and WebGPU backend telemetry
(§49.5). The last one carries an explicit constraint — **telemetry without
collecting sensitive content**. `RuntimeTelemetry` carries backend, model id,
load time, last inference time, worker liveness and fallback reason. It does not
carry what was inferred.

### Graceful degradation

Part I §5.1 lists it as a production requirement, and it is the through-line of
the whole runtime design: WebGPU → WASM → server; WebRTC → WebSocket audio →
text; live scoring optional; voice optional; and the UI must never crash on a
fallback (Part II §62).

---

## 10. Spec section → implementation directory

The index. Both spec numbering sequences are covered; the Part column
disambiguates.

| Part | § | Topic | Implemented in |
|---|---|---|---|
| I | 2.1 | Knowledge / question construction; private vs API embedding | `apps/api/app/rag/embedder.py`, `apps/api/app/rag/vectorstore.py` |
| I | 5.2 | High-fidelity MVP loop | end to end — see [ROADMAP Phase 1](ROADMAP.md) |
| I | 6, 8 | Product vision, UX principles | `packages/design-tokens/**`, `apps/web/src/app/**` |
| I | 9 | Roles and RBAC | `apps/api/app/core/security.py`, `app/core/deps.py`, `packages/shared-types/src/state-machines.ts` (`ROLES`) |
| I | 10 | Workspace / tenant model | `apps/api/app/core/context.py`, `app/db/models`, `TenantScoped` |
| I | 11 | Knowledge base features | `apps/api/app/api/v1/routers/knowledge_bases.py`, `documents.py`, `app/services/knowledge.py` |
| I | 12 | Advanced RAG / retrieval | `apps/api/app/rag/**`, `app/api/v1/routers/retrieval.py` |
| I | 12.4 | Retrieval Playground | `apps/web/src/app/(app)/knowledge/[kbId]/playground/`, `packages/ai-runtime` |
| I | 12.5 | Citation | `Citation` in `shared-types`; `apps/api/app/rag/pipeline.py` |
| I | 13 | Knowledge mining | `apps/api/app/services/knowledge.py`, `apps/web/src/features/knowledge/`, `.../mining/` |
| I | 14, 15 | Question bank, AI question generation | `apps/api/app/api/v1/routers/questions.py`, `app/services/question.py`, `apps/web/src/features/questions/` |
| I | 16 | Persona Builder, hidden state | `apps/api/app/api/v1/routers/personas.py`, `packages/shared-types/src/persona.ts`, `apps/web/src/features/personas/` |
| I | 17 | Scenario Builder (9-step wizard) | `apps/web/src/app/(app)/scenarios/[id]/builder/`, `apps/api/.../scenarios.py` |
| I | 18 | Difficulty engine | `apps/api/app/agents/scenario_director.py` |
| I | 19 | Multi-agent orchestration | `apps/api/app/agents/**` |
| I | 20 | Agent structured state | `apps/api/app/domain/persona.py`, `packages/shared-types/src/persona.ts` |
| I | 21 | Intent tolerance and steering | `apps/api/app/agents/orchestrator.py` |
| I | 22 | Two-way realistic voice | `apps/web/src/features/simulation/hooks/useVoiceSession.ts`, `apps/api/app/services/session.py` |
| I | 23, 24 | Live simulation, controls | `apps/web/src/features/simulation/**` |
| I | 25 | Conversation and transcript | `TranscriptTurn`; `apps/web/src/features/simulation/components/ConversationPanel` |
| I | 26–28 | Evaluation model, evidence, calibration | `apps/api/app/agents/evaluator.py`, `app/services/evaluation.py`, `shared-types` (`SkillScore`, `EvaluationEvidence`) |
| I | 29 | Session completion | `apps/api/app/services/session.py`, `app/workers/` (`evaluation` queue) |
| I | 30, 31 | Replay, persona-state timeline | `apps/web/src/app/(app)/simulations/[sessionId]/review/` |
| I | 32 | Compliance report | `apps/api/app/agents/compliance.py`, `ComplianceFinding` |
| I | 33 | Closed-loop adaptive learning | `apps/api/app/services/report.py`, `Recommendation` |
| I | 34, 35 | Personal growth, team analytics | `apps/web/src/app/(app)/performance/`, `.../reports/team/`, `apps/api/.../reports.py` |
| I | 36 | Training assignment | `apps/api/app/api/v1/routers/assignments.py`, `apps/web/src/app/(app)/training/` |
| I | 37 | Notification centre | `apps/web/src/components/notifications/` |
| I | 38 | Content approval workflow | `ContentStatus` state machine; `apps/api/app/services/**` |
| I | 39 | Knowledge access control | `KnowledgeAcl`; `apps/api/app/core/deps.py` |
| I | 40 | Security controls | `apps/api/app/core/security.py`, `app/services/safety.py` |
| I | 41 | External security audit positioning | `.github/workflows/security.yml`, `apps/web/src/app/(app)/security/findings/`, [ROADMAP Phase 3](ROADMAP.md) |
| I | 42 | Audit log | `AuditEvent`; `apps/api/app/api/v1/routers/audit.py` |
| I | 43 | Integrations | `apps/api/app/api/v1/routers/integrations.py`, `apps/web/src/app/(app)/integrations/` |
| I | 44 | Model / AI runtime settings | `apps/api/.../runtime.py`, `apps/web/src/app/(app)/settings/{models,runtime}/`, `packages/ai-runtime` |
| I | 45, 46 | B2C mode, billing / quota | not built — [ROADMAP Phase 3](ROADMAP.md) |
| I | 47 | Report types | `apps/web/src/app/(app)/reports/**` |
| I | 48 | Search / command palette | `apps/web/src/components/command-palette/` |
| I | 49 | Non-functional requirements | this document, §9 |
| I | 50 | Accessibility / localisation | `packages/ui/**`, `apps/web/src/app/**` |
| I | 51, 52 | Browser capability strategy, WebGPU mapping | `packages/ai-runtime/**` |
| I | 53 | Data model | `packages/shared-types/src/entities.ts`, `apps/api/app/domain/**`, `app/db/models` |
| I | 54 | TrainingSession, version pinning | `TrainingSession`; [ADR-0008](adr/0008-version-pinned-sessions.md) |
| I | 55 | Streaming event schema | `packages/shared-types/src/events.ts` ↔ `apps/api/app/domain/events.py`, guarded by `infra/scripts/check-contracts.sh` |
| I | 56 | API surface | `apps/api/app/api/v1/routers/**` |
| I | 57, 58 | Navigation, page list | `apps/web/src/app/**` |
| I | 59 | Core demo scenario | `infra/scripts/seed.py` |
| I | 60 | Feature-completeness acceptance matrix | [ROADMAP](ROADMAP.md), checklist |
| I | 61 | Core product value | this document, §1 |
| II | 0–4 | Design decisions, reference language, dot matrix, glass, colour tokens | `packages/design-tokens/src/{tokens.css,aurora.css,tailwind-preset.ts}` |
| II | 5–47 | Component-level visual spec | `packages/ui/**`, `apps/web/src/components/**` |
| II | 48 | Frontend technical decisions | [ADR-0003](adr/0003-custom-design-system-over-shadcn-theme.md), [ADR-0007](adr/0007-zustand-and-tanstack-query.md) |
| II | 49 | Realtime architecture | this document, §3 |
| II | 50 | Audio architecture | `apps/web/src/features/simulation/hooks/useVoiceSession.ts` |
| II | 51–62 | WebGPU strategy, tasks, worker, lifecycle, cache, fallback | `packages/ai-runtime/**`; [ADR-0004](adr/0004-webgpu-as-acceleration-layer.md) |
| II | 63 | Backend architecture | `apps/api/app/{main.py,services}/**` |
| II | 64 | Backend stack | `infra/docker-compose.yml`; [ADR-0005](adr/0005-qdrant-as-production-vector-store.md), [ADR-0006](adr/0006-fastapi-alongside-nextjs.md) |
| II | 65 | RAG pipeline | `apps/api/app/rag/**`; this document, §5 |
| II | 66, 67 | Multi-agent backend, customer agent state | `apps/api/app/agents/**` |
| II | 68 | Streaming events | `apps/api/app/ws/**` |
| II | 69 | API direction | `apps/api/app/api/v1/routers/**` |
| II | 70, 71 | OpenAI, ElevenLabs integration | `apps/api/app/services/**`; this document, §8.3 |
| II | 72 | AMD AUP | deployment target; `apps/api/app/rag/embedder.py` provider switch |
| II | 73 | Security | `apps/web/next.config.mjs`, `infra/docker/nginx.conf`, `apps/api/app/core/security.py` |
| II | 74 | Data isolation | `apps/api/app/core/context.py`, `app/rag/vectorstore.py`; this document, §8.1 |
| II | 75–86 | Web capabilities, PWA, shortcuts, palette, search, notification, toast, modal, scrollbar, icons, sparkle | `apps/web/src/components/**`, `packages/ui/**` |
| II | 87 | Visual acceptance criteria | [ROADMAP](ROADMAP.md), checklist |
| II | 88 | Minimum page list | `apps/web/src/app/**` |
| II | 89, 90 | UI generation prompts | reference material only; not code |
| II | 91 | Component tree | `apps/web/src/features/simulation/components/**` |
| II | 92 | State machines | `packages/shared-types/src/state-machines.ts` |
| II | 93 | Runtime status UI | `apps/web/src/app/(app)/settings/runtime/`, runtime pill in `packages/ui` |
| II | 94 | Error handling | `apps/api/app/core/errors.py`, `apps/web/src/app/**/error.tsx` |
| II | 95 | Performance targets | this document, §9 |
| II | 96 | Bundle strategy | `apps/web/next.config.mjs`, `packages/ai-runtime` dynamic imports, CI bundle report |
| II | 97 | WebGPU security / privacy UX | `RuntimePolicy`; `apps/web/src/app/(app)/settings/runtime/` |
| II | 98 | Dark-mode matching | `packages/design-tokens/src/tokens.css` |
| II | 99 | Forbidden practices | [`CONTRIBUTING.md`](../CONTRIBUTING.md), PR template |
| II | 100 | Final acceptance definition | [ROADMAP](ROADMAP.md), checklist |
| II | 101, 102 | One-line summaries | this document, §1 |

> Paths above describe the layout that `docs/PROJECT_STRUCTURE.md` sanctions.
> Several of them are not populated yet — see [`docs/ROADMAP.md`](ROADMAP.md)
> for what exists today. A path listed here is where the code **belongs**, which
> is the question this table is meant to answer.
