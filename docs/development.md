# Development

The day-to-day guide: how to get the repository running, how to change something
without breaking the other language, and the five recipes that cover most of the work.

This page assumes you have already read [`CONTRIBUTING.md`](../CONTRIBUTING.md) — it
carries the rules; this one carries the commands.

## Contents

- [Prerequisites and first-time setup](#prerequisites-and-first-time-setup)
- [The pnpm quirk on this machine](#the-pnpm-quirk-on-this-machine)
- [The layout in one screen](#the-layout-in-one-screen)
- [Running things locally](#running-things-locally)
- [The cross-language contract workflow](#the-cross-language-contract-workflow)
- [Testing](#testing)
- [Conventions that already hold](#conventions-that-already-hold)
- [Five recipes](#five-recipes)

## Prerequisites and first-time setup

[`installation.md`](installation.md) is authoritative for versions, Homebrew commands
and the `.env` starting point. Do not duplicate it here — read it, then come back.

The short version, once PostgreSQL and Redis are running:

```bash
cp .env.example .env
scripts/bootstrap.sh
```

`scripts/bootstrap.sh` is idempotent. It installs the pnpm workspace and the Python
package (editable, with `[dev]`), checks that PostgreSQL and Redis are reachable —
plus Qdrant when `VECTOR_BACKEND=qdrant` — runs `alembic upgrade head`, and seeds the
demo data. It installs **no** system services and starts nothing.

Two flags worth knowing:

```bash
scripts/bootstrap.sh --check-services   # only probe the endpoints in .env
scripts/bootstrap.sh --no-seed          # skip demo data
```

There is no Docker path. That is a decision, not an omission — see
[ADR-0009](adr/0009-systemd-over-docker-deployment.md).

## The pnpm quirk on this machine

Corepack ships a pinned set of signing keys, and on an older corepack those keys are
stale relative to the current npm registry signatures. The symptom is a hard failure
on any `pnpm` invocation routed through corepack:

```text
Error: Cannot find matching keyid: {"signatures":[...],"keyid":"SHA256:..."}
```

Two workarounds, both fine:

```bash
# 1. Tell corepack to skip signature verification for this invocation
COREPACK_INTEGRITY_KEYS=0 corepack pnpm install
COREPACK_INTEGRITY_KEYS=0 corepack pnpm -r typecheck

# 2. Or install pnpm directly and stop going through corepack at all
npm i -g pnpm@9.12.0
```

`package.json` pins `packageManager: pnpm@9.12.0`, so whichever route you take, the
version is the same one CI uses. This cost real debugging time once; it is written
down so it costs nobody else any.

## The layout in one screen

[`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md) is **the authoritative ownership map**,
and §5 of it assigns subtrees to owners. Check it before you create a file. This is
only the orientation sketch.

```text
apps/
  web/                Next.js 15 app — routes and layout in src/app/,
                      business logic in src/features/
  api/                FastAPI — the AI orchestration API and its worker
packages/
  shared/             cross-language contracts; zero runtime dependencies
  design-tokens/      the only place a colour is allowed to be defined
  ui/                 the glass component library; no business semantics
  ai-runtime/         WebGPU / WASM / server inference chain; no UI
services/
  inference/          server-side ONNX embedding + reranking
  avatar-runtime/     local avatar (LivePortrait + MuseTalk) — see ADR-0010
database/             migrations and seeds
infra/                systemd units, nginx config
scripts/              bootstrap.sh, check-contracts.sh
docs/                 this directory; docs/spec/ is the product source of truth
```

The boundaries that get crossed most often — generic components belong in
`packages/ui`, routers do I/O conversion only, `packages/shared` stays
dependency-free — are listed with their reasons in
[`CONTRIBUTING.md` §1](../CONTRIBUTING.md#1-the-ownership-map).

## Running things locally

### The web app

```bash
COREPACK_INTEGRITY_KEYS=0 corepack pnpm dev     # → http://localhost:3000
```

That is `pnpm --filter @ai-coach/web dev`. **Run exactly one of these.** Two
`next dev` processes writing the same `.next/` directory corrupt the build manifest
and the app starts serving 500s and unstyled HTML — see
[`troubleshooting.md`](troubleshooting.md#the-web-app-renders-as-unstyled-text).

### The API

The API runs out of its own virtualenv at `apps/api/.venv`, created by
`bootstrap.sh`. The root script wraps it:

```bash
pnpm api:dev
# = cd apps/api && .venv/bin/uvicorn app.main:app --reload --port 8000
```

Verify it:

```bash
curl -fsS http://localhost:8000/healthz     # liveness, touches no dependency
curl -fsS http://localhost:8000/readyz      # readiness, probes enabled deps only
open http://localhost:8000/docs             # OpenAPI; disabled when APP_ENV=production
```

`/readyz` probes only what is *enabled*: always PostgreSQL and Redis, Qdrant only
when `VECTOR_BACKEND=qdrant`, object storage only when `OBJECT_STORAGE_ENABLED=true`.
A local checkout with `VECTOR_BACKEND=memory` is expected to be ready with neither.

### The worker

The Celery worker is what `infra/systemd/ai-coach-worker.service` runs, and the same
command works locally:

```bash
cd apps/api
.venv/bin/celery -A app.workers.queue:get_celery worker --loglevel=INFO \
  --queues=documents,evaluation,mining,maintenance
```

### The `services/*`

Each service under `services/` is a standalone Python package with its own venv, its
own `pyproject.toml` and its own config module — they are deliberately *not* part of
the API's dependency graph, and no browser ever talks to either of them directly.

```bash
python3 -m venv services/inference/.venv
services/inference/.venv/bin/pip install -e 'services/inference'

python3 -m venv services/avatar-runtime/.venv
services/avatar-runtime/.venv/bin/pip install -e 'services/avatar-runtime'
```

The root package.json wraps each one:

| Command | Service | Port |
|---|---|---|
| `pnpm inference:dev` | `services/inference` — ONNX embedding and reranking | 8770 |
| `pnpm avatar:dev` | `services/avatar-runtime` — local avatar (ADR-0010) | 8765 |
| `pnpm avatar:verify` | avatar install check (`scripts/verify_install.py`) | — |
| `pnpm avatar:bench` | avatar benchmark (`scripts/benchmark.py`) | — |

Both bind `127.0.0.1` on purpose: they are reached from `apps/api` on the same host,
never from the edge.

> **Current status.** Both services are being written right now, and neither has an
> `app/main.py` yet — so both `pnpm inference:dev` and `pnpm avatar:dev` will fail to
> import until the HTTP layer lands. `services/inference/` currently has its config,
> registry, session pool, loader, pre/post-processing and metrics modules plus an
> empty `app/api/`; `services/avatar-runtime/` has `app/core/config.py`. Until the
> inference service serves `/embed` and `/rerank`, `apps/api` uses `ApiEmbedder` or
> the deterministic `LexicalReranker` fallback. See [`model.md`](model.md) and
> [`roadmap.md`](roadmap.md).

## The cross-language contract workflow

This is the section to read twice. The realtime contract is declared **twice, in two
languages**, and no toolchain can see both:

| File | Role |
|---|---|
| `packages/shared/src/events.ts` | **the single source of truth** |
| `apps/api/app/domain/events.py` | a hand-maintained Pydantic **mirror** |
| `scripts/check-contracts.sh` | the drift guard |

`tsc` never sees the Python and `mypy` never sees the TypeScript. So a mismatch does
not fail a build — it produces a backend that emits `score.update` while the frontend
reduces `score.updated`, the event falls through the default case, and the live score
panel is quietly empty for some sessions. Both test suites pass. Nobody notices for a
month. TypeScript wins, always
([ADR-0002](adr/0002-typescript-as-contract-source-of-truth.md)).

### The rule

```text
1. Change  packages/shared/src/events.ts        ← the source of truth, first
2. Mirror  apps/api/app/domain/events.py        ← identical field names,
                                                   identical literal values
3. Run     scripts/check-contracts.sh           ← must pass
4. Commit  both in the SAME commit              ← never one without the other
```

```bash
scripts/check-contracts.sh          # fails on drift, either direction
scripts/check-contracts.sh --list   # print both sets side by side
pnpm check:contracts                # the same thing, from the root
```

A passing run today looks like this:

```text
✓ streaming-event contract in sync — 26 literals match across TS and Python
```

Those 26 are the 18 `StreamingEvent` types plus the 8 `ClientCommand` types; the
reference tables for both are in [`api.md`](api.md#streamingevent-reference).

### What a failure looks like, in each direction

The guard compares two *sets* of `type:` discriminant literals and reports each
direction separately, because the two failures are different bugs.

**Declared in TypeScript, missing in Python.**

```text
✗ declared in TypeScript but NOT mirrored in Python:
      score.updated

  The backend cannot emit these, so the frontend reducer for them is
  dead code. Add them to apps/api/app/domain/events.py.
```

The UI branch you just wrote will never run. Nothing throws; the feature is simply
inert, and it looks like a frontend bug for as long as you believe the backend is
sending the event.

**Present in Python, missing in TypeScript.**

```text
✗ present in Python but NOT declared in TypeScript:
      session.warning

  §55 says neither side may invent an undeclared event. If the backend
  emits one of these, the frontend will drop it silently.
```

This is the worse direction. The backend emits a frame that no client can handle:
`apps/web/src/lib/ws-client.ts` validates against the declared union and drops
anything outside it. Part I §55 forbids either side inventing an undeclared event,
and the fix is never "add it to the TypeScript to make the guard green" — it is to
declare it in TypeScript **first**, deliberately, then mirror it back.

### What the guard does not catch

It compares literals, not shapes. A renamed field inside `PersonaSimulationState`
passes. So does a Python model whose field types have drifted from the TypeScript
interface. Two partial mitigations exist — `database/seeds/seed.py` round-trips its
whole payload through the Pydantic models, and the PR template asks explicitly — but
a contract change is still a reviewer's responsibility. A JSON-fixture round-trip
test in both languages is the proper fix and is Phase 1 work.

Three mirror rules that trip people up:

- **Field names are byte-identical.** Python naming convention does not apply to wire
  fields. The field is `hidden_need` because that is what the TypeScript says.
- **Enum literal *values* are byte-identical.** The Python `StrEnum` member *name*
  may differ; its value may not.
- **A wire field colliding with a Python keyword is aliased**, preserving the wire
  name. `runtime.fallback` carries a field literally named `from`; the Pydantic model
  aliases it and the JSON stays `from`.

## Testing

Run all of this before pushing. It is the same set CI runs.

```bash
COREPACK_INTEGRITY_KEYS=0 corepack pnpm -r typecheck
COREPACK_INTEGRITY_KEYS=0 corepack pnpm -r lint

cd apps/api
.venv/bin/ruff check . && .venv/bin/ruff format --check .
.venv/bin/mypy
.venv/bin/python -m pytest -q
cd ../..

scripts/check-contracts.sh
```

**API tests: 242 currently pass** (`apps/api/tests/`, 10 modules) covering the agent
layer, the chunker, the event emitter, intent handling, the knowledge boundary, the
MiniMax client, the session service and vector-store tenant isolation. A useful
narrow run while iterating:

```bash
cd apps/api && .venv/bin/python -m pytest -q tests/test_vectorstore_isolation.py
```

CI provisions native PostgreSQL and Redis. Qdrant-dependent tests require an
explicitly provisioned endpoint and are skipped otherwise — which means a green local
run is not proof that the Qdrant path works.

The `services/*` packages carry their own suites and their own venvs; run them from
inside the service directory with that service's interpreter, not the API's.

## Conventions that already hold

These are not aspirations. They are true of the current tree, and a change that
breaks one of them is a review comment.

- **No hex colour literals outside `packages/design-tokens`** (Part II §99). That
  covers hex, `rgb()`, `hsl()`, named CSS colours and Tailwind's default palette —
  all of them bypass the token system. The same applies to blur radii, shadows,
  corner radii and spacing steps. Need a colour that does not exist? Add a token;
  that is a `design-tokens` change with its own review, which is the right amount of
  friction.
- **Business logic lives in `features/` and `services/`.** `apps/web/src/app/` holds
  routes and layout only. API routers do I/O conversion only — a router with a `for`
  loop over domain objects is in the wrong place, and LLM behaviour belongs in
  `agents/`.
- **Agents return validated structured output.** `Agent[InT, OutT]` in
  `apps/api/app/agents/base.py` is generic over a Pydantic request and response
  model; an agent does not hand raw model text to a caller.
- **Tenant isolation is enforced by construction, not by convention.** Every
  tenant-scoped table carries both `tenant_id` and `workspace_id`; `TenantScope` in
  `app/rag/vectorstore.py` raises `TenantIsolationError` in `__post_init__` when
  either is blank, and the Qdrant filter builder refuses an unscoped filter outright.
  A cross-tenant read returns **`404 not_found`**, never `403`, so the API does not
  confirm that the resource exists.
- **No provider credential moves closer to the browser.** Nothing credential-shaped
  in `NEXT_PUBLIC_*` — Next.js inlines that namespace into the client bundle, so the
  *name* alone is the violation, and CI fails on it.

## Five recipes

### 1. Add a REST route

1. Find or create the router module in `apps/api/app/api/v1/routers/`.
2. Declare a `Permission`, never a role. The Part I §9 matrix lives in exactly one
   place: `ROLE_PERMISSIONS` in `app/core/deps.py`. An endpoint with no explicit
   requirement is a bug, not a permissive default.
3. Declare request and response models in `app/domain/` — the OpenAPI document is
   generated from them, which is why it cannot drift from the implementation.
4. Put the work in a service, not the handler. Give it a per-route rate-limit budget.
5. Mount it in `app/api/v1/__init__.py`. Literal paths go **before** parameterised
   ones so `/scenarios/rubrics` is not shadowed by `/scenarios/{scenario_id}`.
6. Add the row to [`api.md`](api.md#resource-routes).

### 2. Add a web feature

1. `apps/web/src/features/<feature>/` — components, hooks and local state together.
2. The route in `apps/web/src/app/` does nothing but compose the feature and set
   layout. If it fetches and transforms, the logic is in the wrong file.
3. Generic visuals come from `packages/ui`. A `Button` in a feature folder is how a
   second, divergent design system starts
   ([ADR-0003](adr/0003-custom-design-system-over-shadcn-theme.md)).
4. Server state through TanStack Query, live session state through the Zustand store
   ([ADR-0007](adr/0007-zustand-and-tanstack-query.md)).
5. Check both themes and `system`. Dark mode is an authored design, not an inversion.

### 3. Add a domain entity

1. `packages/shared/src/entities.ts` **first** — it is the source of truth.
2. Mirror it into `apps/api/app/domain/`, byte-identical field names.
3. Add the SQLAlchemy model under `apps/api/app/db/models/`, extending the tenancy
   mixin: both `tenant_id` and `workspace_id`, non-nullable, with an index that leads
   with them.
4. Write the migration in `database/migrations/`.
5. **Write the denial test**, not the happy path: assert that tenant A cannot read
   tenant B's row. Untested isolation is not isolation.

### 4. Add an agent

1. Subclass `Agent[InT, OutT]` in `apps/api/app/agents/`, implementing
   `system_prompt()`, `build_user_prompt()` and `run()`.
2. Prompts go in `apps/api/app/agents/prompts/` as their own module — they are
   reviewable content, not string literals buried in logic.
3. The output type is a Pydantic model. Structured output is the contract between the
   agent and everything downstream; a bare string is not one.
4. Reach the provider through `agents/llm_client.py`. Never call a provider SDK
   directly from a router or a service.
5. An agent that produces a score or a finding must produce **evidence** with it —
   Part I §27 forbids a bare number, and a `ComplianceFinding` without a transcript
   quote and a policy rule is not reviewable.

### 5. Add a streaming event

The one change that spans both languages. Follow
[the contract workflow](#the-cross-language-contract-workflow) exactly.

1. Add the variant to the `StreamingEvent` union in
   `packages/shared/src/events.ts`, with its `type:` literal on the same line as the
   key — the extractor is a grep, and that is the house style in both files anyway.
2. Mirror it in `apps/api/app/domain/events.py` as
   `type: Literal["x.y"] = "x.y"`.
3. `scripts/check-contracts.sh` — the literal count should go from 26 to 27.
4. Handle it in `apps/web/src/lib/ws-client.ts` and the session store. An event with
   no consumer is a frame the client validates and drops.
5. If `apps/web/src/features/simulation/mock/mock-event-stream.ts` should emit it,
   add it there too — the mock is a consumer of the contract, not an exception to it.
6. Document it in [`api.md`](api.md#streamingevent-reference) and commit everything
   together.
