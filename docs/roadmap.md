# Roadmap

## Read this first

`docs/spec/AI_Coach_Spec_v3.md` is 5,400 lines describing a **complete
enterprise AI training platform**: multi-tenant knowledge management with OCR
and versioned chunking, a nine-step scenario builder, seven cooperating LLM
agents, realtime bidirectional voice with barge-in, ten-dimension
evidence-backed evaluation, compliance findings, team analytics, an approval
workflow, RBAC with tenant isolation, CRM/LMS/HRIS/SSO/SCIM connectors, B2C
mode with billing, and a three-tier client inference stack.

**This repository is not that system.**

What it contains today is the **architecture, the cross-language contracts, the
design system, and a scaffolded implementation** — the shape of the thing, with
a substantial amount of real code and a substantial amount still missing. It is
honest scaffolding, not a demo pretending to be a product:

- Contracts and state machines are real and enforced across two languages.
- The design system is real and complete enough to build pages from.
- The client inference runtime has real backends, a real worker and real
  capability detection.
- The agent layer has real prompts and real structured output types.
- **The live simulation currently runs against a mock event stream in the
  browser.** Most pages read from typed fixtures rather than the API. There is
  no `main.py`, no migrations, no document pipeline and no worker.

Anyone evaluating this repository should treat the sections below as the truth
and the spec as the target. Where a row says "not started", that is a
deliberate statement, not an omission.

> **Snapshot.** Status below reflects the repository as of the initial
> architecture pass. Several trees are being written in parallel, so treat
> "partial" as "was partial at the time of writing" and check the tree.
> The two-numbering-sequence caveat applies throughout: **Part I** is
> §1–§61 (product), **Part II** is §0–§102 (UI and architecture).

---

## Phase 0 — Foundation ✅ done

The things that had to exist before parallel work was possible at all.

| Item | Where | Status |
|---|---|---|
| pnpm workspace for the JS side, standalone `pyproject.toml` for Python | `pnpm-workspace.yaml`, `apps/api/pyproject.toml` | ✅ [ADR-0001](adr/0001-pnpm-workspace-plus-separate-python-app.md) |
| Cross-language contracts — entities, streaming events, state machines, enums | `packages/shared/src/**` ↔ `apps/api/app/domain/**` | ✅ [ADR-0002](adr/0002-typescript-as-contract-source-of-truth.md) |
| Contract drift guard, both directions | `scripts/check-contracts.sh` | ✅ runs in CI as its own job |
| Design tokens — light/dark CSS variables, Tailwind preset, aurora + dot matrix | `packages/design-tokens/src/**` | ✅ [ADR-0003](adr/0003-custom-design-system-over-shadcn-theme.md) |
| Glass component library on Radix primitives | `packages/ui/src/components/**` | ✅ ~27 components |
| Ownership map, so parallel agents do not collide | `docs/PROJECT_STRUCTURE.md` | ✅ authoritative |
| Local stack — postgres/redis/qdrant/minio, healthchecked | `docker-compose.yml` | ✅ |
| Container images — web standalone, api, worker, edge proxy | `infra/docker/**` | ✅ |
| Bootstrap / reset / seed scripts | `scripts/**` | ✅ seed is defensive about `app.*` names still landing |
| CI — web, api, contracts, shell jobs | `.github/workflows/ci.yml` | ✅ ⚠️ requires a committed `pnpm-lock.yaml` (`pnpm install --frozen-lockfile`). It was absent when the workflow was written; if `git ls-files pnpm-lock.yaml` is empty, run `pnpm install` and commit. Called out in the workflow itself. |
| Security workflow — dependency review, pip-audit, pnpm audit, gitleaks, CodeQL | `.github/workflows/security.yml` | ✅ automated floor only; see Phase 3 |
| Architecture reference, ADRs | `docs/architecture.md`, `docs/adr/**` | ✅ |

---

## Phase 1 — High-Fidelity MVP 🔨 in progress

Part I §5.2 defines the MVP as one specific loop that must run end to end. Not
a subset of it — the whole chain:

```text
Upload PDF → Parse → Chunk → Embed → Build Persona → Select Scenario
→ Voice / Text Simulation → Dynamic Objection → End Session → Evaluation
→ Evidence → Compliance Findings → Recommended Next Training
```

The demo that exercises it is Part I §59: the 陳先生 insurance scenario, seeded
by `database/seeds/seed.py`. Success is `完成需求探索 + 正確說明保障 + 不產生
Critical Compliance Risk + Trust >= 70 + Overall Score >= 80`.

### Where each link of the chain stands

| # | Link | Status | Remaining work |
|---|---|---|---|
| 1 | **Upload PDF** | ⬜ not started | Signed-URL upload endpoint (`documents.py`), MinIO put, file-type validation via libmagic (§40.1), size ceiling, `DocumentState: uploaded → validating` |
| 2 | **Parse** | 🟡 partial — `rag/ocr.py`, `rag/structure.py` exist | `rag/parser.py` for pdf/docx/pptx/txt/csv/html; poppler wiring; the worker image already carries poppler + tesseract |
| 3 | **Chunk** | ⬜ not started | `rag/chunker.py` implementing all seven `ChunkStrategy` values; parent-chunk links; token counting |
| 4 | **Embed** | ⬜ not started | `rag/embedder.py` with the **two separate paths** of Part I §2.1 (private open model vs external API — see [ARCHITECTURE §5](architecture.md#5-the-rag-pipeline)); `rag/vectorstore.py` Qdrant upsert with the three tenancy payload keys; `rag/pipeline.py` orchestration |
| — | **Async job runner** | ⬜ not started | `app/workers/celery_app.py` + the `documents` / `evaluation` / `maintenance` queues. The worker image and its healthcheck already expect `app.workers.celery_app` |
| 5 | **Build Persona** | 🟡 contracts + agent done | Persona CRUD router; the builder UI (`personas/new`, `[id]`, `[id]/test-lab`); hidden-state serialisation boundary enforced by role |
| 6 | **Select Scenario** | 🟡 setup page exists, reads fixtures | Scenario CRUD router; the nine-step builder wizard (§17); wire the setup page to the API |
| 7 | **Voice / Text Simulation** | 🟡 the biggest partial | `use-session-socket.ts`, `use-voice-session.ts`, the session store and the full component tree exist and run against `mock/mock-event-stream.ts`. Needed: `app/main.py`, `app/ws/gateway.py`, the live and voice routes (`simulations/[id]/live`, `.../voice`), STT/TTS wiring, WebRTC path plus STUN/TURN |
| 8 | **Dynamic Objection** | 🟡 agents written, not driven | `orchestrator.py`, `scenario_director.py`, `customer_agent.py` and their prompts exist. Needed: the turn loop actually invoked from the socket, `PersonaStateEvent` persistence, difficulty adjustment in flight |
| 9 | **End Session** | ⬜ not started | `sessions.py` router, `services/session.py`, transcript persistence, `session.completed` emission |
| 10 | **Evaluation** | 🟡 `evaluator_agent.py` written | `services/evaluation.py`, the `evaluation` worker queue, rubric application, `Evaluation` persistence |
| 11 | **Evidence** | 🟡 types + UI exist | `EvaluationEvidence` production in the evaluator; the review page (`simulations/[sessionId]/review`); `evidence-disclosure.tsx` exists and is currently fed fixtures |
| 12 | **Compliance Findings** | 🟡 `compliance_agent.py` written | `services/safety.py`, finding persistence, the reviewer workflow (`open → acknowledged → resolved → dismissed`), the compliance report page |
| 13 | **Recommended Next Training** | ⬜ not started | `services/report.py`, `Recommendation` production, the closed loop of Part I §33 |

### Cross-cutting Phase 1 work

| Area | Status | Remaining |
|---|---|---|
| **`apps/api/app/main.py`** | ⬜ | The app factory itself: middleware chain, router mounting, `/health/live` + `/health/ready`. Both the API image's `HEALTHCHECK` and the compose `depends_on` chain expect `/health/ready` to verify Postgres, Redis and Qdrant |
| **Alembic migrations** | ⬜ | `database/migrations/`, `alembic.ini`. Models exist in `app/db/models/**`; nothing creates the schema. `bootstrap.sh` reports this clearly and skips |
| **Router surface (§56)** | 🟡 `auth.py` only | 17 more router groups: workspaces, users, teams, knowledge_bases, documents, chunks, retrieval, questions, personas, scenarios, assignments, sessions, reports, security, audit, integrations, runtime |
| **`pnpm-lock.yaml`** | ⚠️ verify | Must be committed for CI's `web` job and `pnpm audit` to run at all. One command, once: `pnpm install` |
| **`apps/api/README.md`** | ⬜ | `pyproject.toml` declares it as the project readme; both API images synthesise a stub so the build does not fail on a missing doc file |
| **Web pages beyond the shell** | 🟡 | Built: login, workspace-select, dashboard, simulation library + setup. Missing: knowledge (list / documents / chunks / playground / mining), questions, personas, scenarios builder, training, performance, reports, team, security, integrations, settings |
| **Local inference tasks** | 🟡 | `packages/ai-runtime` has capability detection, three backends, the worker, cache, manifest and telemetry, plus `tasks/safety-precheck.ts`. Missing: `tasks/embedding`, `tasks/intent-classification`, `tasks/reranking`, and real model manifests |
| **STUN/TURN** | ⬜ | WebRTC media does not traverse the HTTP proxy. A voice path needs STUN/TURN deployed alongside; nginx handles signalling over `/ws` only |
| **Tests** | ⬜ | `apps/api/tests/` does not exist. The CI `api` job runs pytest against real Postgres/Redis/Qdrant service containers specifically so the tenant-isolation tests (§74) are meaningful when they arrive |

### What is currently mocked or faked — the honest list

Everything here is a real file doing a real job; the point is that none of it is
talking to a server.

| Mock | File | What it stands in for |
|---|---|---|
| **Browser mock event stream** | `apps/web/src/features/simulation/mock/mock-event-stream.ts` | The whole `/ws` session channel. It emits real `StreamingEvent` values on a timer, which is why the simulation UI looks finished. Replacing it is the single largest Phase 1 task |
| Mock session | `apps/web/src/features/simulation/mock/mock-session.ts` | `TrainingSession`, persona and scenario for a live session |
| Typed fixtures | `apps/web/src/lib/fixtures/*.ts` (14 files) | Every list and detail view: knowledge, questions, personas, scenarios, sessions, evaluations, reports, security, training, notifications, integrations, settings, identity. Correctly typed against `shared`, so swapping in TanStack Query calls is mechanical rather than a rewrite |
| Auth context | `apps/web/src/lib/auth-context.tsx` | Real session cookies from `/auth` |
| Model manifests | absent | `LocalModelManifest` entries with real URLs, byte sizes and sha256 digests. Without them the WebGPU and WASM tiers have nothing to load, and the runtime falls through to the server backend |
| Seed persistence | `database/seeds/seed.py` | Falls back to writing `infra/seed/demo-seed.json` because no database path exists yet. It needs either `app/db/seed.py::seed_demo` or migrations plus a session factory |

### Definition of done for Phase 1

The §59 demo runs against real services with no mock in the path:

1. An admin uploads a real PDF; it reaches `ready` through the worker pipeline.
2. A trainee starts the 陳先生 scenario and holds a voice conversation.
3. 陳先生 raises 「我已經有保險了，為什麼還要多買？」 from his hidden state.
4. A knowledge claim in the persona's or coach's turn carries a citation
   pointing at a real chunk of the uploaded PDF.
5. The persona state card moves because `persona.state.updated` arrived — not
   because the client inferred it.
6. Session end produces an `Evaluation` with all ten skills scored, each with at
   least one transcript-quoted `EvaluationEvidence`.
7. A deliberate compliance breach produces a `ComplianceFinding` with severity,
   policy rule and suggested correction.
8. The review page shows a recommended next training.
9. The runtime badge reports WebGPU, WASM or Server honestly, and the loop works
   with WebGPU forced off.

---

## Phase 1.5 — Enterprise governance gaps ⬜ not started

`docs/spec/AI_Coach_Functional_Review_Checklist.md` is a separate functional
review against `docs/spec/AI_Coach_Spec_v3.md`. Its own summary (§1.1) is that
**the original three requirement areas — knowledge/RAG, multi-agent/voice,
evaluation/security — have no functional gap at the spec level.** What it adds
is a fourth area the spec itself never asked for: the operational governance a
real enterprise deployment needs before go-live. None of it is implemented.
It is tracked here rather than folded into Phase 1 so that Phase 1's own
definition of done — the §59 demo running end to end on real services — is not
redefined mid-flight.

**Decision (2026-09-04): documented now, built after Phase 1.** The MVP loop
(upload → parse → chunk → embed → simulate → evaluate) is worth more right now
than any of the items below, including the P0-labelled ones — none of them
matter until there is a real session to secure, version or recover.

### P0 — before a real customer's data touches this system

| # | Item | Adds | Where it would live |
|---|---|---|---|
| 1 | Auth lifecycle | password reset, email verification, invitation + expiry, disable/delete user, session revocation, logout-all-devices, idle timeout, MFA/TOTP, recovery codes, brute-force lockout | `core/security.py`, `api/v1/routers/auth.py`, new `AuthSession`, `Invitation`, `MFADevice` |
| 2 | Session version snapshot | every `TrainingSession` pins `scenario_version`, `persona_version`, `rubric_version`, `knowledge_snapshot_id`, `retrieval_config_version`, `compliance_policy_version`, `agent_config_bundle_version`, `model_route_version`, `voice_config_version` — so a report opened in six months is reproducible | `domain/session.py`, `db/models/session.py` (already has version-*pinning*, §54 ADR-0008; this widens it from 2 fields to 9) |
| 3 | Session autosave / crash recovery | turn + persona-state checkpointing, browser-refresh and tab-crash recovery, rejoin-in-progress, duplicate-connection guard, server-side finalisation if the client vanishes | `ws/gateway.py`, `session-store.ts` |
| 4 | Document/RAG failure recovery | the full failure-state machine (`validation_failed`, `parse_failed`, `ocr_failed`, `embedding_failed`, `index_failed`, `partially_ready`), retry-from-stage, dead-letter visibility | `workers/document_jobs.py`, `rag/pipeline.py` |
| 5 | Evaluation low-confidence review queue | route to human review when `confidence < threshold`, a critical compliance finding fires, or AI/human variance exceeds threshold; `auto_scored → review_required → under_review → reviewed → overridden → final` | `services/evaluation_service.py`, new `ReviewTask`, `HumanScore` |
| 6 | Compliance policy version pinning | `CompliancePolicy` / `CompliancePolicyVersion` with a draft→review→approved→effective→expired→replaced lifecycle, so a new regulation never silently reinterprets an old session | `domain/evaluation.py`, `agents/compliance_agent.py` |
| 7 | Immutable audit log | append-only/WORM policy, retention period, correlation id, before/after value on critical changes (rubric, compliance rule, model, prompt, role, knowledge publish, report override) | `core/audit.py` (already writes `AuditEvent`; missing the immutability guarantee) |
| 8 | Data retention / delete / export | per data-class (transcript, voice, report, audit, source, WebGPU cache) retention, export-personal-data, delete-personal-data, legal hold, workspace purge | new `DataRetentionPolicy`, `ExportJob`, `DeletionJob`; `workers/retention_jobs.py` already stubs this direction |
| 9 | API / webhook security | API keys with scope + workspace binding + rotation + revoke; HMAC-signed webhooks with replay protection, idempotency, retry/backoff, delivery log | new routers + `WebhookDelivery` |
| 10 | Usage / cost guardrail | token/voice/embedding budgets, per-user and per-session limits, soft/hard limits, cost alerts | new `UsageRecord`, `QuotaPolicy` |
| 11 | Admin operational health dashboard | live status for API/WS/WebRTC/OpenAI/ElevenLabs/Qdrant/Redis/storage/worker queue, job health, the §49.5 latency metrics surfaced in-product | a `settings/health` or `security/operations` page + `SystemHealthEvent` |
| 12 | Model / prompt / agent config registry | versioned, diffable, rollback-able registry for LLM routing config and every agent's prompt, each session pinning a `model_route_version` + `agent_config_bundle_version` | new `PromptVersion`, `ModelRouteVersion`, `AgentConfigBundle` |

### P1 — before the first external beta customer

Assignment recurrence/exemption/grace-period, notification preferences and
quiet hours, scheduled report delivery, connector incremental sync with a
`connected/syncing/degraded/auth_expired/rate_limited/error/disconnected`
state machine, knowledge freshness (effective/expiry date, stale warning,
superseded-by), full content-approval workflow (comment thread, request
changes, resubmit, maker-checker, emergency unpublish), rubric calibration
governance (golden evaluation set, inter-rater agreement), voice consent and
recording retention, an organisation onboarding wizard, API/webhook delivery
logs.

### P2 — after commercial scale-out

A/B scenario experiments, a template marketplace, 3D avatar / lip sync,
advanced offline PWA, cross-organisation benchmarking, advanced gamification —
all deferred consistently with Phase 3's B2C note above.

### Suggested new entities (from the checklist §48)

`AuthSession`, `Invitation`, `MFADevice`, `KnowledgeSnapshot`,
`RetrievalConfigVersion`, `PromptVersion`, `AgentConfigBundle`,
`ModelRouteVersion`, `CompliancePolicy`, `CompliancePolicyVersion`,
`ReviewTask`, `HumanScore`, `ConnectorSyncJob`, `WebhookDelivery`,
`UsageRecord`, `QuotaPolicy`, `NotificationPreference`,
`DataRetentionPolicy`, `ExportJob`, `DeletionJob`, `SystemHealthEvent`. None
of these exist in `packages/shared/src/entities.ts` yet; adding them is a
`shared` change first, per the contract workflow in `CONTRIBUTING.md`.

---

## Phase 2 — Team, analytics and governance ⬜ not started

The features that turn a working simulation into something an enterprise
administers.

| Area | Spec | Scope |
|---|---|---|
| Team analytics | Part I §35 | Manager dashboards, skill distribution, benchmark against team and organisation, export |
| Personal growth | Part I §34 | `SkillProfile` over time, weakest/strongest skill, monthly improvement, days-to-readiness |
| Training assignment | Part I §36 | Assign to users or teams, deadlines, attempt limits, minimum score, prerequisites, mandatory pre-launch scenarios |
| Approval workflow | Part I §38 | `ContentStatus` transitions with real reviewers; an author cannot publish their own AI-generated question |
| Knowledge mining | Part I §13 | Top pitch extraction, objection mining, golden phrases, human review queue |
| Rubric calibration | Part I §28 | Human override of a score with reviewer id and note; drift measurement between the evaluator and human reviewers |
| Question bank at scale | Part I §14, §15 | AI generation with citations and mandatory review, versioning, publish |
| Notification centre | Part I §37 | Assignment due, review requested, compliance finding raised |
| Reports | Part I §47 | Team, skill, compliance report types with export |
| Retrieval playground | Part I §12.4 | Compare models and retrieval configs, mark relevant/irrelevant — the first real consumer of client-side embedding |
| Observability | Part I §49.5 | Tracing, metrics, LLM/STT/TTS/retrieval latency dashboards, token accounting |

---

## Phase 3 — Commercial and enterprise readiness ⬜ not started

| Area | Spec | Scope |
|---|---|---|
| B2C personal mode | Part I §45 | Personal practice, history, a `kind: 'b2c'` workspace |
| Billing / quota | Part I §46 | Subscription or credit model, quota enforcement, usage metering |
| CRM connectors | Part I §43 | Salesforce / HubSpot — pull real product and objection data |
| LMS connectors | Part I §43 | SCORM/xAPI export, completion write-back |
| HRIS connectors | Part I §43 | Org chart and team sync |
| SSO | Part I §43 | SAML / OIDC |
| SCIM | Part I §43 | User and group provisioning and de-provisioning |
| Webhooks | Part I §43 | Session completed, finding raised, assignment overdue |
| Kubernetes deployment | Part II §64 | Helm chart; the nginx policy in `infra/nginx/nginx.conf` is written to port to ingress-nginx annotations |
| AMD AUP private deployment | Part II §72 | Private embedding, reranker, parser, evaluation model, private LLM, vector DB. Requires switching off the external-API embedding path and re-embedding |
| **External security audit** | Part I §41, Part II §100 | An engagement with **CertiK or an equivalent external security audit provider**, covering the API surface and infrastructure. §41 is explicit that CertiK is known primarily for Web3 / blockchain security, so a general enterprise AI SaaS proposal should claim only demonstrable scope and, until an engagement exists, say "or equivalent provider" rather than naming one. Findings surface in-product under Security & Audit. Everything in `.github/workflows/security.yml` is the automated floor beneath this, not a substitute |

---

## Acceptance checklist

### Part I §60 — feature-completeness matrix

Status is against the spec's own required-capability list per module.
✅ done · 🟡 partial · ⬜ not started

| Module | Required (§60) | Status | Honest note |
|---|---|---|---|
| **Knowledge** | Upload, Parse, OCR, Chunk, Metadata, Version, Embedding, Vector DB, Citation, ACL | ⬜ | `KnowledgeAcl`, `Citation`, `Chunk`, `DocumentVersion` types exist; `rag/ocr.py` and `rag/structure.py` exist. No upload, chunker, embedder or vectorstore. Nothing has ever been indexed |
| **Knowledge Mining** | Top Pitch, Objection Mining, Golden Phrase, Human Review | ⬜ | `agents/prompts/mining.py` exists. No service, no review queue, no UI |
| **Question** | CRUD, AI Generate, Rubric, Source, Review, Publish | ⬜ | `Question` and `Rubric` types are complete, including `citations`, `reviewer_id`, `generated_by_model`. No router, no UI |
| **Persona** | Personality, Hidden Need, Trigger, Objection, Voice, Test Lab | 🟡 | Types and `customer_agent.py` complete; §59 persona fully seeded. No CRUD, no builder UI, no test lab |
| **Scenario** | 9-step Builder, Difficulty, Success/Fail, Training/Assessment Mode | 🟡 | Type carries all nine steps' worth of fields plus success/failure conditions and mode; `scenario_director.py` exists. Builder wizard not built |
| **Multi-Agent** | Scenario Director, Customer, Coach, Knowledge, Evaluator, Compliance | 🟡 | All seven agents and their prompt modules are written with structured output types. Not yet invoked by a running orchestration loop — there is no `main.py` |
| **Intent** | Ambiguous, Off-topic, Over-scope, Role Escape, Injection handling | 🟡 | `agents/intent.py` and `agents/patterns.py` exist; `tasks/safety-precheck.ts` handles the client tier. Untested against real turns |
| **Voice** | STT, TTS, WebRTC, VAD, Barge-in, Captions, Device, Transcript | 🟡 | `use-voice-session.ts`, `audio-device-picker.tsx`, `captions.tsx`, `waveform.tsx` exist. No STT or TTS wiring, no WebRTC transport, no STUN/TURN |
| **Simulation** | Left conversation, Right persona, Objective, State, Coach, Citation | 🟡 | The full component tree is built and behaves correctly — **against the mock event stream**. Layout, transcript, persona card, coach card, compliance alert, citation chips all real |
| **Evaluation** | 10 dimensions, Evidence, Confidence, Rubric, Calibration | 🟡 | All ten `SKILL_KEYS`, `SkillScore` with confidence and evidence, `human_override` for calibration. `evaluator_agent.py` written. Nothing has scored a real session |
| **Report** | Replay, Timeline, Skill, Compliance, Benchmark, Recommendation | 🟡 | `state-timeline.tsx`, `skill-radar.tsx`, `heatmap.tsx`, `trend-line.tsx`, `evidence-disclosure.tsx` built against fixtures. No review route, no report service |
| **Closed Loop** | Weakness, Knowledge Gap, Next Scenario, Material Recommendation | ⬜ | `Recommendation` type exists. No service |
| **Team** | Member, Assignment, Deadline, Pass Rule, Dashboard, Export | ⬜ | `Team`, `Assignment` types exist. No router, no pages |
| **Security** | RBAC, PII, Injection, Tenant Isolation, Encryption, Audit | 🟡 | `core/security.py`, `core/tenancy.py`, `core/audit.py`, `core/rate_limit.py`, `core/deps.py`, `lib/rbac.ts` all exist; `TenantScoped` is structural; §73 headers set at both Next.js and nginx. **Not yet proven — there are no tenant-isolation tests, and untested isolation is not isolation** |
| **Integrations** | OpenAI, ElevenLabs, AMD AUP, Vector DB, CRM/LMS/SSO/Webhook | ⬜ | `agents/llm_client.py` exists; config carries provider switches and `SecretStr` keys. No live call has been made |
| **Web Runtime** | WebGPU, WASM fallback, Server fallback, Worker | 🟡 | Genuinely the most complete area: capability detection, three backends, ORT session management, worker host and protocol, cache, fallback chain, telemetry. Missing real model manifests, and the embedding / intent / rerank tasks |
| **UX** | Light, Dark, System, Responsive, Accessibility, i18n | 🟡 | Theme provider with a no-flash bootstrap script, full light/dark token sets, focus-ring utility, ~27 accessible Radix-based components. i18n not wired; accessibility not audited |
| **B2C** | Personal Practice, History, Subscription/Credit (if enabled) | ⬜ | `Workspace.kind` already allows `'b2c'`. Nothing else. Phase 3 |

### Part II §100 — final acceptance definition

**Visual**

- 🟡 Same design language as the reference at first glance — tokens, glass and
  aurora are in place; not every page exists to judge it on
- 🟡 blur · depth · floating cards · borders · background light · spacing ·
  roundness — all present in `packages/ui` and `design-tokens`
- 🟡 transcript structure — `transcript-document.tsx` and `transcript-turn.tsx`
  built; document-feel confirmed only against fixtures
- ✅ gradient status pill — `gradient-pill.tsx`
- ✅ icon rail — `icon-rail.tsx`, narrow, not a 240px sidebar (§99)

**Product**

- 🟡 Complete Live Simulation — UI complete, backed by a mock
- 🟡 Persona — contracts and agent complete; no CRUD or builder
- 🟡 Voice — UI and hooks complete; no transport
- ⬜ Knowledge
- ⬜ Question Bank
- 🟡 Report — components complete, fixture-fed
- 🟡 Security — implemented, unproven
- ⬜ Team
- ⬜ Integrations

**Technical**

- ✅ WebGPU capability detection — `packages/ai-runtime/src/capability.ts`
- ✅ Worker-based local inference — `worker/inference.worker.ts`, `worker-host.ts`
- ✅ WASM fallback — `backends/wasm-backend.ts`
- ✅ Server fallback — `backends/server-backend.ts`
- 🟡 WebSocket — client (`ws-client.ts`, `use-session-socket.ts`) done; no
  server gateway
- ⬜ WebRTC
- 🟡 Web Audio — hooks present; not exercised against a live stream
- ✅ Theme system — light / dark / system, no-flash bootstrap
- 🟡 Responsive — built into the components; not verified across breakpoints
- 🟡 Accessibility — Radix primitives and a focus-ring utility; no audit

**Security**

- ✅ API secrets server-side — `SecretStr` in config, boot-time refusal on
  placeholder secrets, a CI check that fails on a credential-shaped
  `NEXT_PUBLIC_*` name
- 🟡 RBAC — implemented in `core/security.py` and `lib/rbac.ts`; untested
- 🟡 Tenant isolation — structural in the types and models; **no test proves a
  cross-tenant read is denied**
- 🟡 Audit — `core/audit.py` and the `AuditEvent` type; not emitted from a
  running mutating path
- 🟡 PII / compliance layer — `compliance_agent.py` and
  `tasks/safety-precheck.ts`; never run against a real transcript
- ✅ No sensitive browser cache by default — `ALLOW_SENSITIVE_DATA_CACHE`
  defaults false and is refused outright in production

---

## The one-paragraph summary, if you only read one thing

The contracts, the design system, the client inference runtime and the agent
prompt layer are real and in good shape. The API has its foundations — config,
security, tenancy, audit, rate limiting, domain models, database models — but no
application yet: no `main.py`, no migrations, one router out of eighteen, no
document pipeline, no worker. The web app has a real shell, a real component
library and a live-simulation UI that is convincing because it runs against a
mock event stream. Phase 1 is not about designing anything further; it is about
deleting `mock/mock-event-stream.ts` and the fourteen fixture files, one call
site at a time, until the §59 demo runs on real services.
