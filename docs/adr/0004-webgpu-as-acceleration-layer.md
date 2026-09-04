# ADR-0004 — WebGPU is an acceleration layer, with WASM and server fallbacks, and the server stays authoritative

- **Status:** accepted
- **Date:** initial architecture pass
- **Spec:** Part II §51 (architecture decision), §52–§55 (what may run locally), §56 (visual layer), §57 (runtime abstraction), §58 (worker), §59 (capability object), §60 (model lifecycle), §61 (cache), §62 (fallback), §96 (bundle), §97 (privacy UX), §99 (forbidden), §101; Part I §51–§52

## Context

Client-side GPU inference is one of the platform's headline technical claims
(Part II §101), and it is genuinely useful: a query embedded locally never
leaves the browser, and intent classification at the keystroke gives the
orchestrator a head start.

It is also the easiest thing in this system to get badly wrong. The spec says so
before it says anything else about it — Part II §51:

> WebGPU must be designed as an **acceleration layer**, not as the product's
> single dependency.
>
> Because browser and device support differ, and enterprise environments may be
> locked to older browsers, **core functionality must not stop when WebGPU is
> unavailable.**

Part II §99 lists "treating WebGPU as the only backend the browser must support"
as a forbidden practice, and §56 adds a second warning: do not force WebGPU for
visual effects — the UI must be fully presentable in CSS alone. **Do not require
WebGPU for the glass effect.**

There is a further, subtler constraint. A trainee's browser is, with respect to
their own assessment, an adversarial environment. If a client could compute its
own score, its own rerank order or its own safety verdict and have the server
accept them, the entire evaluation and compliance layer — Part I §26–§28 and
§32, the reason an enterprise buys this — would be worthless.

## Decision

### 1. Three tiers, automatic degradation

```text
capability detection (in a Worker)
            │
   navigator.gpu available?
      ┌─────┴─────┐
     yes          no
      │            │
  WebGPU EP    WASM SIMD
      │            │
      └─ fallback ─┤     device lost · memory exceeded
                   │     unsupported operator · timeout
                   ▼
             Server backend
```

Implemented as `packages/ai-runtime` with one interface and three
implementations (`webgpu-backend.ts`, `wasm-backend.ts`,
`server-backend.ts`) behind a `fallback.ts` chain. The consumer asks for a task;
it does not choose a backend. Part II §62 adds a hard UI requirement: **the UI
must not crash on a fallback.**

### 2. Inference never touches the main thread

Part II §58 and Part I §49.1. All inference runs in a Web Worker
(`worker/inference.worker.ts`, `worker-host.ts`, `worker-backend.ts`), including
capability detection. The 60fps animation target (Part II §95) is not survivable
otherwise.

### 3. The server is always authoritative for safety, reranking and scoring

This is the load-bearing rule, and it is not negotiable:

| Task | May run locally | Server position |
|---|---|---|
| Query embedding | yes — Retrieval Playground, local semantic search (§52.1) | Indexing embeddings are server-only. A locally-embedded query is for exploration; what a session retrieves is decided server-side |
| Intent classification | yes (§53) | Sent as `client.intent_hint` — an *advisory input* to the orchestrator, which classifies independently |
| Reranking | yes, top-20 → top-5, when performance allows (§54) | §54 states plainly that formal financial/insurance environments still require **server-authoritative scoring**. The client's ordering is a UI nicety |
| Safety pre-check | yes — PII patterns, restricted keywords, injection heuristics, phrase masking (§55) | §55 states plainly: **the server Safety Agent remains the final authoritative layer** |
| Visual effects | optional (§56) | — but the UI must be complete in CSS alone |

Operationally: no score, rerank order or safety verdict arriving from a browser
is persisted, and none can create, suppress or downgrade a `ComplianceFinding`.
`client.intent_hint` exists in the `ClientCommand` union precisely so that the
one thing a client *is* allowed to contribute is explicitly typed as a hint.

### 4. Explicit lifecycle, with GPU release

Part II §60: `detect → select backend → download manifest → cache model →
warmup → inference → idle timeout → release GPU resources`. The idle release is
not an optimisation — holding a GPU adapter all day on shared enterprise
hardware is antisocial and gets the feature disabled by IT.

### 5. Out of the initial bundle

Part II §96: dynamically imported, loaded only when local AI is enabled,
preloaded on the persona and simulation pages. CI prints an advisory bundle
report against this.

### 6. Opt-in, with an enterprise override

Part II §61 and §97: `RuntimePolicy` carries `webgpu: 'auto' | 'on' | 'off'`,
`allow_local_model_cache`, `allow_sensitive_data_cache` and `clear_on_logout`.
First use asks the user (§97's prompt), and an admin can force the mode for the
tenant. `ALLOW_SENSITIVE_DATA_CACHE` defaults to false and the API refuses to
boot in production with it enabled.

### 7. Cross-origin isolation, deliberately

Multi-threaded WASM needs `SharedArrayBuffer`, which needs the document to be
cross-origin isolated, which needs `COOP: same-origin` + `COEP: require-corp`.
The edge sets both. Note the inversion this creates: the headers matter *most*
for the WASM tier, i.e. on exactly the machines that have no GPU path. The cost
and the per-route opt-outs are documented in
[`infra/docker/nginx.conf`](../../infra/docker/nginx.conf) and
[ARCHITECTURE §7](../ARCHITECTURE.md#7-cross-origin-isolation-why-the-edge-sets-coop--coep).

## Consequences

### Good

- **Every enterprise environment works.** The unconditional requirement of
  §51/§101, satisfied structurally rather than by testing.
- **The evaluation layer is trustworthy.** Because no client value is ever
  authoritative, a modified client can degrade its own experience and nothing
  else.
- **Genuine privacy win where it is real.** Playground queries embedded locally
  do not leave the device. This is a true claim, and it is scoped narrowly
  enough to stay true.
- **One interface for consumers.** `apps/web` asks for an embedding; it does not
  branch on backend. Adding a fourth tier later changes one package.
- **Honest UI.** The runtime badge reports which tier is actually running
  (Part II §93), and `runtime.fallback` is a streaming event, so a degradation
  mid-session is visible rather than silent.

### Bad, and what we do about it

- **Duplicated logic.** Intent classification and safety pre-check exist twice —
  once in TypeScript for the client, once in Python on the server. Accepted
  deliberately: the duplication *is* the safety property. The client version can
  be less accurate without consequence, precisely because it is not trusted.
- **The most complex package in the repository.** Three backends, worker
  protocol, model cache, manifest handling, fallback state machine, telemetry.
  Mitigated by keeping it dependency-free of UI and by a single narrow public
  interface.
- **Model distribution is unsolved.** `LocalModelManifest` exists; real
  manifests with URLs, byte sizes and sha256 digests do not. Until they land,
  the WebGPU and WASM tiers have nothing to load and the chain falls to the
  server backend — which is the correct behaviour, and it is why the fallback
  had to be built first. Tracked in [ROADMAP Phase 1](../ROADMAP.md).
- **COEP breaks third-party subresources.** A real and ongoing constraint on
  every future integration that wants to embed an iframe or a CDN asset. The
  per-route opt-out recipes are written down so the answer exists before the
  question is asked.
- **Three code paths to test.** Any local-inference change needs verifying with
  WebGPU on, WebGPU forced off (WASM), and local inference disabled entirely
  (server). This is in the PR checklist.
- **Telemetry has to stay content-free.** Part I §49.5 permits WebGPU backend
  telemetry but forbids collecting sensitive content. `RuntimeTelemetry` carries
  backend, model id, load time, inference time, worker liveness and fallback
  reason — and deliberately nothing about what was inferred.

### Rejected alternatives

- **WebGPU-only, with the feature simply unavailable elsewhere** — forbidden by
  §51 and §99.
- **Server-only inference, no client tier** — would work, and would drop a
  capability the spec explicitly requires (§52–§55, §101) along with the real
  privacy benefit for playground queries.
- **Trusting the client's rerank or safety result to save a server round trip** —
  rejected outright. §54 and §55 each state the server's authority explicitly,
  and the threat model makes it indefensible regardless.
- **WebGPU for the glass and aurora effects** — rejected by §56 and §99. The
  visual layer is CSS; WebGPU visuals are optional enhancement at most.
