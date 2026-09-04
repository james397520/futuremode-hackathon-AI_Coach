# Deployment

Running AI Coach as a production service: topology, secrets, data stores, migrations,
scaling, observability, updates and a go-live checklist.

Local setup is [`installation.md`](installation.md). Every variable named here is defined
in [`configuration.md`](configuration.md). The reasoning behind the topology is in
[`architecture.md`](architecture.md); what is not yet built is in [`roadmap.md`](roadmap.md).

## Contents

- [What the spec requires](#what-the-spec-requires)
- [Server requirements](#server-requirements)
- [Topology](#topology)
- [Cross-origin isolation](#cross-origin-isolation)
- [TLS and domains](#tls-and-domains)
- [Secrets](#secrets)
- [Data stores: sizing, backup, restore](#data-stores-sizing-backup-restore)
- [Migrations](#migrations)
- [The async worker](#the-async-worker)
- [Scaling](#scaling)
- [Observability](#observability)
- [Data retention and deletion](#data-retention-and-deletion)
- [Zero-downtime update](#zero-downtime-update)
- [Rollback](#rollback)
- [Go-live checklist](#go-live-checklist)

## What the spec requires

Spec §5.1 ("生產級端到端架構") lists the properties a deployment must have: cloud-native
services, a stateless API where practical, a realtime WebSocket/WebRTC channel, async
document processing on a queue and workers, a Redis cache, a horizontal scaling strategy
for the vector database, object storage, database backup, rate limiting, retry and circuit
breaking, observability, multi-tenant isolation, and graceful degradation. Each section
below maps to one or more of those.

> **Current status.** This document describes the deployment the repository's artefacts
> support today: `docker-compose.yml` (profiles `app` and `proxy`), the three Dockerfiles
> in `infra/docker/`, and `infra/nginx/nginx.conf`. `infra/kubernetes/` is an empty
> placeholder — there is no Helm chart or manifest set yet. Anything below marked
> *Current status* is not yet implemented; see [`roadmap.md`](roadmap.md).

## Server requirements

A single-node deployment that serves a pilot cohort:

| Component | vCPU | RAM | Disk | Notes |
|---|---|---|---|---|
| nginx (`proxy`) | 1 | 512 MB | 2 GB | TLS termination, WS upgrade, header policy |
| Next.js (`web`) | 1–2 | 1 GB | 2 GB | standalone server; no build tooling in the runtime image |
| API (`api`) | 2–4 | 2 GB | 2 GB | `UVICORN_WORKERS` defaults to 2 |
| Worker (`worker`) | 2–4 | 4 GB | 5 GB | parsing and OCR are the memory-hungry stages |
| PostgreSQL 16 | 2 | 4 GB | 50 GB + growth | transcripts and audit dominate growth |
| Redis 7 | 1 | 1 GB | 2 GB | `maxmemory 512mb`, `maxmemory-policy noeviction` |
| Qdrant v1.12.x | 2 | 4 GB + vectors | 50 GB + growth | see sizing below |
| Object storage | — | — | 200 GB + growth | S3 or MinIO |

`redis` is configured with `--maxmemory-policy noeviction` on purpose: silently evicting a
queued Celery payload would drop a document mid-pipeline, so the write fails loudly instead.
Do not "fix" this by switching to an LRU policy.

Private model serving (embedding, reranker, optional private LLM) is a separate tier and is
sized in [`model.md`](model.md#server-side-models-self-hostable).

## Topology

```text
browser
  │  HTTPS / WSS
  ▼
nginx  (infra/nginx/nginx.conf, compose profile "proxy")
  ├── /_next/static/   → web:3000     immutable, 1-year cache
  ├── /models/         → web:3000     model artefacts, range requests, immutable
  ├── /api/v1/auth/(login|refresh|password) → api:8000   5 r/m per IP
  ├── /api/            → api:8000     20 r/s burst 40, no buffering, no-store
  ├── /ws              → api:8000     upgrade, 3600s read timeout, 8 conns per IP
  └── /                → web:3000     the app
        │
      api:8000 ──► postgres:5432   relational source of truth
               ──► redis:6379      cache, rate limit, Celery broker, WS pub/sub
               ──► qdrant:6333     vectors (tenant_id / workspace_id / knowledge_base_id)
               ──► minio:9000      documents, report PDFs, session audio
               ──► provider APIs   OpenAI, ElevenLabs  (server-side only)
      worker  ──► the same four, plus the provider APIs
```

Start it:

```bash
docker compose --env-file .env --profile app --profile proxy up -d --build
```

### WebSocket upgrade

The session socket is the primary transport for a live simulation (spec §55/§68). nginx
carries the upgrade with the canonical map:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

and, in the socket location, `proxy_http_version 1.1`, `proxy_set_header Upgrade
$http_upgrade`, `proxy_set_header Connection $connection_upgrade`, `proxy_read_timeout
3600s` and `proxy_buffering off`. The long read timeout exists because a trainee can sit
silent while thinking; the API heartbeats well inside that window. Buffering must stay off
or partial transcript never reaches the UI in time (spec §95).

> **Current status.** `infra/nginx/nginx.conf` puts those directives in `location /ws`,
> but the API mounts the socket at `/api/v1/sessions/{session_id}/ws`
> (`apps/api/app/api/v1/routers/sessions.py`), which matches `location /api/` — and that
> block sets neither `proxy_http_version 1.1` nor the `Upgrade`/`Connection` headers. Behind
> this proxy the handshake therefore fails with `400`/`426` and the client falls back to
> `POST /api/v1/sessions/{id}/message`. Either add a
> `location ~ ^/api/v1/sessions/[^/]+/ws$` block with the upgrade directives, or move the
> socket to `/ws`. Until then, do not conclude from a working `/ws` health probe that the
> live socket works — verify with a real handshake (see
> [`troubleshooting.md`](troubleshooting.md#the-session-websocket-drops-immediately-behind-nginx)).

### Voice media

nginx proxies signalling only. WebRTC media does not traverse an HTTP proxy, so a voice
deployment needs STUN/TURN alongside.

> **Current status.** No STUN/TURN service is defined in this repository. Voice is a
> Phase 1 item in [`roadmap.md`](roadmap.md).

## Cross-origin isolation

The WASM inference tier uses `SharedArrayBuffer`, which browsers only expose to a
cross-origin isolated document. That requires **both** headers on the HTML response:

```text
Cross-Origin-Opener-Policy:   same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`infra/nginx/nginx.conf` sets both at server level and re-states them in every location
that sets any header of its own — nginx's `add_header` does not inherit into a location
that declares one, which is a rule, not a typo. `apps/web/next.config.mjs` also sets COOP
(plus the CSP that allows `wasm-unsafe-eval` and `blob:` workers), so the policy holds even
without the proxy.

`require-corp` makes the browser refuse every cross-origin subresource that does not opt in
with `Cross-Origin-Resource-Policy: cross-origin` or CORS. That is the intended trade: it is
also why third-party embeds break under it.

### Opting a route out

Give that route its own `location` block and re-state a weaker pair. nginx will not inherit
the strict one:

```nginx
location /app/integrations/oauth/ {
    add_header Cross-Origin-Embedder-Policy "unsafe-none" always;
    add_header Cross-Origin-Opener-Policy   "same-origin-allow-popups" always;
    proxy_pass http://web_upstream;
}
```

`same-origin-allow-popups` is the specific COOP value an OAuth popup flow needs;
`credentialless` is the middle option when you want isolation but cannot get CORP headers
out of the embedded origin. A route that opts out loses `SharedArrayBuffer`, so the local
WASM tier steps down to the server tier on that page — which is designed to be invisible
to the user (spec §62). The commented example in `infra/nginx/nginx.conf` is the reference.

## TLS and domains

Single origin is the supported shape: the web app and the API share a hostname, so the
session cookie is first-party and `SameSite=Lax` works without a cookie domain.

```text
https://coach.example.com/            → web
https://coach.example.com/api/v1/...  → api
wss://coach.example.com/...           → api
```

- Port 80 serves only `/healthz` and `/.well-known/acme-challenge/`, and 301s everything
  else to HTTPS.
- Certificates are read from `/etc/nginx/certs/fullchain.pem` and `privkey.pem`, mounted
  from `infra/certs/` (git-ignored). Renewal is external — drop new files and reload.
- TLS 1.2/1.3 only, session tickets off, OCSP stapling on, HSTS `max-age=63072000;
  includeSubDomains; preload`. Do not enable preload until every subdomain is HTTPS.
- If you must split hosts, set `CORS_ALLOW_ORIGINS` to the exact web origin (`*` is
  rejected at boot) and `COOKIE_DOMAIN` to the shared parent, and expect the
  `SameSite=Strict` refresh cookie to need review.

Reload nginx after a certificate change:

```bash
docker compose --env-file .env exec proxy nginx -s reload
```

An `upstream` block with static names resolves once at startup, so a `docker compose
restart api` also needs an nginx reload to pick up the new container IP.

## Secrets

**No provider key ever reaches the browser.** Spec §56/§70/§71 state it and the code
enforces it in four places:

1. `apps/api/app/core/config.py` reads `OPENAI_API_KEY` and `ELEVENLABS_API_KEY` as
   `SecretStr`, and no router returns them.
2. `apps/web/src/lib/api-client.ts` has no provider-key code path and never reads a
   `NEXT_PUBLIC_*_API_KEY`.
3. `apps/web/next.config.mjs` pins `connect-src` to our own API and WS origins, so a
   regression that tried to call a provider directly fails loudly.
4. Every LLM and TTS call goes browser → API → provider (spec §70/§71), so the credential
   lives in exactly one process.

Practical rules:

- Anything named `NEXT_PUBLIC_*` is **public**. Next.js inlines it into the client bundle
  at build time. Never put a secret there, including in a build argument.
- Inject secrets as environment variables from your platform's secret manager or as
  Docker/Kubernetes secrets. Do not bake them into an image and do not commit `.env`
  (`.gitignore` excludes `.env` and `.env.*` but keeps `.env.example`).
- `JWT_SECRET` must be ≥ 32 random characters. Outside `APP_ENV=local|test` the API
  refuses to boot on the `.env.example` placeholder `change-me` or on anything shorter.
  Rotating it invalidates every session and every CSRF token (both are HMAC-bound to it),
  and also every value hashed by `hash_lookup_key`, so rotate during a maintenance window.
- Set `QDRANT_API_KEY` for any Qdrant that is not on a private network. It is empty in
  local development only.
- Object storage credentials are used to mint short-lived signed URLs
  (`S3_SIGNED_URL_TTL_SECONDS`, default 900); the bucket itself stays private
  (`mc anonymous set none`).

## Data stores: sizing, backup, restore

### PostgreSQL

Source of truth for the §53 entities. Vectors never live here.

Growth is dominated by `TranscriptTurn`, `PersonaStateEvent` and `AuditEvent`. Budget on
sessions: a 20-turn text session is a few tens of KB of rows; audio lives in object
storage, not in Postgres.

```bash
docker compose --env-file .env exec -T postgres pg_dump -U aicoach -d aicoach -Fc > aicoach-$(date +%F).dump
```

```bash
docker compose --env-file .env exec -T postgres pg_restore -U aicoach -d aicoach --clean --if-exists < aicoach-2026-09-04.dump
```

Take base backups plus WAL archiving for point-in-time recovery in production; a nightly
`pg_dump` alone means up to a day of lost sessions. Test the restore path on a scratch
database before you need it.

### Qdrant

Sizing: `dimension × 4 bytes` per vector for `float32` storage, plus HNSW graph overhead
(roughly 1.5–2× the raw vectors at default `m`), plus the payload. With
`EMBEDDING_DIMENSION=3072` (`text-embedding-3-large`) one vector is ~12 KB before overhead,
so 100k chunks is ~1.2 GB raw and 2–3 GB resident. A 384-dimension local model
(`multilingual-e5-small`) is eight times smaller — the choice of embedding model is a
capacity decision, not only a quality one.

Every point carries `tenant_id`, `workspace_id` and `knowledge_base_id` in its payload
(spec §74); the payload indexes for those keys are created by the API at startup, not by
compose. Snapshot and restore:

```bash
curl -X POST "http://localhost:6333/collections/<collection>/snapshots"
```

```bash
curl -X PUT "http://localhost:6333/collections/<collection>/snapshots/recover" -H 'Content-Type: application/json' -d '{"location":"file:///qdrant/snapshots/<collection>/<snapshot>.snapshot"}'
```

Qdrant is rebuildable from Postgres plus object storage by re-embedding, so it is a
lower-tier backup target than Postgres — but re-embedding a large corpus through an API
model costs real money, so back it up anyway.

### Redis

Cache, rate-limit buckets, Celery broker and result backend, and the WS replay log.
Append-only file is on. Losing Redis loses queued jobs and buffered replay events, not
committed data. Nothing in Redis needs a long-term backup; snapshot it if you want faster
recovery of in-flight jobs.

### Object storage

Holds uploaded source documents, generated report PDFs and session audio. Bucket
versioning is enabled by `minio-init`, which gives `DocumentVersion`-level recoverability
independently of the Postgres row and protects against a bad re-parse. A lifecycle rule
expires the `tmp/` prefix (extracted page images, OCR intermediates) after 30 days.

Replicate the bucket, or mirror it:

```bash
mc mirror --overwrite local/ai-coach backup/ai-coach
```

## Migrations

Migrations live in `database/migrations/`; `apps/api/app/db/alembic.ini` points at them
with `script_location = ../../database/migrations` and `prepend_sys_path = .`. Because
`database/migrations/env.py` imports `app.core.config` and `app.db.base`, **alembic must be
run from `apps/api`** — from anywhere else the import of `app.*` fails.

```bash
cd apps/api && alembic -c app/db/alembic.ini upgrade head
```

In the container:

```bash
docker compose --env-file .env exec -T api alembic -c app/db/alembic.ini upgrade head
```

Review the SQL before applying it to production:

```bash
cd apps/api && alembic -c app/db/alembic.ini upgrade head --sql
```

`env.py` reads `DATABASE_URL` through `app.core.config`, so `alembic.ini` contains no
credentials and migrations always target the same database as the app. DDL runs in a single
transaction (`transaction_per_migration=False`), so a failed migration leaves no
half-applied schema — Postgres has transactional DDL. Revision `0001_initial_schema` builds
from `Base.metadata`; every later revision must use explicit `op.*` operations.

Run migrations as their own step before rolling app containers, never as a container
entrypoint: two replicas starting at once would race, and an entrypoint migration couples
schema changes to restarts.

## The async worker

Celery, with Redis as broker and result backend. Chosen over Dramatiq because the §65
pipeline needs chained and grouped tasks with per-step retry and the §40.2 retention sweep
needs a scheduler — canvas and beat are built in.

- Queues: `documents`, `evaluation`, `maintenance` (`CELERY_QUEUES`).
- Concurrency: `CELERY_CONCURRENCY`, default 2. Parsing and OCR are CPU- and
  memory-bound; scale by adding worker containers rather than by raising concurrency past
  the core count.
- Liveness is a control-bus ping (`celery -A app.workers.celery_app inspect ping -d
  celery@$(hostname)`), scoped to the container's own node name so a healthy sibling
  cannot mask a dead worker.
- Beat must run **exactly once** per deployment, as its own process. Two beat schedulers
  double every periodic job, including the retention sweep.
- The worker uses the same image as the API so the domain models and RAG code cannot
  drift between them.

## Scaling

Spec §49.3 requires horizontal scale for the API, workers, vector DB, queue, storage and
the WebSocket gateway.

- **API — stateless.** Session continuity lives in Postgres plus Redis, so replicas are
  interchangeable. Scale on CPU. Keep `--proxy-headers --forwarded-allow-ips='*'` (the
  image already does) or the audit log records the proxy's IP instead of the client's.
- **WebSocket gateway.** `seq` allocation is `INCR` on `ws:session:{id}:seq` in Redis and
  events fan out over Redis pub/sub, so two API replicas serving one session still produce
  one gap-free sequence. Sockets are long-lived, so prefer least-connections balancing and
  drain rather than kill on deploy. Per-IP connection limit is 8 at the edge
  (`limit_conn ws_conn 8`), which covers extra tabs and reconnect overlap.
- **Worker.** Add replicas; queues are independent, so a slow OCR backlog on `documents`
  does not delay `evaluation`.
- **Qdrant.** Scale by sharding a collection across nodes and adding replicas for read
  throughput. Because every query filter carries `tenant_id` and `workspace_id`, a shard
  key on tenant keeps a tenant's vectors co-located.
- **Postgres.** Read replicas for analytics and reporting; the write path is small.
- **Rate limiting** is a Redis token bucket, atomic via a Lua script, so it is correct
  across replicas. It fails **open** when Redis is unavailable, except on credential
  endpoints, which fail **closed**.

## Observability

Required by spec §49.5: structured logs, tracing, metrics, and specifically LLM latency,
token usage, STT latency, TTS latency, retrieval latency and WebGPU backend telemetry —
*without collecting sensitive content*.

### Logs

`structlog` JSON to stdout, with a mandatory redaction processor and an `X-Request-ID`
correlation id propagated by nginx (`rid=$request_id` in the access log) into every API
log line and `AuditEvent` row.

**Transcript content and PII are never logged.** This is enforced, not merely intended:

- the redaction processor replaces transcript text, prompts, quotes, e-mail, IP and
  key-shaped values with `[redacted]`, masks PII-shaped substrings, truncates long strings
  and lists what it removed in a `redacted` field;
- the validation-error handler echoes only the field location and validator message,
  dropping the offending `input` value, so a request body never lands in a log or a
  response;
- the unhandled-exception handler logs the traceback server-side and returns a fixed
  sentence;
- nginx's `log_format main` deliberately omits query strings and request bodies.

Do not add a logging call that stringifies a request body to work around the redactor, and
do not raise the proxy log format to include `$request_uri` with its query string.

### Tracing and metrics

OpenTelemetry is wired in the API (`opentelemetry-instrumentation-fastapi`, OTLP/HTTP
exporter) and off by default:

```bash
OTEL_ENABLED=true
OTEL_SERVICE_NAME=ai-coach-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

`healthz` and `readyz` are excluded from instrumentation so probes do not flood traces.

Latency to watch, per spec §49.5:

| Metric | Where it comes from |
|---|---|
| LLM latency, token usage | `app/agents/llm_client.py` per provider call |
| Retrieval latency | `RetrievalTestResponse` reports `embedding_ms`, `search_ms`, `rerank_ms`, `total_ms`; the same spans exist on the live path |
| STT / TTS latency | the voice path (`app/ws/voice.py`) |
| Client inference telemetry | `POST /api/v1/runtime/telemetry` — backend, model id, load ms, last inference ms, worker status, fallback reason |

Client telemetry is content-free by construction: `TelemetryPatch` in
`packages/ai-runtime` maps every content-shaped key (`prompt`, `text`, `transcript`,
`query`, `messages`, `vectors`, …) to `never`, so adding one is a compile error, with
`assertContentFree()` as a runtime backstop.

### Probes

| Probe | Path | Semantics |
|---|---|---|
| Liveness | `GET /healthz` | process state only; touches no dependency, so a Redis blip cannot make an orchestrator kill healthy pods |
| Readiness | `GET /readyz` | probes Postgres, Redis, Qdrant and object storage in parallel with a 3 s timeout; `503` when any is down, and the body always lists every probe with a latency and an exception *type* (never a DSN) |
| Edge | `GET /healthz` on port 80 | nginx answers locally, no upstream |

See the Current-status note in [`installation.md`](installation.md#verify) about the
`/health/ready` path mismatch in the API image's `HEALTHCHECK`.

## Data retention and deletion

Spec §40.2 requires retention and deletion as first-class operations. Implemented in
`apps/api/app/workers/retention_jobs.py`:

| Job | What it does |
|---|---|
| `retention_sweep` | applies the tenant's retention policy; scheduled daily by Celery beat. `TRANSCRIPT_RETENTION_DAYS` (default 365) is the transcript horizon |
| `erase_user` | right-to-erasure for one user: deletes their sessions and documents, pseudonymises their audit rows rather than deleting them, and enqueues vector purges |
| `purge_document_vectors` | deletes a document's Qdrant points after its rows are gone (§40.2, §74) |

Notes for operators:

- Audit rows are **pseudonymised, not deleted** — the trail must survive an erasure
  request. Confirm this satisfies your jurisdiction before go-live.
- Object versioning is on, so deleting an object leaves prior versions. An erasure that
  must be complete needs the version history purged too.
- Both jobs support a dry run; use it first on production data.
- Retention is per tenant. Setting `TRANSCRIPT_RETENTION_DAYS` too low silently destroys
  evidence that evaluations cite (§27), so change it deliberately.

## Zero-downtime update

Assumes the single-node compose topology; the same sequence applies per-deployment under
an orchestrator.

1. **Build the new images** without touching the running ones:

   ```bash
   docker compose --env-file .env --profile app build
   ```

2. **Check migration compatibility.** The update is only zero-downtime if the new schema
   is readable by the *old* code: additive columns, new tables, nullable-then-backfill. A
   destructive change (dropping or renaming a column the running version still selects)
   needs a maintenance window or a two-release expand/contract.

3. **Apply migrations** while the old version still serves:

   ```bash
   docker compose --env-file .env exec -T api alembic -c app/db/alembic.ini upgrade head
   ```

4. **Roll the API**, then the worker, then the web app:

   ```bash
   docker compose --env-file .env --profile app up -d --no-deps api
   ```

   uvicorn is PID 1 and receives `SIGTERM` for a graceful drain
   (`--timeout-graceful-shutdown 30`). Live sockets are dropped on replacement; the client
   reconnects and resumes from `seq` (see [`api.md`](api.md#reconnect-and-resume)), so a
   session survives the restart with a visible reconnect notice rather than a lost turn.

5. **Reload nginx** so the upstream resolves to the new container:

   ```bash
   docker compose --env-file .env exec proxy nginx -s reload
   ```

6. **Verify** before declaring done: `/readyz` all-green, one real login, one WebSocket
   handshake, one document upload reaching `ready`.

Web-app note: `NEXT_PUBLIC_*` values are inlined at build time. Changing an API base URL
means rebuilding the `web` image, not restarting it.

## Rollback

1. Re-tag or re-pull the previous image and bring the services back up on it
   (`docker compose … up -d --no-deps api worker web`).
2. **Schema.** Prefer rolling forward with a fix. If you must go back:

   ```bash
   cd apps/api && alembic -c app/db/alembic.ini downgrade -1
   ```

   Only do this when the revision's `downgrade()` is genuinely reversible — a dropped
   column's data is gone. Restore from the pre-migration backup instead when it is not.
3. **Order matters.** Roll the app back before the schema, so the older code never sees
   the newer schema unnecessarily.
4. Keep the last-known-good image tag and the pre-migration dump for the whole release
   window; a rollback that depends on rebuilding from source is not a rollback.

## Go-live checklist

Configuration

- [ ] `APP_ENV=production`; `/docs` and `/openapi.json` are consequently disabled
- [ ] `JWT_SECRET` is ≥ 32 random characters and not `change-me` (the API refuses to boot
      otherwise)
- [ ] `CORS_ALLOW_ORIGINS` lists exact origins; `*` is rejected at boot
- [ ] `OPENAI_API_KEY` / `ELEVENLABS_API_KEY` present for whichever providers are enabled,
      absent otherwise
- [ ] `ALLOW_SENSITIVE_DATA_CACHE=false` (the API refuses to boot with it true in
      production)
- [ ] `TRANSCRIPT_RETENTION_DAYS` set to the value your legal review agreed
- [ ] no `NEXT_PUBLIC_*` variable contains a secret
- [ ] `QDRANT_API_KEY` set unless Qdrant is on a private network

Edge and transport

- [ ] TLS 1.2/1.3 only, valid chain, renewal automated
- [ ] HSTS on; preload only once every subdomain is HTTPS
- [ ] COOP + COEP present on HTML responses; verified with
      `self.crossOriginIsolated === true` in the browser console
- [ ] a real WebSocket handshake succeeds through the proxy (not just `/ws/healthz`)
- [ ] rate-limit zones active: 5 r/m on auth, 20 r/s general
- [ ] `client_max_body_size` matches your document upload ceiling (200m by default)

Data

- [ ] migrations applied and verified with `--sql` review
- [ ] demo users from `database/seeds/seed.py` **absent**
- [ ] Postgres base backup plus WAL archiving, and a restore rehearsed
- [ ] Qdrant snapshot schedule; payload indexes present on `tenant_id`, `workspace_id`,
      `knowledge_base_id`
- [ ] object storage private, versioned, replicated; signed-URL TTL reviewed
- [ ] retention sweep scheduled, with exactly one Celery beat process

Operations

- [ ] `/healthz` and `/readyz` wired to the load balancer with correct semantics
- [ ] logs shipped; a spot check confirms no transcript text or PII in them
- [ ] tracing endpoint reachable and `OTEL_ENABLED=true`
- [ ] alerts on `/readyz` failures, 5xx rate, worker queue depth, provider error rate
- [ ] rollback tag and pre-migration dump retained
- [ ] tenant isolation spot-checked: a cross-tenant id returns `404`, not `403`

Known gaps to accept explicitly before go-live: no Kubernetes manifests, no STUN/TURN for
voice, the `/api/` WebSocket upgrade gap above, and everything listed in
[`roadmap.md`](roadmap.md#what-is-currently-mocked-or-faked--the-honest-list).
