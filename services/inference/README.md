# AI Coach — private inference service

Embedding and cross-encoder reranking on **open weights**, served from inside the
private environment (spec §72). It is the server half of the split described in
[`docs/model.md`](../../docs/model.md): `apps/api` decides *which* model to use,
this service runs it.

It serves ONNX graphs through `onnxruntime` — CPU by default, CUDA or ROCm via
the `gpu` / `rocm` extras. Weights are **mounted**, never baked into the image
and never committed, and every file is sha256-verified against
`<MODEL_DIR>/manifest.json` before it is loaded.

## What this service must never do

- **Serve an API model.** There are no `text-embedding-3-*` weights to host.
  Selecting a hosted embedder is `apps/api`'s decision under an explicit
  enterprise policy (§2.1) and never routes through here.
- **Log request content.** It sees every sentence of every knowledge base. See
  `app/core/logging.py`: a typed emit surface with no key that can hold text,
  plus a redaction processor on every event from every library (§49.5).
- **Face a browser.** It is internal. `CORS_ALLOW_ORIGINS` is empty by default
  and a non-empty value is a sign the topology went wrong.
- **Load an unverified file.** A tampered `model.onnx` produces plausible-looking
  vectors from the wrong weights, which Qdrant accepts silently and which surface
  weeks later as inexplicably degraded retrieval.

## Running it

```bash
pip install -e '.[dev]'          # add [gpu] or [rocm] for an accelerator
uvicorn app.main:app --port 8100
```

The port opens immediately and models load in the background, so `/healthz` and
`/metrics` answer even with an empty model directory. `/readyz` is the endpoint
that tells the truth about whether this pod can serve traffic.

Configuration is environment-driven with the `INFERENCE_` prefix
(`INFERENCE_DEVICE=rocm`, `INFERENCE_MAX_BATCH_SIZE=16`, …); every setting is
documented in `app/core/config.py`.

## Endpoints

Every route below is mounted twice — under `/v1` and at the root — because
`apps/api` configures its embedder with a `.../v1` base URL and its reranker with
a bare one. Only the `/v1` copy appears in the OpenAPI document.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/embeddings` | OpenAI-compatible embedding: `{"model", "input"}` → `{"data": [{"index", "embedding"}], "model", "dimension", "usage"}`. **Applies no instruction prefix** — the caller owns it on this route |
| `POST` | `/v1/embed` | Native batch embedding: explicit `kind` (`query`/`passage`/`raw`), `normalize`, `max_length`, `batch_size`; returns vectors in input order plus per-item token counts and timings |
| `POST` | `/v1/embed/query` | One text, one vector; query-side prefix by default |
| `POST` | `/v1/rerank` | TEI/Infinity contract: `{"query", "texts"}` → `{"results": [{"index", "score", "relevance_score"}], "scores", "activation"}`, sorted by descending score. `documents` / `top_n` accepted as aliases |
| `GET` | `/v1/models` | Installed models with resolved revision, quantisation variant and per-file sha256 — the audit surface |
| `GET` | `/v1/models/{id}` | One model; aliases resolve to the canonical entry |
| `GET` | `/healthz` | Liveness. Process state only; never touches a model |
| `GET` | `/readyz` | Readiness: per-model load state, selected device, warmup status. 503 until every preloaded model is resident and warm |
| `GET` | `/metrics` | Prometheus exposition from this service's private registry |

Errors are always a problem-shaped body with a stable `code`
(`model_not_allowed`, `payload_too_large`, `queue_timeout`, …), byte-compatible
with `apps/api/app/core/errors.py`. `detail` is caller-safe text only: no file
paths, no runtime strings, no input.

### Ordering is a contract

The vector at index *i* is the embedding of the input at index *i*, and every
rerank result carries the `index` of the document in the caller's list. Callers
write these against chunk ids by position, so a reordering would mis-attribute
every chunk in the batch. Dynamic batching groups inputs by token length
internally and scatters results back by original index;
`tests/test_batch_planning.py` and `tests/test_routes_embed.py` hold that line.

## Limits

`max_texts_per_request`, `max_input_chars` and `max_request_bytes` are checked
**before** a model is loaded, so an oversized request gets a 413 that names the
limit rather than a timeout. A `batch_size` above `max_batch_size` is a 422, not
a silent clamp: the caller has made a sizing assumption that is wrong.

## Tests

```bash
pytest
```

No network, no weights, no `onnxruntime`, no `tokenizers`. The session and
tokenizer ports are faked (`tests/fakes.py`), and
`tests/test_no_heavy_deps.py` asserts that importing the app and serving
`/healthz` pulls in none of the heavy runtimes — that is a deployment property,
not a tidiness rule: the ROCm build of `onnxruntime` is not on PyPI at all.
