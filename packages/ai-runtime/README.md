# `@ai-coach/ai-runtime`

Client-side AI runtime: **capability detection → WebGPU EP → WASM SIMD → Server**.

> Spec references throughout are to `docs/spec/AI_Coach_Spec_v3.md`.

---

## 1. The governing decision (§51)

**WebGPU is an acceleration layer, not a dependency.**

```text
                    Capability Detection
                            │
                ┌───────────┴───────────┐
                │ navigator.gpu usable? │
                └───────────┬───────────┘
                   yes      │      no
                            ▼
                       WebGPU EP
                            │
              ── fallback ──┼──────────────→  WASM SIMD (+ threads if COI)
                            │                      │
                            └──── fallback ────────┴────→  Server inference
```

Why, concretely:

- Browser and device support for WebGPU differs wildly, and **enterprise fleets are
  frequently pinned to an old browser build**. Some of our users cannot get WebGPU
  even if they want it.
- Therefore **no core feature may stop working when WebGPU is unavailable** (§51).
  A feature that only works with GPU acceleration is a feature that does not work.
- So the chain always terminates at the **server tier**, which needs no model
  download, no worker, no SIMD, no GPU and no storage. It is the floor, and it is
  never allowed to be absent — `FallbackController` re-adds `'server'` to any chain
  that does not end in it.
- §99 spells out the anti-goal: *"把 WebGPU 當作 browser 必須支援的唯一 backend"* —
  do not treat WebGPU as the only backend the browser must support.

The API shape enforces this. Every task method resolves with a `TaskOutcome`
discriminated union instead of throwing:

```ts
type TaskOutcome<T> =
  | { ok: true;  value: T;  backend; elapsed_ms; degraded; fallback_reason?; attempts }
  | { ok: false; error: { reason; message }; backend; elapsed_ms; degraded; attempts };
```

There is no configuration in which a caller's promise hangs, rejects unexpectedly,
or throws inside a React render (§62: *UI 不可 crash*).

---

## 2. The state machine (§92)

```text
unknown → detecting → supported → loading → ready ⇄ degraded → fallback
                                                ↑                  │
                                                └── detect ────────┘
```

`RuntimeState` comes from `@ai-coach/shared-types` — **the UI may only display
these states**. Events and the transition table live in `capability.ts`
(`nextRuntimeState`, `createRuntimeStateMachine`); unknown transitions are ignored
rather than thrown.

| state       | meaning                                                              |
|-------------|----------------------------------------------------------------------|
| `unknown`   | nothing probed yet (also the SSR value)                              |
| `detecting` | probing adapter / SIMD / worker / memory                             |
| `supported` | a local tier is possible; nothing loaded                             |
| `loading`   | downloading / creating a session / warming up                        |
| `ready`     | a local tier is serving requests                                     |
| `degraded`  | running, but on a lower tier than the one selected                   |
| `fallback`  | on the server floor — everything still works                         |

`release()` (idle timeout) moves `ready → supported`: the device is still capable,
just not currently holding the GPU. A re-detect is the only way out of `fallback`,
which is what the admin "Retry local acceleration" action triggers.

---

## 3. Advisory vs authoritative

This is the most important thing to get right when building on this package.

| task                  | local tiers                          | server tier      | who decides |
|-----------------------|--------------------------------------|------------------|-------------|
| `embedding` (§52.1)   | `advisory`, `local: true`            | `authoritative`  | the server owns the vector space the index was built with |
| `intent_classification` (§53) | `advisory` **hint**          | `authoritative`  | the server orchestrator |
| `reranking` (§54)     | `advisory`                           | `authoritative`  | the server reranker; **finance / insurance must use it** |
| `safety_precheck` (§55) | `advisory` first pass              | `advisory` too   | the server **Safety Agent** |

Rules that follow from the table:

- **Embeddings.** A local vector is only comparable to other local vectors. Never
  write one into the index; never score a local query vector against server-side
  document vectors. Check `EmbedResult.local` and `model_id` before mixing.
- **Intent.** `toOrchestratorHint()` produces the payload to attach to the turn;
  it returns `null` below `INTENT_MIN_CONFIDENCE` because a bad hint can anchor the
  orchestrator. The hint may prime the Coach card or pre-fetch a knowledge panel.
  It may **not** drive a persona state transition, be recorded as the turn's
  classification, or skip sending the turn to the server.
- **Reranking.** §54: *正式金融/保險環境仍建議 server authoritative scoring.* Treat
  that as a requirement — regulated workspaces should call `rerankStrict()`, which
  forces the server tier. Every hit carries `previous_rank` so the pre-rerank order
  is always recoverable for an audit (`originalOrder()`). No reranker variant is
  registered for `memoryClass: 'low'`, so those devices never rerank locally at all.
- **Safety.** §55: *Server Safety Agent 仍是最終 authoritative layer.* `pass: true`
  means "nothing obvious found", **not** "safe". Never gate a compliance record on
  it. It has no model and no context — it is a regex and heuristic pass.

---

## 4. Privacy: what leaves the browser (§97)

**Stays in the browser, always:**

- Every input to `safetyPrecheck()` — no model, no network, no worker hop.
- Retrieval Playground test queries **when a local tier answers** (§52.1: *部分測試
  query 不必送出瀏覽器*). `EmbedResult.local === true` is the flag to check before
  telling the user this.
- The derived-embedding memo, which is in-memory only, bounded, and gated behind
  `allow_sensitive_data_cache`.
- Model weights and tokenizer files in Cache Storage.

**Leaves the browser:**

- Any request served by the **server tier** — which is every request when local
  acceleration is off, unavailable, or has fallen back. This is not a leak, it is
  the floor working, but a UI that promises "this stays on your device" must read
  `local` rather than assume.
- **Operational telemetry only** (§49.5, §93): backend, model id, load ms, last
  inference ms, worker status, fallback reason.

**Never leaves the browser, and cannot:**

Prompt, transcript, query, document or any other user content in telemetry. This is
enforced by the type system, not by convention — `TelemetryPatch` maps every
content-shaped key (`prompt`, `text`, `transcript`, `query`, `messages`, `vectors`,
…) to `never`, so adding one is a compile error. `assertContentFree()` is a runtime
backstop for callers that reach for `as any`. See the header of `telemetry.ts`.

**First-run consent.** `enableLocal` defaults to `false`: the runtime works through
the server from the first call and downloads nothing until the user accepts the
§97 prompt.

```text
Local AI acceleration

Some supported AI tasks can run locally on this device.
Enterprise data policies still apply.

[Enable] [Not now]
```

`Enable` → `runtime.setLocalEnabled(true)`. An admin forcing `on` may pass
`enableLocal: true` at construction.

---

## 5. Enterprise switches (§61, §97)

`RuntimePolicy` (from `@ai-coach/shared-types`) is honoured end to end.

| switch | effect |
|---|---|
| `webgpu: 'off'` | Forces the **server** tier. No adapter is requested, no device is created, no weights are downloaded, nothing is cached. Applied immediately on `setPolicy` — loaded sessions are released and the chain collapses to `['server']`. |
| `webgpu: 'on'` | A *preference*, not a guarantee. If the device cannot do WebGPU the chain still steps down (§51). |
| `webgpu: 'auto'` | Default. |
| `allow_local_model_cache: false` | **Disables the local model cache.** Weights stream straight into the worker and live only in that session's memory. Turning it off mid-session deletes what was already cached. |
| `allow_sensitive_data_cache: false` | **Disables the sensitive-data cache** — the in-memory memo of vectors derived from user text. Default is `false`. |
| `clear_on_logout: true` | `dispose()` deletes the Cache Storage bucket and the metadata database. Default `true`. |

A workspace admin may additionally force behaviour for everyone, which overrides
the user-scoped policy value:

```ts
createAiRuntime({ enterpriseOverride: 'off' }) // 'on' | 'off' | 'automatic'
```

Manual controls for Settings > AI Runtime: `clearCache()`, `cacheStats()`,
`release()`, `retryLocal()`.

Model URLs are configuration, never code. The default base is app-relative
(`/models/...`, i.e. self-hosted next to the web app) so an air-gapped or
CDN-blocked deployment works out of the box. `PUBLIC_MODEL_MIRROR` is exported as
an *option* a deployment may opt into — no vendor CDN is hardcoded as the only
source.

---

## 6. Bundle strategy (§96)

> WebGPU / ML package 不要進 initial bundle.

Three layers of laziness, and none of them is optional:

1. **Import the package dynamically.** It is side-effect free, but keep it out of
   the entry chunk anyway:

   ```ts
   const { createAiRuntime } = await import('@ai-coach/ai-runtime');
   ```

2. **ONNX Runtime Web is never statically imported.** The only reference is
   `await import(...)` inside `loadOrt()`, which runs in the worker the first time
   a local tier is used. `src/types/onnxruntime-web.d.ts` declares the narrow
   surface we couple to so `tsc` succeeds without the optional dependency present.

3. **`./worker/inference.worker` is deliberately not re-exported from
   `src/index.ts`.** Re-exporting it would drag the ORT-facing code into whatever
   chunk imports the package index — exactly what §96 forbids. The worker module is
   reached by URL (or by the consumer's own `workerFactory`) and nowhere else.

Preload on the Persona / Simulation page transition, as §96 prescribes:

```ts
await runtime.warmup(['embedding', 'intent_classification']);
```

`warmup()` resolves whatever happens — a failed warmup is a step-down, not an error
the page has to handle.

### Spawning the worker: the tradeoff

The obvious spelling —
`new Worker(new URL('./inference.worker.ts', import.meta.url), { type: 'module' })`
— is correct but couples this package to the consumer's bundler, and this package
ships raw TypeScript (`main` → `src/index.ts`) with no build step of its own. So
there are two supported paths:

- **`workerFactory` (preferred in production).** The app builds the worker with its
  own bundler and hands us a factory. Nothing below applies.
- **`workerModuleUrl` (zero-config default).** We build a three-line ES module at
  runtime, turn it into an object URL, and start a module worker from it; the
  bootstrap does nothing but `import()` the real worker module.

  What it buys: no `next.config.js` changes, and the ML code is fetched only when
  local acceleration is actually used. What it costs, plainly: a `blob:` module has
  an opaque origin, so the worker module needs an **absolute** URL; the CSP must
  allow `worker-src blob:`; and it is one extra round trip.

If neither is available — or spawning throws (CSP, no `Worker`) — the host reports
`worker_unavailable` and the chain drops to the server. **Local inference is never
attempted on the main thread**, because §95 says so.

---

## 7. Performance targets (§95)

| target | how this package holds it |
|---|---|
| `First interaction < 2.5s on target enterprise desktop` | Nothing ML-shaped is in the initial bundle (§96); the server tier answers from the first call with zero download; detection is a single cached probe shared by concurrent callers. |
| `Animation 60fps target` | All model execution is in the worker. Only plain JSON crosses `postMessage`, and model bytes are *transferred* (zero-copy), not copied. |
| `No main-thread AI inference` | Enforced, not intended: `selectBackend()` returns `'server'` when workers are unavailable, so there is no code path that runs a session on the main thread. The only main-thread work is the `safetyPrecheck` regex pass, which is not model execution. |

Additional budgets, all of which trigger a §62 step-down rather than a hang:

- adapter probe: 4 s
- session creation: 45 s
- inference: 12 s (WebGPU) / 25 s (WASM — the CPU tier is legitimately slower)
- server request: 20 s, with at most one bounded retry
- worker boot: 15 s; any worker request: 60 s
- **idle: 120 s → GPU resources released** (§60). Also released on
  `visibilitychange`/`pagehide`: a backgrounded tab has no business holding the GPU.
  Cached weights survive, so the next call re-loads in a fraction of the time.

Retries are bounded everywhere. Each tier gets at most two attempts, a *fatal*
failure (device lost, unsupported operator, memory exceeded) puts the tier in a
5-minute cooldown, and the fallback chain is walked forwards only — the loop runs at
most `chain.length × attempts` times and then returns.

---

## 8. Runtime status UI (§59, §93)

A normal trainee sees **one short string** and nothing else:

```ts
describeBackend({ backend, state }).label
// 'Local AI · GPU accelerated' | 'Local AI ready' | 'AI ready'
// | 'Checking device…' | 'Preparing local AI…'
```

`RUNTIME_LABEL` is the canonical trainee-facing vocabulary; anything not in it does
not belong on a trainee's screen. Engineering detail is assembled **only** for
`audience: 'admin'`, so it cannot leak into a trainee view by accident:

```ts
describeBackend({ backend, state, audience: 'admin', modelId, loadMs, ... }).detail
// 'backend=webgpu · state=ready · ep=webgpu · model=… · load=…ms · infer=…ms · worker=alive'
```

On the server floor the trainee label is simply `AI ready` — §62 requires that a
fallback does not make the UI look broken.

---

## 9. Usage

```ts
const runtime = createAiRuntime({
  apiBaseUrl: '',                       // same-origin
  authHeaders: () => ({ authorization: `Bearer ${token}` }),
  policy: { allow_local_model_cache: true },
  enableLocal: false,                   // §97 consent gate
  modelBaseUrl: '/models',              // self-hosted
  worker: { workerModuleUrl: '/workers/ai-runtime.worker.js' },
  onFallback: (n) => notify(n.message), // 'runtime.fallback'
});

const unsubscribe = runtime.subscribe((snapshot) => setRuntimeState(snapshot));

await runtime.detect();

const result = await runtime.embed(['policy question']);
if (result.ok) {
  use(result.value.vectors, { stayedOnDevice: result.value.local });
} else {
  showQuietNotice(result.error.message);   // never throws
}

const precheck = await runtime.safetyPrecheck(draft);   // cannot fail
if (!precheck.pass) hint(precheck.findings);            // advisory only

await runtime.dispose();                 // honours clear_on_logout
```

`createAiRuntime()` allocates plain objects, registers no listeners and touches no
browser API, so importing and constructing it during Next.js server rendering is
safe. Nothing happens until the first method call, which the app makes from an
effect.

---

## 10. Layout

```text
src/
├── index.ts                    public surface + describeBackend / RUNTIME_LABEL
├── runtime.ts                  createAiRuntime — the façade
├── capability.ts               §59/§92 detection, backend selection, state machine
├── lifecycle.ts                §60 detect→select→download→cache→warmup→idle→release
├── fallback.ts                 §62 controller, notifications, bounded retries
├── cache.ts                    §61/§97 Cache Storage + IndexedDB index, sha256, quota
├── telemetry.ts                §49.5/§93 metrics — content-free by construction
├── manifest.ts                 model registry + memoryClass resolver
├── tokenizer.ts                self-contained WordPiece (keeps transformers.js out)
├── backends/
│   ├── types.ts                InferenceBackend, BackendFailure, FallbackReason
│   ├── ort-session.ts          lazy ORT load, tensors, pooling, error classification
│   ├── ort-backend.ts          shared body of the two local tiers
│   ├── webgpu-backend.ts       tier 1 — WebGPU EP, device-lost / OOM / unsupported-op
│   ├── wasm-backend.ts         tier 2 — WASM EP, SIMD + threads when COI
│   └── server-backend.ts       tier 3 — the always-available floor
├── tasks/
│   ├── embedding.ts            §52.1 advisory
│   ├── intent-classification.ts §53 advisory hint
│   ├── reranking.ts            §54 advisory; server-authoritative for finance
│   └── safety-precheck.ts      §55 advisory first pass; pure JS, always available
├── worker/
│   ├── protocol.ts             typed messages, exhaustiveness, untrusted-input parsing
│   ├── inference.worker.ts     worker entry — sessions and inference live here
│   ├── worker-host.ts          main-thread spawn, correlation, timeouts, restarts
│   └── worker-backend.ts       main-thread InferenceBackend proxy over the worker
└── types/onnxruntime-web.d.ts  narrow ambient decl for the optional lazy dependency
```

`packages/shared-types` is **consumed, never modified**. Browser-side extras that
the cross-language contract deliberately does not carry (`ModelRuntimeHints`,
`DetailedComputeCapability`, `RuntimeTelemetryDetail`) live here as supersets.
