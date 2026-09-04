# AI Coach

**An AI Training Infrastructure for enterprises.**

Not "enterprise ChatGPT". The spec is explicit about the difference (Part I
§61): this platform integrates enterprise knowledge, expert experience, dynamic
character scenarios, realistic voice, multi-agent AI, capability assessment,
personalised learning and safety governance into something deployable at scale.

What a user sees: **an AI-simulated person, a real conversation, live
interaction.**

What the enterprise actually gets: **standardised knowledge, standardised
training, quantified assessment, traceable compliance, workforce capability as
data, and an automated learning loop.**

> **Status:** this repository contains the architecture, the cross-language
> contracts, the design system and a scaffolded implementation — **not a
> production system.** The live simulation currently runs against a mock event
> stream. Read [`docs/ROADMAP.md`](docs/ROADMAP.md) before evaluating it.

---

## What it does

A trainee holds a spoken or typed conversation with a simulated customer who has
a personality, a hidden need, a budget, objections and a reason to say no. The
customer is driven by a persona built from real product knowledge, and the whole
exchange is scored against a rubric with evidence attached to every number.

| Capability | Detail |
|---|---|
| **Knowledge base** | Upload PDF/DOCX/PPTX/CSV/HTML, parse, OCR when scanned, structure-aware chunking, versioning, embedding, vector index, and a citation for every knowledge claim |
| **Persona builder** | Personality sliders, hidden need, trigger points, objections, forbidden knowledge, exit conditions, voice configuration, and a test lab |
| **Scenario builder** | A nine-step wizard: objectives, required talking points, key objections, restricted topics, success and failure conditions, difficulty, training or assessment mode |
| **Multi-agent simulation** | Seven agents — Orchestrator, Scenario Director, Customer, Knowledge, Coach, Compliance, Evaluator — each returning structured data, not prose |
| **Realistic voice** | Streaming STT, streaming TTS, WebRTC, VAD, barge-in, push-to-talk, captions, device selection |
| **Evaluation** | Ten skill dimensions, each with a score, a confidence, a rubric note, **transcript-quoted evidence** and an improvement suggestion. A bare number is forbidden |
| **Compliance** | False promises, misleading statements, unsupported claims, PII, unauthorised advice, missing disclosure, prompt injection, restricted topics — each finding cites its policy rule |
| **Closed loop** | Weakness → knowledge gap → recommended next scenario and material |
| **Team management** | Assignments, deadlines, pass rules, dashboards, skill profiles over time |
| **Client acceleration** | WebGPU → WASM → server, in a Worker, with the server always authoritative for safety, reranking and scoring |
| **Security** | RBAC, tenant isolation, audit log, PII handling, retention. No API key ever reaches the browser |

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 15 (App Router), React 18, TypeScript | [ADR-0006](docs/adr/0006-fastapi-alongside-nextjs.md) |
| UI | Custom design system on Radix primitives + Tailwind + CSS variables | [ADR-0003](docs/adr/0003-custom-design-system-over-shadcn-theme.md) |
| Client state | Zustand · Server state: TanStack Query | [ADR-0007](docs/adr/0007-zustand-and-tanstack-query.md) |
| Client inference | ONNX Runtime Web in a Worker — WebGPU / WASM / server | [ADR-0004](docs/adr/0004-webgpu-as-acceleration-layer.md) |
| AI orchestration | Python 3.11 · FastAPI · Pydantic v2 | [ADR-0006](docs/adr/0006-fastapi-alongside-nextjs.md) |
| Database | PostgreSQL 16 · SQLAlchemy 2 · Alembic | — |
| Vectors | Qdrant | [ADR-0005](docs/adr/0005-qdrant-as-production-vector-store.md) |
| Cache / queue | Redis 7 · Celery | — |
| Object storage | S3-compatible (MinIO locally) | — |
| AI services | OpenAI (LLM, STT/TTS) · ElevenLabs (TTS) · AMD AUP (private inference) | — |
| Edge | nginx — TLS, WebSocket upgrade, security headers, cross-origin isolation | [`infra/docker/nginx.conf`](infra/docker/nginx.conf) |
| Monorepo | pnpm workspace for JS; `apps/api` standalone | [ADR-0001](docs/adr/0001-pnpm-workspace-plus-separate-python-app.md) |

---

## Repository layout

One line per directory. [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md)
is the **authoritative** map of where a file goes and who owns it — check it
before adding one.

```text
apps/
  web/                  Next.js frontend — the only user-facing app
  api/                  FastAPI AI orchestration API, agents, RAG, workers
packages/
  shared-types/         cross-language contracts: entities, streaming events, state machines
  design-tokens/        Soft Aurora tokens — light/dark CSS vars, Tailwind preset
  ui/                   glassmorphism component library (Radix behaviour, custom skin)
  ai-runtime/           WebGPU → WASM → server inference abstraction
infra/
  docker-compose.yml    the local stack; profiles for app and proxy
  docker/               web / api / worker images, nginx config, postgres init
  scripts/              bootstrap · seed · reset · check-contracts
docs/
  spec/                 the specification. Authoritative for what the product must do
  PROJECT_STRUCTURE.md  ownership map. Authoritative for where files go
  ARCHITECTURE.md       how the pieces fit together
  ROADMAP.md            what is actually built. Honest
  adr/                  why each decision was made, and what it cost
.github/workflows/      CI and security scanning
```

---

## Quickstart

### Prerequisites

| Tool | Version | Note |
|---|---|---|
| Docker + Compose v2 | Compose ≥ 2.24 | `docker compose version` |
| Node | 20.x | `nvm use` reads [`.nvmrc`](.nvmrc) |
| pnpm | 9.x | `corepack enable` — the version is pinned in `package.json` |
| Python | ≥ 3.11 | `apps/api` uses PEP 604 unions and `StrEnum` |

`infra/scripts/bootstrap.sh --check-only` verifies all four and tells you
exactly what is wrong if not.

### One command

```bash
infra/scripts/bootstrap.sh
```

Idempotent. It copies `.env.example` → `.env` if absent, starts the data plane,
waits for every service to report *actually* healthy, applies migrations, seeds
the demo dataset, and runs the contract drift check.

### Or step by step

```bash
# 1. Environment. Provider keys may stay blank — the stack boots without them,
#    but live LLM turns and TTS will not work.
cp .env.example .env

# 2. Data plane: postgres 5432 · redis 6379 · qdrant 6333 · minio 9000/9001
pnpm infra:up

# 3. JavaScript dependencies. Creates/updates pnpm-lock.yaml — commit it,
#    CI installs with --frozen-lockfile and cannot run without it.
pnpm install

# 4. Python dependencies
python3 -m venv apps/api/.venv
apps/api/.venv/bin/pip install -e 'apps/api[dev]'

# 5. Schema
cd apps/api && ../../apps/api/.venv/bin/alembic upgrade head && cd ../..

# 6. The §59 demo dataset
python3 infra/scripts/seed.py

# 7. Two processes, two terminals
pnpm dev        # web → http://localhost:3000
pnpm api:dev    # api → http://localhost:8000  (OpenAPI at /docs)
```

Useful extras:

```bash
infra/scripts/bootstrap.sh --with-app     # run api + worker + web as containers
infra/scripts/bootstrap.sh --with-proxy   # add nginx with a self-signed cert
infra/scripts/check-contracts.sh          # TS ↔ Pydantic drift, both directions
infra/scripts/reset.sh                    # DESTROY volumes and re-bootstrap
pnpm infra:down                           # stop the stack, keep the data
```

### Demo users

Seeded by `infra/scripts/seed.py`, one per role:

| Email | Roles |
|---|---|
| `trainee@demo.ai-coach.local` | trainee |
| `coach@demo.ai-coach.local` | coach, reviewer |
| `manager@demo.ai-coach.local` | manager, coach |
| `admin@demo.ai-coach.local` | admin |

Password for all four: `demo-only-not-a-secret`. Local development only.

---

## Demo walkthrough

The scenario the spec designs the product around — Part I §59, insurance sales.

**The persona: 陳先生**

> 38, software engineer, married, two children.
> Rational · price-sensitive · family-oriented · skeptical.
>
> **Main objection:** 「我已經有保險了，為什麼還要多買？」
> *("I already have insurance. Why would I buy more?")*
>
> **Hidden need:** worried about his family's financial protection after a major
> incident — if he lost his ability to work, nobody would carry the mortgage or
> the children's education.

He does not volunteer the hidden need. He states the objection, checks how long
this will take, and starts with trust at 32 and resistance at 70.

**Success requires all five** (§59, unchanged):

```text
完成需求探索                        needs discovery complete
+ 正確說明保障                      coverage explained correctly
+ 不產生 Critical Compliance Risk   no critical compliance risk
+ Trust >= 70
+ Overall Score >= 80
```

**The walkthrough**

1. **Upload** a product PDF into the knowledge base. Watch it move through
   `uploaded → validating → parsing → chunking → embedding → indexing → ready`.
2. **Inspect** the chunks, then use the Retrieval Playground to see what a query
   actually retrieves — with similarity and rerank scores.
3. **Open the persona** as a coach and see the hidden state a trainee cannot:
   the hidden need, the trigger points, the exit condition.
4. **Start the scenario** in training mode with voice on. The runtime badge
   shows WebGPU, WASM or Server, honestly.
5. **Talk.** Partial transcript streams as you speak. Left column: the
   conversation, as a document rather than chat bubbles. Right column: 陳先生's
   live state — phase, emotion, trust, interest, resistance, patience.
6. **Push a product** before discovering his needs, and watch resistance climb.
   Ask about the mortgage and the children's education instead, and watch trust
   move.
7. **He raises the objection.** How you handle it moves the state, and the
   Scenario Director may escalate difficulty in response.
8. **A knowledge claim carries a citation** — document, version, page, section,
   snippet. Click through to the chunk.
9. **Trip a compliance rule** deliberately: say something is guaranteed. A
   compliance warning arrives mid-session with the rule it violated.
10. **End the session.** The Evaluator scores all ten dimensions. Every score
    expands to the transcript quote behind it, the issue, and a better approach.
11. **Read the compliance report** and the recommended next training — the
    closed loop of Part I §33.
12. **Replay** the session with the persona-state timeline alongside the
    transcript.

The demo is designed to show, in one pass: PDF upload, RAG, citation, persona,
dynamic scenario, voice, multi-agent, the WebGPU badge, evaluation, compliance,
report and adaptive next training.

---

## Current status

**Honest summary.** The contracts, the design system, the client inference
runtime and the agent prompt layer are real. The API has its foundations —
config, security, tenancy, audit, rate limiting, domain models, database models
— but no application yet: no `main.py`, no migrations, one router out of
eighteen, no document pipeline, no worker. The web app has a real shell, a real
component library and a live-simulation UI that is convincing **because it runs
against a mock event stream**, and most pages read typed fixtures rather than the
API.

Phase 1 is not about designing anything further. It is about deleting
`apps/web/src/features/simulation/mock/mock-event-stream.ts` and the fourteen
fixture files, one call site at a time, until the §59 demo runs on real services.

Full per-module status, the §60 acceptance matrix and the §100 final acceptance
definition, all with honest per-row status: **[`docs/ROADMAP.md`](docs/ROADMAP.md)**.

One precondition worth checking before you push: CI installs with
`pnpm install --frozen-lockfile`, so **`pnpm-lock.yaml` must be committed**. If
`git ls-files pnpm-lock.yaml` comes back empty, run `pnpm install` and commit
it — CI's `web` job and `pnpm audit` cannot run without it. See the comment at
the top of the `web` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
for why this is not softened to a plain `pnpm install`.

---

## Security

**No API key ever reaches the browser.** Part I §56 and Part II §70/§71 make
this a requirement, and it is the rule with the least room for judgement in the
codebase.

```text
Browser → BFF → AI Orchestration → OpenAI          (Part II §70)
Browser → Voice Session Service → ElevenLabs        (Part II §71)
```

- `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` and `JWT_SECRET` are read only by the
  API process, typed as `SecretStr` so they cannot be serialised into a response.
- Outside `APP_ENV=local`, the API **refuses to boot** with a placeholder
  `JWT_SECRET` or a missing key for an enabled provider.
- `NEXT_PUBLIC_*` is inlined into the client bundle by Next.js, so anything in
  that namespace is public by construction.
  [`security.yml`](.github/workflows/security.yml) fails the build on a
  credential-shaped `NEXT_PUBLIC_*` **name** — not on its value, because an
  empty value today is not a defence.
- Tenant isolation: every tenant-scoped row carries `tenant_id` **and**
  `workspace_id`, and every Qdrant point carries both plus
  `knowledge_base_id`, payload-indexed and filtered at query time (Part II §74).
- The server is always authoritative for safety, reranking and scoring. No
  client-supplied value of any of the three is trusted
  ([ADR-0004](docs/adr/0004-webgpu-as-acceleration-layer.md)).

Automated scanning — dependency review, `pip-audit`, `pnpm audit`, gitleaks,
CodeQL — runs in [`security.yml`](.github/workflows/security.yml). That is the
floor. Part I §41 and Part II §100 both call for an external security audit with
**CertiK or an equivalent external security audit provider** before the platform
handles real enterprise data; see
[ROADMAP Phase 3](docs/ROADMAP.md#phase-3--commercial-and-enterprise-readiness--not-started).

**Found a security issue?** Do not open a public issue. Contact a maintainer
directly.

---

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md). The four rules that matter most:

1. **Check [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md) before adding
   a file.** It is the authoritative ownership map, and parallel work depends on
   it.
2. **Contract changes go TypeScript first**, then mirror to Pydantic in the same
   commit, then run `infra/scripts/check-contracts.sh`.
3. **No hex literals.** Colours come from `packages/design-tokens` (Part II §99).
4. **Anything touching tenant isolation, RBAC or the safety layer** gets the
   extra review checklist. Untested isolation is not isolation.

---

## Licence

Proprietary.
