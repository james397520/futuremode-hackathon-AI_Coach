# Configuration

Every environment variable AI Coach reads, where it is consumed, and what breaks when it
is wrong.

`.env.example` at the repository root is the single source of truth for the **required**
variables. `apps/api/app/core/config.py` is the reference for the optional extras and for
the fail-fast rules. Setup instructions are in [`installation.md`](installation.md);
production concerns are in [`deployment.md`](deployment.md).

## Contents

- [How configuration is loaded](#how-configuration-is-loaded)
- [Application](#application)
- [Web (client)](#web-client)
- [API](#api)
- [Database](#database)
- [Vector store](#vector-store)
- [Cache and queue](#cache-and-queue)
- [Object storage](#object-storage)
- [AI providers](#ai-providers)
- [Security](#security)
- [Client runtime policy](#client-runtime-policy)
- [Observability](#observability)
- [Compose-only variables](#compose-only-variables)
- [Fail-fast rules](#fail-fast-rules)
- [Changing configuration safely](#changing-configuration-safely)

## How configuration is loaded

```bash
cp .env.example .env
```

- **API and worker.** Pydantic settings read `.env` then `../../.env` relative to the
  process working directory, so running from `apps/api` picks up the repository-root file.
  Names are case-insensitive; unknown keys are ignored (`extra="ignore"`), which means a
  typo is silently dropped rather than reported — check spelling against the tables below.
- **Web.** Next.js inlines `NEXT_PUBLIC_*` at **build** time. In the container these are
  build arguments in `docker-compose.yml`, not runtime environment.
- **Compose.** `${VAR}` interpolation resolves from the project directory, and every
  interpolation in `docker-compose.yml` carries a `:-default` matching `.env.example`.
  Containers that need real values also read the root file via `env_file: .env`
  (`required: false`), and the `environment:` block then overrides `localhost` host URLs
  with in-network service names. Pass the file explicitly to be safe:

  ```bash
  docker compose --env-file .env up -d
  ```

Legend for the tables: **Required** means the process is wrong without it, not that it has
no default.

## Application

| Variable | Consumed by | Default | Required | If wrong |
|---|---|---|---|---|
| `APP_ENV` | `app.core.config`; every fail-fast rule; cookie `Secure` flag; `/docs` exposure | `local` | yes in deployed environments | One of `local`, `test`, `staging`, `production`. Anything else fails validation at boot. Leaving it `local` in production disables every fail-fast check, serves cookies without `Secure`, and exposes `/docs` |
| `APP_NAME` | OpenAPI title, log field | `ai-coach-api` | no | Cosmetic |
| `API_PREFIX` | router mount point in `app.main` | `/api/v1` | no | Changing it moves every REST route; the web client's paths and the nginx `location /api/` block must move with it |
| `LOG_LEVEL` | `app.core.logging` | `INFO` | no | Must be one of `CRITICAL`, `ERROR`, `WARNING`, `INFO`, `DEBUG`, `NOTSET`; other values fail validation. `DEBUG` is noisy but still passes through the redaction processor |
| `DEBUG_SQL` | SQLAlchemy echo | `false` | no | `true` logs every statement — verbose, and never appropriate in production |

## Web (client)

Everything here is compiled into the JavaScript bundle and is therefore **public**. Never
put a secret in a `NEXT_PUBLIC_*` variable.

| Variable | Consumed by | Default | Required | If wrong |
|---|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `apps/web/src/lib/api-client.ts`, `next.config.mjs` (`connect-src`), `apps/web/src/features/simulation/lib/env.ts` | `http://localhost:8000` in `api-client.ts`; **empty string** in the simulation feature | yes for a real deployment | Wrong origin → every request fails CORS or 404s. **Unset or empty → the live simulation page runs the scripted mock event stream by design** (`shouldUseMockStream`), so the UI looks healthy while nothing reaches a backend. Must also appear in `CORS_ALLOW_ORIGINS`' counterpart on the API side |
| `NEXT_PUBLIC_WS_BASE_URL` | `apps/web/src/lib/ws-client.ts`, `next.config.mjs` (`connect-src`) | `ws://localhost:8000` | yes for a real deployment | Scheme must match the page: `wss://` on an HTTPS origin, or the browser blocks the mixed-content upgrade. If it is not in `connect-src`, the CSP blocks the socket |
| `NEXT_PUBLIC_ENABLE_WEBGPU` | `packages/ai-runtime` policy; also read by the API as the default `RuntimePolicy.webgpu` | `auto` | no | Must be `auto`, `on` or `off`; other values fail API validation. See [client runtime policy](#client-runtime-policy) |

## API

| Variable | Consumed by | Default | Required | If wrong |
|---|---|---|---|---|
| `PORT` | uvicorn in `infra/docker/api.Dockerfile` | `8000` | no | Must match the compose port mapping and the nginx upstream |
| `UVICORN_WORKERS` | API container command | `2` | no | Each worker is a full process; oversubscribing the CPU raises tail latency. Under an orchestrator prefer more replicas over more workers |
| `UVICORN_LOG_LEVEL` | API container command | `info` | no | Independent of `LOG_LEVEL`, which governs the application logger |
| `API_READY_PATH` | the API image's `HEALTHCHECK` | `/health/ready` | no | **See the note below.** A path the app does not serve makes the container permanently `unhealthy`, and `web` never starts because it waits on `api: service_healthy` |
| `CELERY_APP` | worker container command and health probe | `app.workers.celery_app` | no | A wrong module name makes the worker exit immediately |
| `CELERY_CONCURRENCY` | worker container | `2` | no | Parsing and OCR are memory-hungry; too high causes OOM kills mid-pipeline |
| `CELERY_QUEUES` | worker container | `documents,evaluation,maintenance` | no | Omitting a queue means those jobs are enqueued and never consumed — uploads sit in `embedding` forever |
| `WEB_HEALTH_PATH` | the web image's `HEALTHCHECK` | `/` | no | `apps/web` has no dedicated health route yet; a path that 404s still passes because the probe accepts any status < 500 |

> **Current status.** `API_READY_PATH` defaults to `/health/ready` and the compose
> healthcheck hardcodes `http://127.0.0.1:8000/health/ready`, but
> `apps/api/app/api/health.py` mounts `GET /healthz` and `GET /readyz`. Set
> `API_READY_PATH=/readyz` until the paths are reconciled. Tracked in
> [`roadmap.md`](roadmap.md).

## Database

| Variable | Consumed by | Default | Required | If wrong |
|---|---|---|---|---|
| `DATABASE_URL` | `app.core.config` → `app.db.session`; `database/migrations/env.py` | `postgresql+asyncpg://aicoach:aicoach@localhost:5432/aicoach` | **yes** | **Must start `postgresql+asyncpg://`** — a `postgresql://` or `psycopg2` URL is rejected at boot with an explicit message, because the whole persistence layer is async. A wrong host/credential fails at first query and shows up as `/readyz` reporting `postgres.ok = false` |

Compose additionally derives the in-network URL from `POSTGRES_USER`,
`POSTGRES_PASSWORD` and `POSTGRES_DB` — see [compose-only variables](#compose-only-variables).

## Vector store

| Variable | Consumed by | Default | Required | If wrong |
|---|---|---|---|---|
| `QDRANT_URL` | `app.rag.vectorstore`; `/readyz` probe | `http://localhost:6333` | **yes** | Unreachable → retrieval returns `retrieval_unavailable` (503) and ingestion stalls at `indexing`. Vectors never live in Postgres, so there is no fallback store |
| `QDRANT_API_KEY` | `app.core.config` | unset | yes for any shared/remote Qdrant | Wrong or missing against a secured Qdrant → every vector call 401s; the symptom looks like "retrieval is down" |

Switching `EMBEDDING_MODEL` or `EMBEDDING_DIMENSION` changes the vector geometry.
`EmbeddingSpec.index_key()` namespaces collections by model, so old and new vectors cannot
mix — but a stale collection with the previous dimension will reject writes. See
[`troubleshooting.md`](troubleshooting.md#qdrant-dimension-mismatch-after-switching-embedding-models).

## Cache and queue

| Variable | Consumed by | Default | Required | If wrong |
|---|---|---|---|---|
| `REDIS_URL` | `app.core.rate_limit`, `app.ws.events`, Celery broker and result backend | `redis://localhost:6379/0` | **yes** | Unavailable Redis: rate limiting **fails open** (and logs loudly) except on credential endpoints, which **fail closed**; WS `seq` allocation falls back to a per-process counter, which is only correct with a single API replica; Celery cannot enqueue at all, so uploads never progress |

## Object storage

| Variable | Consumed by | Default | Required | If wrong |
|---|---|---|---|---|
| `S3_ENDPOINT` | `boto3` client in `app.services`/`app.rag`; `/readyz` probe | `http://localhost:9000` | **yes** | Wrong endpoint → uploads and report export fail; `/readyz` reports `object_storage.ok = false`. Signed URLs are generated against this host, so it must be the origin the *browser* can reach |
| `S3_ACCESS_KEY` | same | `minioadmin` | **yes** | 403 on every object operation |
| `S3_SECRET_KEY` | same (held as `SecretStr`) | `minioadmin` | **yes** | As above. Never returned by any endpoint |
| `S3_BUCKET` | same; created by the `minio-init` service | `ai-coach` | **yes** | A non-existent bucket fails `head_bucket`, so `/readyz` is red at startup rather than failing on first upload |
| `S3_REGION` | `boto3` | `us-east-1` | no | Harmless for MinIO; must be correct for real S3 signing |
| `S3_SIGNED_URL_TTL_SECONDS` | signed upload/download URLs | `900` | no | Too short and a large upload expires mid-transfer; too long and a leaked URL stays usable. Objects reach the browser *only* through these URLs (spec §73) |

## AI providers

Provider credentials exist only in the API and worker processes. Spec §56/§70/§71: a
long-lived provider key must never reach the browser, and every LLM/TTS call goes
browser → API → provider.

| Variable | Consumed by | Default | Required | If wrong |
|---|---|---|---|---|
| `OPENAI_API_KEY` | `app.agents.llm_client`, `app.rag.embedder` (`ApiEmbedder`), speech | unset | **yes when the OpenAI provider is enabled** | Missing while enabled → the process refuses to boot outside local (see [fail-fast rules](#fail-fast-rules)). In local it boots and every live turn fails with `provider_unavailable` |
| `ELEVENLABS_API_KEY` | the voice path | unset | **yes when `TTS_PROVIDER=elevenlabs`** | Same fail-fast rule; without it TTS returns `provider_unavailable` while text training still works |
| `LLM_PROVIDER` | `app.agents.llm_client` | `openai` | no | One of `openai`, `azure_openai`, `aup`, `none`. `aup` routes to the private environment (spec §72); `none` disables live turns entirely |
| `LLM_MODEL` | `app.agents.llm_client` | `gpt-4o` | no | An unavailable model id surfaces as `provider_unavailable` on the first turn, not at boot |
| `LLM_TIMEOUT_SECONDS` | provider calls | `30.0` | no | Too low turns slow-but-fine generations into `provider_timeout` (504); too high holds a socket open past the client's patience |
| `TTS_PROVIDER` | the voice path | `elevenlabs` | no | One of `elevenlabs`, `openai`, `none`. Also decides which key the fail-fast check demands |
| `EMBEDDING_MODEL` | `app.rag.embedder`; recorded on each `KnowledgeBase` | `text-embedding-3-large` | no | Changing it invalidates the index — see [`model.md`](model.md) and re-embed deliberately. The default is an **API** model, which is a data-residency decision (spec §2.1) |
| `EMBEDDING_DIMENSION` | vector collection creation | `3072` | no | Must match the model's real output width or Qdrant rejects every upsert |

## Security

| Variable | Consumed by | Default | Required | If wrong |
|---|---|---|---|---|
| `JWT_SECRET` | `app.core.security`: token signing, CSRF HMAC, `hash_lookup_key` | `change-me` | **yes** | Outside `local`/`test` the process refuses to boot on the placeholder or on anything shorter than 32 characters. Changing it invalidates every session, every CSRF token and every keyed lookup hash at once |
| `JWT_ALGORITHM` | `app.core.security` | `HS256` | no | Must match what issued the live tokens; changing it invalidates them |
| `JWT_ISSUER` | `app.core.security` (verified on decode) | `ai-coach` | no | A mismatch makes every existing token `token_invalid` |
| `ACCESS_TOKEN_TTL_SECONDS` | access token and the session/CSRF cookie `max-age` | `900` (15 min) | no | Longer means a revoked role stays effective longer — refresh re-reads roles from the database, so this value *is* the revocation window |
| `REFRESH_TOKEN_TTL_SECONDS` | refresh cookie | `1209600` (14 days) | no | Longer sessions, larger stolen-cookie window |
| `COOKIE_NAME` | session cookie (`HttpOnly`, `SameSite=Lax`) | `aicoach_session` | no | Renaming logs everyone out |
| `CSRF_COOKIE_NAME` | CSRF cookie (readable by JS, by design) | `aicoach_csrf` | no | Must match what the web client echoes in `X-CSRF-Token`, or every mutating request 403s with `csrf_invalid` |
| `REFRESH_COOKIE_NAME` | refresh cookie (`HttpOnly`, `SameSite=Strict`, path `/api/v1/auth/refresh`) | `aicoach_refresh` | no | Renaming breaks silent refresh; users are logged out after one access-token lifetime |
| `COOKIE_DOMAIN` | all auth cookies | unset (host-only) | no | Setting it too broadly shares the session with sibling subdomains; setting it wrongly means the browser stores nothing and login appears to succeed then immediately fail |
| `CORS_ALLOW_ORIGINS` | `CORSMiddleware`; **also the WebSocket `Origin` allowlist** | `http://localhost:3000` | **yes in deployed environments** | Accepts a comma-separated list or a JSON array. `*` is **rejected at boot** — it is incompatible with credentialed requests (spec §73). A missing origin blocks both XHR *and* the session socket, since browsers do not apply same-origin policy to WebSockets and the API checks `Origin` itself |
| `RATE_LIMIT_ENABLED` | `app.core.rate_limit` | `true` | no | `false` removes the §40.3 protection, including on `/auth/login` |
| `RATE_LIMIT_DEFAULT_PER_MINUTE` | token-bucket default | `120` | no | Too low throttles ordinary navigation; routers also declare their own per-route budgets, which win |
| `RATE_LIMIT_MUTATING_PER_MINUTE` | token-bucket default for writes | `30` | no | As above, for `POST`/`PUT`/`PATCH`/`DELETE` |
| `TRANSCRIPT_RETENTION_DAYS` | `app.workers.retention_jobs` | `365` | no | The retention sweep deletes transcripts older than this. Too low destroys the evidence evaluations cite (spec §27); too high may breach your retention policy |

## Client runtime policy

Spec §61 and §97 require enterprise switches for local inference. The API exposes them as
`RuntimePolicy` on `GET /api/v1/runtime/policy` (and `PATCH` for an admin), seeded from
these variables; `packages/ai-runtime` honours them end to end.

| Variable | Default | Effect |
|---|---|---|
| `NEXT_PUBLIC_ENABLE_WEBGPU` | `auto` | `auto` — detect and use the best available tier (WebGPU → WASM → server). `on` — a *preference*, not a guarantee: an incapable device still steps down. `off` — forces the **server** tier: no adapter requested, no device created, no weights downloaded, nothing cached, and applied immediately on policy change (loaded sessions are released) |
| `ALLOW_LOCAL_MODEL_CACHE` | `true` | `false` disables the Cache Storage model cache. Weights stream straight into the worker and live only in that session's memory; turning it off mid-session deletes what was already cached. Costs a re-download per session — the enterprise trade for leaving nothing on disk |
| `ALLOW_SENSITIVE_DATA_CACHE` | `false` | Governs the in-memory memo of vectors derived from user text. Default off. **Must be `false` in production** — the API refuses to boot otherwise |
| `CLEAR_ON_LOGOUT` | `true` | On logout `dispose()` deletes the Cache Storage bucket and the runtime's metadata database, in addition to the server clearing the auth cookies |

A workspace admin can force the tier for everyone with an enterprise override, which wins
over the per-user value; see `packages/ai-runtime/README.md`. Regardless of policy, the
browser tier is **advisory only** — the server is authoritative for safety, reranking and
scoring (spec §52/§54/§55). See [`model.md`](model.md#the-authority-rule).

## Observability

| Variable | Consumed by | Default | Required | If wrong |
|---|---|---|---|---|
| `OTEL_ENABLED` | `app.main` instrumentation | `false` | no | `true` without a reachable exporter makes every request pay a failing export attempt |
| `OTEL_SERVICE_NAME` | resource attribute | `ai-coach-api` | no | Traces land under the wrong service name |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP/HTTP exporter | unset | yes when `OTEL_ENABLED=true` | Enabled with no endpoint → no traces and repeated exporter errors |

## Compose-only variables

Read by `docker-compose.yml` (and the nginx/Postgres init) rather than by the application.
All have defaults, so the stack starts with none of them set.

| Variable | Default | Purpose |
|---|---|---|
| `POSTGRES_SUPERUSER` / `POSTGRES_SUPERUSER_PASSWORD` | `postgres` / `postgres` | superuser bootstrap for the container |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `aicoach` / `aicoach` / `aicoach` | the *application* role and database created by `infra/docker/postgres/init/01-init-db.sh`; also used to build the in-network `DATABASE_URL` |
| `POSTGRES_TEST_DB` | `aicoach_test` | second database for the pytest suite |
| `POSTGRES_PORT`, `REDIS_PORT`, `QDRANT_PORT`, `QDRANT_GRPC_PORT`, `MINIO_PORT`, `MINIO_CONSOLE_PORT`, `API_PORT`, `WEB_PORT`, `PROXY_HTTP_PORT`, `PROXY_HTTPS_PORT` | `5432`, `6379`, `6333`, `6334`, `9000`, `9001`, `8000`, `3000`, `80`, `443` | host port mappings; change these when a port is already taken |
| `QDRANT_LOG_LEVEL` | `INFO` | Qdrant verbosity |

The init script runs **once**, on an empty data directory. Editing it takes effect only
after the volume is dropped (`docker compose down -v`).

## Fail-fast rules

Implemented in `Settings._fail_fast_on_unsafe_config` and the field validators in
`apps/api/app/core/config.py`. The first group applies in **every** environment; the second
only outside `APP_ENV=local|test`.

Always enforced:

- `DATABASE_URL` must start `postgresql+asyncpg://`.
- `CORS_ALLOW_ORIGINS` must not contain `*`.
- `LOG_LEVEL` must be a recognised level.
- `APP_ENV`, `LLM_PROVIDER`, `TTS_PROVIDER` and `NEXT_PUBLIC_ENABLE_WEBGPU` must be one of
  their declared literals.

Outside `local`/`test` the process **refuses to start** — `ConfigurationError`, listing
every problem at once — if:

- `JWT_SECRET` is still the `.env.example` placeholder `change-me`;
- `JWT_SECRET` is shorter than 32 characters;
- `OPENAI_API_KEY` is absent while the OpenAI provider is enabled, i.e. `LLM_PROVIDER` is
  `openai`/`azure_openai` **or** `TTS_PROVIDER=openai`;
- `ELEVENLABS_API_KEY` is absent while `TTS_PROVIDER=elevenlabs`;
- `CORS_ALLOW_ORIGINS` is empty;
- `ALLOW_SENSITIVE_DATA_CACHE` is true and `APP_ENV=production`.

Two derived behaviours follow from `APP_ENV` alone and are easy to miss:

- cookies get `Secure` everywhere except `local`/`test`;
- `/docs` and `/openapi.json` are served **only** when `APP_ENV` is not `production`.

## Changing configuration safely

### Rebuild required

| Change | Why |
|---|---|
| any `NEXT_PUBLIC_*` value | Next.js inlines these into the client bundle at build time. In compose they are `build.args` on the `web` service, so `docker compose --profile app up -d --build web` is the only way to apply them. This is a Next.js property, not an oversight |
| anything in `next.config.mjs` (CSP, headers, `transpilePackages`) | compiled into the build |
| a dependency change in any `package.json` or `pyproject.toml` | image rebuild |

### Restart required

| Change | Why |
|---|---|
| `APP_ENV`, `JWT_*`, `COOKIE_*`, `CORS_ALLOW_ORIGINS`, `RATE_LIMIT_*`, `LOG_LEVEL`, `DEBUG_SQL`, `OTEL_*` | `get_settings()` is an `lru_cache`d singleton read once per process |
| `DATABASE_URL`, `REDIS_URL`, `QDRANT_URL`, `S3_*` | connection pools and clients are built at startup |
| `LLM_*`, `TTS_PROVIDER`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` | same singleton |
| `CELERY_*` | the worker's command line |
| `EMBEDDING_MODEL`, `EMBEDDING_DIMENSION` | restart **plus** a re-embed; see below |

### Reload only

| Change | How |
|---|---|
| `infra/nginx/nginx.conf`, certificates | `docker compose exec proxy nginx -s reload` |
| a restarted upstream container's IP | the same reload — a static `upstream` name resolves once at startup |

### Needs a data migration, not just a restart

- **`EMBEDDING_MODEL` / `EMBEDDING_DIMENSION`.** Existing vectors keep the old geometry.
  Re-embed the affected knowledge bases (`POST
  /api/v1/documents/{document_id}/reprocess`) and expect provider cost if the model is an
  API model. `KnowledgeBase.embedding_model` and `DocumentVersion.embedding_version` record
  which is which.
- **`JWT_SECRET`.** Every session, CSRF token and keyed lookup hash is invalidated at once.
  Rotate in a maintenance window.
- **`TRANSCRIPT_RETENTION_DAYS`.** Lowering it makes the next sweep delete data
  irreversibly. Run the retention job's dry run first.

### Ordering

Change configuration **before** rolling containers, and apply migrations as their own step
— see [`deployment.md`](deployment.md#zero-downtime-update).
