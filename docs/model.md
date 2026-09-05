# Models

Which models AI Coach uses, which of them can be self-hosted in a private environment,
which cannot, and what the browser is allowed to decide.

Spec §2.1 flags a correction that this page is organised around:

> `text-embedding-3-*` 為 OpenAI API embedding model，不是可直接在 AMD AUP 內部署的開源
> 模型。正式文件需將「Local / Private Embedding」與「External API Embedding」分開描述。

So the three tiers are kept strictly apart below: **server-side models** you can deploy,
**API models** you cannot, and the **browser tier**, which is advisory only.

## Contents

- [The three tiers at a glance](#the-three-tiers-at-a-glance)
- [Server-side models (self-hostable)](#server-side-models-self-hostable)
- [API models (hosted, not self-hostable)](#api-models-hosted-not-self-hostable)
- [Browser tier](#browser-tier)
- [The authority rule](#the-authority-rule)
- [Where weights live](#where-weights-live)
- [Air-gapped and private mirrors](#air-gapped-and-private-mirrors)
- [Changing an embedding model](#changing-an-embedding-model)
- [Telemetry](#telemetry)

## The three tiers at a glance

| | Server-side | API | Browser |
|---|---|---|---|
| Runs where | `services/inference/` in the private environment (spec §72) | the provider's cloud | the trainee's device, in a Web Worker |
| Self-hostable in AMD AUP | **yes** | **no** | n/a |
| Authoritative | **yes** | yes, when policy permits its use | **no** — advisory only |
| Data leaves the environment | no | **yes, every call** | no, while a local tier answers |
| Weights in git | no | n/a | no |

## Server-side models (self-hostable)

Spec §72 places local embedding, the reranker, an optional private LLM, the document
parser, the evaluation model and the vector database inside the AMD AUP private
environment. `services/inference/` is the service that serves the ONNX ones.

| Role | Default model | Task | Notes |
|---|---|---|---|
| Embedding | `BAAI/bge-m3` | `embedding` | preloaded and warmed at boot; `/health/ready` stays red until it is up |
| Reranker | `BAAI/bge-reranker-v2-m3` | `rerank` | cross-encoder; single logit → sigmoid calibration |
| Alternate embedding | `intfloat/multilingual-e5-large` | `embedding` | `query: ` / `passage: ` prefixes, mean pooling |
| Private LLM | deployment's choice | — | reached through `LLM_PROVIDER=aup`; not served by `services/inference` |
| Evaluation model | — | `sequence_classification` | the task exists in the registry and is loadable, but **no endpoint serves it yet**, so it cannot be reached by accident |

Prefixes and pooling are **per-model manifest data, not a global flag**, because getting
them wrong does not raise an error — it silently produces a worse embedding space. BGE
wants CLS pooling and an instruction on the query side only; e5 wants mean pooling and the
`query: `/`passage: ` pair. That asymmetry between `embed_query` and `embed_documents` in
`apps/api/app/rag/embedder.py` is a correctness requirement.

Operational shape of the inference service (`services/inference/app/core/config.py`):

| Setting | Default | Meaning |
|---|---|---|
| `MODEL_DIR` | `/srv/models` | weights are **mounted**, never baked into the image |
| `MODEL_MANIFEST_PATH` | `<MODEL_DIR>/manifest.json` | the registry document |
| `VERIFY_SHA256` | `true` | a file whose digest does not match the manifest is **refused**. Turning this off is only ever acceptable on a local checkout |
| `DEVICE` | `cpu` | `pip install .[gpu]` for CUDA, `.[rocm]` for AMD AUP; both provide the same `onnxruntime` import name, so exactly one must be installed |
| `MODEL_MEMORY_BUDGET_MB` | `8192` | eviction accounting; resident memory is estimated at 1.35× the weight bytes because onnxruntime keeps initialisers plus arena scratch |
| `MODEL_IDLE_RELEASE_S` | `900` | idle models are released rather than pinned |
| `SHARED_SECRET` | empty | **required** outside `local` |

There are deliberately **no CORS settings**: no browser ever talks to this service. The
browser runs its own models or goes through `apps/api`. Adding CORS here would be a sign
the topology went wrong.

Why sha256 verification is not optional: a truncated or tampered `model.onnx` produces
*garbage vectors*, which Qdrant accepts silently and which surface weeks later as
inexplicably degraded retrieval. A hard failure at load is the cheap outcome.

> **Current status.** `services/inference/` currently has its config, error, logging,
> metrics, registry, session, pool, preprocessing and postprocessing modules. The HTTP
> endpoints (`/embed`, `/rerank`, `/health/*`) and native service packaging are being
> written. Until it exists, `apps/api` uses `ApiEmbedder`
> (OpenAI) or the deterministic `LexicalReranker` fallback. See [`roadmap.md`](roadmap.md).

## API models (hosted, not self-hostable)

These are hosted services. There are no open weights to deploy, **every call leaves the
private environment**, and using them therefore requires an approved enterprise policy and
a data-residency review (spec §2.1: *Approved Enterprise Policy → OpenAI
text-embedding-3-\* → Vector Database*). They must never be selected as a silent default.

| Provider | Model | Used for | Configured by |
|---|---|---|---|
| OpenAI | `text-embedding-3-small`, `text-embedding-3-large` | document and query embedding | `EMBEDDING_MODEL` (default `text-embedding-3-large`, 3072 dimensions) |
| OpenAI | `gpt-4o` and siblings | the multi-agent turn loop (§19/§66), question generation, evaluation | `LLM_PROVIDER=openai`, `LLM_MODEL` |
| OpenAI | speech models | STT, and TTS when `TTS_PROVIDER=openai` | `TTS_PROVIDER` |
| ElevenLabs | TTS voices | persona voice (§22) | `TTS_PROVIDER=elevenlabs` |

Two hard rules, enforced in code:

1. **No provider key ever reaches the browser** (§56/§70/§71). Every call is browser →
   API → provider. See [`deployment.md`](deployment.md#secrets) for the four places this
   is enforced.
2. **The API embedder is a separate implementation, not a configuration flag.**
   `apps/api/app/rag/embedder.py` has `LocalEmbedder` and `ApiEmbedder` as distinct
   classes precisely so that "which tier embedded this corpus" is answerable from the
   code path, not inferred from an environment variable.

Note the asymmetry that follows: the *default* embedding configuration in `.env.example`
(`text-embedding-3-large`, 3072-d) is the API path. A deployment that must keep data inside
AUP has to change it — the default is not the private option.

## Browser tier

`packages/ai-runtime` resolves a model per local task from
`packages/ai-runtime/src/manifest.ts`, based on the device's memory class (`low`,
`medium`, `high`, classified from `navigator.deviceMemory`, core count and WebGPU buffer
limits). Chain: **WebGPU → WASM SIMD → server** (§51/§62).

### The catalogue

| Task | Model id | Quantisation | Dim | Max seq | Pooling / labels | Memory classes | Download |
|---|---|---|---|---|---|---|---|
| `embedding` | `bge-small-en-v1.5-int8` | `int8-dynamic` | 384 | 512 | CLS, normalised, query prefix only | `low` | ~34.7 MB (`model.onnx` 34.0 MB + `tokenizer.json` 0.711 MB) |
| `embedding` | `multilingual-e5-small-int8` | `int8-dynamic` | 384 | 512 | mean, normalised, `query: `/`passage: ` | `medium`, `high` | ~135.1 MB (118 + 17.1) |
| `embedding` | `multilingual-e5-small-fp16` | `fp16` | 384 | 512 | mean, normalised, `query: `/`passage: ` | `high` | ~252.1 MB (235 + 17.1) |
| `intent_classification` | `intent-minilm-l6-int8` | `int8-dynamic` | — | 256 | sequence classifier over the four §53 labels | `low`, `medium`, `high` | ~23.5 MB (23 + 0.466) |
| `intent_classification` | `intent-minilm-l6-fp32` | `none` | — | 256 | same labels | `high` | ~90.5 MB (90 + 0.466) |
| `reranking` | `ms-marco-minilm-l6-v2-int8` | `int8-dynamic` | — | 320 | cross-encoder, 20 pairs per call | `medium`, `high` | ~23.5 MB (23 + 0.466) |
| `safety_precheck` | **none** | — | — | — | regex and heuristics in plain JS | all | **0** |

Design rules the catalogue follows, from the file header:

1. **Small by default** — every entry is in the 20–250 MB range. A trainee on a
   locked-down enterprise laptop must not be asked to download a gigabyte before the
   Retrieval Playground works.
2. **URLs are configuration, not code** — the default base is app-relative (`/models/…`),
   i.e. self-hosted next to the web app. `PUBLIC_MODEL_MIRROR` is exported as an *option*
   a deployment may opt into; no vendor CDN is hardcoded as the only source.
3. **`safety_precheck` has no model** — the §55 first pass is pattern- and
   heuristic-based, runs in plain JS, and therefore works on every device with zero
   download. `resolveManifest('safety_precheck', …)` returns `null` on purpose.

Resolution picks the **largest** variant the device's class is allowed to run. When no
variant claims a class, the answer is a deliberate `null`, not a gap: no reranker variant
lists `low`, which is how §54's "local reranking only 效能允許時" is enforced — a
low-memory device never reranks locally and the fallback controller uses the
server-authoritative reranker instead.

Multilingual is the product default (the platform is zh-TW first), but the vocabulary is
large, so `int8` is what a mid-range machine gets. `bge-small-en-v1.5` is English-only and
is offered to `low` devices because the alternative there is no local embedding at all.

### Provenance metadata

The publication metadata (digest, license, upstream source, revision, training data) is
**not** in `packages/ai-runtime/src/manifest.ts`. That file records only id, path,
quantisation, dimension, file names and byte sizes, plus runtime hints, and its `sha256`
field is optional and currently unset for every entry. The authoritative place for the rest
is `models/manifest.json`, whose schema
(`services/inference/app/models/registry.py`) carries exactly these fields per entry:

| Field | Meaning |
|---|---|
| `id`, `aliases` | canonical HuggingFace-style id; aliases let the browser tier's short ids resolve to the same weights when a deployment hosts them server-side too |
| `task` | `embedding`, `rerank` or `sequence_classification`; `/embed` and `/rerank` both refuse a mismatch |
| `path`, `model_file`, `tokenizer_file` | where the files sit under `MODEL_DIR` |
| `dimension` | required for an embedding model — the vector store namespaces collections by (model, dimension) and mixing geometries corrupts an index |
| `quantization` | e.g. `int8-dynamic`, `fp16`, `none` |
| `pooling`, `query_prefix`, `passage_prefix`, `score_activation` | per-model correctness data |
| **`license`** | defaults to `unknown`; must be filled in before publication |
| **`source`** | upstream URL the weights came from |
| **`revision`** | upstream revision/commit pinned |
| `files[]` | `{ name, sha256 (64 hex, required), bytes }` |
| `notes` | free text |

> **Current status.** `models/` is empty — no `manifest.json`, no README, no weights — and
> **`scripts/download_models.sh` does not exist yet**, although
> `services/inference/app/models/registry.py` documents it as the fetcher. Consequently:
>
> - no SHA256 digests, licences, upstream sources, revisions or training-dataset records
>   exist in this repository yet for any model, in either tier;
> - the browser tier has nothing to load from `/models/…`, so the WebGPU and WASM tiers
>   fall through to the server backend;
> - `services/inference` would refuse to start with `VERIFY_SHA256=true` and no manifest.
>
> Do not treat the intended upstreams below as recorded provenance. Each row must be
> confirmed against the actual downloaded artefact — its licence text, its model card and
> its digest — before a deployment ships it. This is the one part of this page you must not
> take on trust. Tracked in [`roadmap.md`](roadmap.md).

Intended upstreams for the browser catalogue, to be verified and recorded when the weights
are published:

| Model id | Intended upstream family | Input | Output |
|---|---|---|---|
| `bge-small-en-v1.5-int8` | BAAI BGE small (English), ONNX int8 export | text, ≤ 512 tokens, lowercased, accents stripped | 384-d unit-norm vector |
| `multilingual-e5-small-*` | Microsoft multilingual E5 small, ONNX export | text, ≤ 512 tokens, prefix-tagged | 384-d unit-norm vector |
| `intent-minilm-l6-*` | a MiniLM-L6 sequence classifier fine-tuned on the four §53 intent labels (`objection`, `question`, `off-topic`, `close intent`) | text, ≤ 256 tokens | label + confidence over `INTENT_LABELS` |
| `ms-marco-minilm-l6-v2-int8` | MS MARCO cross-encoder MiniLM-L6-v2, ONNX int8 export | (query, passage) pairs, ≤ 320 tokens, 20 pairs per call | relevance score per pair |

The intent classifier is the one entry with no public upstream: it is a fine-tune on this
platform's own label set, so its training data, licence and digest are ours to publish and
ours to document. It does not exist yet.

## The authority rule

**The browser tier is advisory. The server is authoritative for safety, reranking and
scoring.** Spec §52 ("正式評分與合規在企業情境下仍以 Server authoritative path 為主"), §54
("正式金融/保險環境仍建議 server authoritative scoring") and §55 ("Server Safety Agent 仍是
最終 authoritative layer").

| Task | Local result is | Server result is | Consequence |
|---|---|---|---|
| `embedding` | advisory, `local: true` | authoritative | the server owns the vector space the index was built with. Check `EmbedResult.local` and `model_id` before mixing a local query vector with server-built document vectors |
| `intent_classification` | an advisory **hint** | authoritative | the hint may prime the Coach card or pre-fetch a knowledge panel. It may **not** drive a persona state transition, be recorded as the turn's classification, or skip sending the turn to the server. `toOrchestratorHint()` returns `null` below the confidence floor, because a bad hint anchors the orchestrator |
| `reranking` | advisory | authoritative | regulated workspaces should call `rerankStrict()`, which forces the server tier. Every hit carries `previous_rank`, so the pre-rerank order is always recoverable for an audit |
| `safety_precheck` | advisory first pass | the Safety Agent is authoritative | `pass: true` means "nothing obvious found", **not** "safe". Never gate a compliance record on it — it has no model and no context |

A `runtime.fallback` event on the session socket reports a step-down (`from`, `to`,
`reason`); the UI must show it as a quiet status change and must not crash or block
(§62). The client's own reranked order is accepted only as a hint recorded for telemetry
(`client_agreement`), and `Reranker.rerank()` always recomputes server-side.

### Privacy consequence

While a local tier answers, Retrieval Playground test queries stay in the browser (§52.1)
— `EmbedResult.local === true` is the flag to check before telling a user that. Every
request served by the **server** tier leaves the browser; that is the floor working, not a
leak, but a UI that promises "this stays on your device" must read `local` rather than
assume. First-run consent is required: `enableLocal` defaults to `false`, so the runtime
works through the server from the first call and downloads nothing until the user accepts
the §97 prompt.

## Where weights live

**Not in git.** They are hundreds of megabytes and, for some licences, not
redistributable. `.gitignore` excludes `/data/`, and `models/` is intended to hold the
manifest and a README only — never `.onnx` files.

Intended layout:

```text
models/
├── manifest.json                     the registry document (schema_version 1)
├── README.md                         what belongs here and how to fetch it
├── bge-m3/                           server-side weights, mounted at MODEL_DIR
├── bge-reranker-v2-m3/
├── bge-small-en-v1.5/int8/           browser tier, served at /models/…
├── multilingual-e5-small/{int8,fp16}/
├── intent-minilm-l6/{int8,fp32}/
└── ms-marco-minilm-l6-v2/int8/
```

The browser tier's default base URL is `/models`, app-relative, so the files are served by
the web app from the same origin. nginx already has a `location /models/` block: immutable
one-year caching, `Cross-Origin-Resource-Policy: same-origin` plus the COOP/COEP pair, and
`Range` request pass-through so a partial download resumes instead of restarting a 90 MB
fetch.

Fetching them:

```bash
scripts/download_models.sh
```

> **Current status.** That script does not exist yet — see the note in
> [Provenance metadata](#provenance-metadata). Until it lands, fetch the files by hand
> into the layout above and write `models/manifest.json` with a real sha256 per file
> (`sha256sum`, or `shasum -a 256`).

## Air-gapped and private mirrors

Nothing in the default configuration reaches a vendor CDN, and that is deliberate.

**Browser tier.** Point the registry at your own base, with ordered fallbacks:

```ts
createManifestRegistry({
  baseUrl: 'https://models.internal.example.com/ai-coach',
  mirrors: ['https://models-backup.internal.example.com/ai-coach'],
});
```

`mirrorsFor()` swaps the base prefix for each mirror while keeping the relative path, so a
404 or a blocked request on the primary retries the same file elsewhere. To restrict the
catalogue to enterprise-approved models, replace or extend it:

```ts
createManifestRegistry({ catalogue: { embedding: APPROVED_VARIANTS } });
```

An admin can also force the tier for everyone — `createAiRuntime({ enterpriseOverride:
'off' })` — which collapses the chain to `['server']`: no adapter requested, no device
created, no weights downloaded, nothing cached. See
[`configuration.md`](configuration.md#client-runtime-policy).

**Server tier.** The manifest is data, not code, so an air-gapped deployment swaps the
model set by replacing `manifest.json` and the mounted directory, with no image rebuild.
Set `MODEL_ALLOWLIST` to make "which models can this service load" a deployment decision
that is checked at boot; an empty allowlist means "any entry in the manifest".

## Changing an embedding model

Switching the model or its dimension **invalidates the index**. This is enforced rather
than warned about: `EmbeddingSpec.index_key()` is what the vector store namespaces
collections by, so vectors of different geometry can never mix, and a `KnowledgeBase`
records `embedding_model` while a `DocumentVersion` records `embedding_version`.

1. Decide deliberately — an API model means data leaves the environment (see above), and
   dimension drives Qdrant capacity (`dimension × 4` bytes per vector plus graph overhead;
   see [`deployment.md`](deployment.md#qdrant)).
2. Set `EMBEDDING_MODEL` and `EMBEDDING_DIMENSION` together and restart.
3. Re-embed each affected knowledge base: `POST /api/v1/documents/{document_id}/reprocess`.
4. Expect provider cost when the model is an API model; re-embedding a large corpus is not
   free.
5. Do not delete the old collection until the new one serves correctly — retrieval quality
   is the acceptance test, and a rollback needs the old vectors.

Symptoms of getting this wrong are in
[`troubleshooting.md`](troubleshooting.md#qdrant-dimension-mismatch-after-switching-embedding-models).

## Telemetry

Client inference reports operational fields only, to `POST /api/v1/runtime/telemetry`:
backend, model id, load ms, last inference ms, worker status, fallback reason (§49.5, §93).

No prompt, transcript, query, document or other user content can be included. This is
enforced by the type system, not by convention: `TelemetryPatch` maps every content-shaped
key (`prompt`, `text`, `transcript`, `query`, `messages`, `vectors`, …) to `never`, so
adding one is a compile error, with `assertContentFree()` as a runtime backstop for callers
that reach for `as any`.
