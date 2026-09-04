# Installation

How to get AI Coach running on a developer machine, three ways, with a verification step for each.

For production see [`deployment.md`](deployment.md). For every environment variable see
[`configuration.md`](configuration.md). For what is actually finished versus scaffolded see
[`roadmap.md`](roadmap.md).

## Contents

- [Prerequisites](#prerequisites)
- [Path 1 — Docker Compose quick start](#path-1--docker-compose-quick-start)
- [Path 2 — stack in Docker, app processes on the host](#path-2--stack-in-docker-app-processes-on-the-host)
- [Path 3 — fully local](#path-3--fully-local)
- [Demo users](#demo-users)
- [Resetting](#resetting)
- [Known constraints](#known-constraints)

## Prerequisites

### Hardware

The numbers below are what the stack actually needs, not a marketing minimum. Postgres,
Redis, Qdrant and MinIO run as four containers; adding the `app` profile brings the API,
the Celery worker and a Next.js production server, which is where the memory goes.

| Resource | Data plane only (Paths 2 and 3) | Full container run (`--profile app`) |
|---|---|---|
| CPU cores | 4 | 6 (2 for the Next.js build alone) |
| RAM | 8 GB total, ~2.5 GB for containers | 16 GB total, ~6 GB for containers |
| Free disk | 12 GB | 20 GB (images plus the pnpm store plus Docker build cache) |

Qdrant's memory grows with the number of indexed vectors; a small demo knowledge base is
a few tens of MB. Browser-side local inference (see [`model.md`](model.md)) downloads
23–235 MB of model files per task variant into Cache Storage, on the client, not the server.

### Software

Versions are read from the files that enforce them, so they cannot drift from this page
without the check failing.

| Tool | Required | Enforced by |
|---|---|---|
| Docker Engine | any currently supported release, daemon running | `scripts/bootstrap.sh` runs `docker info` |
| Docker Compose | **v2 plugin, ≥ 2.24.0** (v1 `docker-compose` is unsupported) | `scripts/bootstrap.sh`; `docker-compose.yml` uses `env_file: {path, required}` and `depends_on: service_completed_successfully` |
| Node | **20.x** (pinned `20.18.0`) | [`.nvmrc`](../.nvmrc); CI builds on 20; `bootstrap.sh` fails below 20 and warns above 21 |
| pnpm | **9.x** (pinned `pnpm@9.12.0`) | `packageManager` in [`package.json`](../package.json), delivered through corepack |
| Python | **≥ 3.11** | `requires-python = ">=3.11"` in [`apps/api/pyproject.toml`](../apps/api/pyproject.toml); `ruff`/`mypy` target `py311` |

Check all of them at once:

```bash
scripts/bootstrap.sh --check-only
```

> **Current status.** `scripts/bootstrap.sh`, `scripts/reset.sh` and
> `scripts/check-contracts.sh` compute their repository root as
> `$(dirname "${BASH_SOURCE[0]}")/../..`, which resolves one directory *above* the
> repository now that the scripts live in `scripts/` rather than `infra/scripts/`.
> Until that is fixed the scripts abort (`check-contracts.sh` reports
> `missing packages/shared/src/events.ts`). Use the explicit commands in Path 2 and
> Path 3 below, which are verified against `package.json`, `docker-compose.yml` and
> `apps/api/pyproject.toml` and do not depend on the scripts. Tracked in
> [`roadmap.md`](roadmap.md).

### Node and pnpm

```bash
nvm use
```

```bash
COREPACK_INTEGRITY_KEYS=0 corepack enable pnpm
```

The `COREPACK_INTEGRITY_KEYS=0` prefix is required on machines whose bundled corepack
ships stale npm signing keys — without it you get `Cannot find matching keyid`. See
[`troubleshooting.md`](troubleshooting.md#corepack-cannot-find-matching-keyid) and
[`development.md`](development.md#toolchain).

## Path 1 — Docker Compose quick start

Everything in containers: data plane plus API, worker and web built from
`infra/docker/*.Dockerfile`. Slowest to start, closest to production, no host toolchain
beyond Docker.

```bash
cp .env.example .env
```

```bash
docker compose --env-file .env --profile app up -d --build
```

The first build compiles the Next.js app and installs the Python dependencies, so expect
several minutes. `NEXT_PUBLIC_*` values are **build arguments** for the web image (Next.js
inlines them), so changing them later requires `--build` again — see
[`configuration.md`](configuration.md#changing-configuration-safely).

Then apply the schema inside the API container:

```bash
docker compose --env-file .env exec -T api alembic -c app/db/alembic.ini upgrade head
```

And seed the demo dataset (spec §59):

```bash
docker compose --env-file .env exec -T api python - < database/seeds/seed.py
```

### Verify

```bash
docker compose --env-file .env --profile app ps
```

A healthy run looks like this — six long-running services `Up (healthy)` and the one-shot
bucket initialiser `Exited (0)`:

```text
NAME                     SERVICE      STATUS
ai-coach-api             api          Up 2 minutes (healthy)
ai-coach-minio           minio        Up 3 minutes (healthy)
ai-coach-minio-init      minio-init   Exited (0) 3 minutes ago
ai-coach-postgres        postgres     Up 3 minutes (healthy)
ai-coach-qdrant          qdrant       Up 3 minutes (healthy)
ai-coach-redis           redis        Up 3 minutes (healthy)
ai-coach-web             web          Up 1 minute (healthy)
ai-coach-worker          worker       Up 2 minutes (healthy)
```

Anything `(unhealthy)` or `(health: starting)` for more than the service's `start_period`
is covered in [`troubleshooting.md`](troubleshooting.md#docker-health-checks-fail-in-dependency-order).

| Check | Command or URL | Expected |
|---|---|---|
| Web app | <http://localhost:3000> | the login page renders |
| API liveness | `curl -fsS http://localhost:8000/healthz` | `{"status":"ok","version":"…","app_env":"local"}` |
| API readiness | `curl -fsS http://localhost:8000/readyz` | `200` with `ok: true` for `postgres`, `redis`, `qdrant`, `object_storage` |
| OpenAPI | <http://localhost:8000/docs> | Swagger UI (disabled when `APP_ENV=production`) |
| Qdrant | <http://localhost:6333/dashboard> | Qdrant dashboard |
| MinIO console | <http://localhost:9001> | login with `S3_ACCESS_KEY` / `S3_SECRET_KEY` |

> **Current status.** The API image's `HEALTHCHECK` and the compose probe both request
> `/health/ready`, but `apps/api/app/api/health.py` mounts `/healthz` and `/readyz`. Until
> one side moves, start the containers with `API_READY_PATH=/readyz` in your `.env` (the
> Dockerfile reads it as an env default) or expect the `api` container to sit `unhealthy`
> and the `web` service never to start, since it waits on `api: service_healthy`.

## Path 2 — stack in Docker, app processes on the host

The everyday development setup: data plane in containers, API and web on the host with hot
reload. This is what `pnpm infra:up` is for — the default compose profile contains only
`postgres`, `redis`, `qdrant`, `minio` and `minio-init`.

```bash
cp .env.example .env
```

```bash
pnpm infra:up
```

```bash
pnpm install
```

```bash
python3 -m venv apps/api/.venv
```

```bash
apps/api/.venv/bin/pip install -e 'apps/api[dev]'
```

Apply the schema. Alembic **must** be run from `apps/api`, because
`apps/api/app/db/alembic.ini` sets `script_location = ../../database/migrations` and
`prepend_sys_path = .`, and `database/migrations/env.py` imports `app.core.config` and
`app.db.base`:

```bash
cd apps/api && ../../apps/api/.venv/bin/alembic -c app/db/alembic.ini upgrade head
```

Seed the demo dataset:

```bash
python3 database/seeds/seed.py
```

Run the two processes in two terminals:

```bash
pnpm dev
```

```bash
pnpm api:dev
```

`pnpm dev` is `pnpm --filter @ai-coach/web dev` (Next.js dev server on port 3000).
`pnpm api:dev` is `cd apps/api && uvicorn app.main:app --reload --port 8000`.

### Verify

```bash
docker compose --env-file .env ps
```

Expect four services `Up (healthy)` and `ai-coach-minio-init` `Exited (0)`; the `api`,
`worker`, `web` and `proxy` rows are absent because their profiles are not active.

| Check | Command or URL | Expected |
|---|---|---|
| Web app | <http://localhost:3000> | login page; sign in with a demo user below |
| API readiness | `curl -fsS http://localhost:8000/readyz` | all four dependencies `ok: true` |
| Contract guard | `bash scripts/check-contracts.sh` | see the Current-status note above |

If the web app is reachable but every list is populated with plausible-looking data and the
live simulation plays a scripted conversation, you are in mock mode — see
[`troubleshooting.md`](troubleshooting.md#the-simulation-runs-but-there-is-no-backend).

### Optional: the async worker

The document pipeline (parse → chunk → embed → index) and the retention sweeps run on
Celery with Redis as broker and result backend. On the host:

```bash
cd apps/api && ../../apps/api/.venv/bin/celery -A app.workers.celery_app worker --loglevel info --queues documents,evaluation,maintenance
```

> **Current status.** `app/workers/queue.py` also provides an in-process `inline` queue
> used for development and CI, so uploads progress without a worker running; see
> [`roadmap.md`](roadmap.md).

## Path 3 — fully local

No Docker at all. Useful on a locked-down machine, or when you already run Postgres and
Redis. You supply four services yourself:

| Service | Version used by the project | Notes |
|---|---|---|
| PostgreSQL | 16 | the API requires the async driver: `DATABASE_URL` must start `postgresql+asyncpg://` |
| Redis | 7 | cache, rate-limit buckets, Celery broker, WS pub/sub fan-out |
| Qdrant | v1.12.4 | vectors only; never in Postgres (spec §74) |
| S3-compatible object storage | MinIO `RELEASE.2024-10-13…` | uploaded documents, report PDFs, session audio |

Create the role, database and bucket to match `.env`:

```sql
CREATE ROLE aicoach LOGIN PASSWORD 'aicoach';
CREATE DATABASE aicoach OWNER aicoach;
CREATE DATABASE aicoach_test OWNER aicoach;
```

Point the app at them by editing `.env` (see [`configuration.md`](configuration.md)), then
follow Path 2 from `pnpm install` onwards, skipping `pnpm infra:up`.

If you have no object storage at all, uploads and report export will fail while everything
else works; `/readyz` will return `503` with `object_storage.ok = false`, which is the
intended signal rather than a silent degradation.

### Verify

```bash
curl -fsS http://localhost:8000/readyz | python3 -m json.tool
```

Every entry in `dependencies` should have `"ok": true`. A `false` entry carries a
`detail` field naming the exception type — never a connection string, by design.

## Demo users

Seeded by `database/seeds/seed.py`, one per role (spec §9):

| Email | Roles |
|---|---|
| `trainee@demo.ai-coach.local` | trainee |
| `coach@demo.ai-coach.local` | coach, reviewer |
| `manager@demo.ai-coach.local` | manager, coach |
| `admin@demo.ai-coach.local` | admin |

Password for all four: `demo-only-not-a-secret`. Local development only — these accounts
must never exist in a deployed environment.

## Resetting

Stop the stack, keep the data:

```bash
pnpm infra:down
```

Destroy the data (Postgres rows, Qdrant collections, MinIO objects, the Redis AOF) and
start clean:

```bash
docker compose --env-file .env down -v
```

Re-embedding a large knowledge base after this costs real money when `EMBEDDING_MODEL` is
an API model — see [`model.md`](model.md#api-models-hosted-not-self-hostable).

## Known constraints

- **This machine's Python is 3.14; the project targets ≥ 3.11.** `ruff` and `mypy` are
  configured for `py311` and both Python images build on `python:3.11-slim-bookworm`, so
  3.11 is the supported interpreter. 3.14 will parse the code, but some scientific and
  native wheels in the dependency set (and in `services/inference`: `onnxruntime`,
  `tokenizers`, `numpy`) may not yet publish cp314 wheels, in which case pip falls back to
  building from source and fails without a full toolchain. Create the virtualenv with an
  explicit 3.11 interpreter where one is available:

  ```bash
  python3.11 -m venv apps/api/.venv
  ```

  See [`troubleshooting.md`](troubleshooting.md#python-314-wheel-gaps).

- **This machine's Node is 22.x; `.nvmrc` pins 20.18.0.** `bootstrap.sh` warns rather
  than failing, and the warning is worth heeding: CI builds on 20, so a local-only
  failure on 22 may not reproduce there, and the reverse is also true.

- **Model weights are not in git.** `models/` holds the manifest and a README, never
  `.onnx` files, and `data/` is `.gitignore`d wholesale. See
  [`model.md`](model.md#where-weights-live) and [`dataset.md`](dataset.md).

- **`pnpm-lock.yaml` must be committed.** CI installs with `--frozen-lockfile` and cannot
  run without it. See [`development.md`](development.md#dependencies-and-the-lockfile).
