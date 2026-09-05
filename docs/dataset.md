# Data

What the platform holds, where each class of it lives, how long it stays and who can
read it. [`model.md`](model.md) covers the models; this page covers the data they run
on.

Three properties shape everything below, and it is worth stating them before the
detail:

1. **Tenant isolation is a property of the data, not a filter in a query.** Every
   tenant-scoped row and every vector carries both `tenant_id` and `workspace_id`, and
   the code refuses to operate without them.
2. **Nothing derived from a real conversation reaches a playbook without a human
   saying so.** The mining pipeline has no code path from "the model suggested it" to
   "published".
3. **A completed session's report must render identically in a year.** That forces
   version pinning ([ADR-0008](adr/0008-version-pinned-sessions.md)) into the data
   model rather than the report renderer.

## Contents

- [The knowledge corpus](#the-knowledge-corpus)
- [Knowledge mining inputs](#knowledge-mining-inputs)
- [Training-session data](#training-session-data)
- [Tenant isolation as a data property](#tenant-isolation-as-a-data-property)
- [PII](#pii)
- [Retention and deletion](#retention-and-deletion)
- [Enterprise switches](#enterprise-switches)
- [Avatar assets](#avatar-assets)
- [Data class summary](#data-class-summary)

## The knowledge corpus

The ingestion corpus is whatever a workspace uploads into a `KnowledgeBase`: product
manuals, policy documents, compliance rules, FAQ exports, training material.

### Accepted formats

`DocumentSourceKind` in `packages/shared/src/entities.ts` declares eight source kinds,
and `apps/api/app/rag/parser.py` maps six of them to accepted MIME types:

| Kind | MIME types accepted | Backend |
|---|---|---|
| `pdf` | `application/pdf` | `pypdf`, page by page — page numbers feed §12.5 citations |
| `docx` | the OOXML wordprocessing type | `python-docx` |
| `pptx` | the OOXML presentation type | `python-pptx` |
| `txt` | `text/plain`, `text/markdown` | dependency-free |
| `csv` | `text/csv`, `application/csv` | dependency-free |
| `html` | `text/html`, `application/xhtml+xml` | dependency-free |
| `url` | — | fetched, then treated as HTML |
| `manual` | — | text entered directly, no file |

Two hard limits at the door, both in `parser.py`:

- **100 MB per file** (`MAX_UPLOAD_BYTES`), checked twice — once when the signed
  upload URL is issued (`knowledge_service.py`) and again when the worker parses the
  bytes. Over the ceiling is `413 payload_too_large`.
- **The declared source kind must match the MIME type.** A `.pdf` extension over a
  `text/html` body is rejected rather than parsed, because a parser is an attack
  surface and format confusion is how you get through it.

Only the text/CSV/HTML/URL backends are dependency-free. `pypdf`, `python-docx` and
`python-pptx` are imported lazily, and a missing one raises `ParserUnavailableError`
with a clear message rather than a stack trace — a deployment can legitimately choose
not to install them.

### The pipeline

`apps/api/app/rag/pipeline.py` drives one state machine per document, mirrored in
`packages/shared/src/state-machines.ts` so the upload UI can render the same states:

```text
uploaded → validating → parsing → chunking → embedding → indexing → ready
   5%         10%         30%       50%         75%         90%      100%
                                                                  ↘ failed
```

The percentage is not cosmetic: it is `KnowledgeDocument.progress`, and the failure
path writes `failure_reason` so an uploader is told *why* rather than shown a red
badge. Each stage is a step, and OCR runs inside `parsing` when the extracted text
density says the pages are scans (`rag/ocr.py`, `rag/structure.py`).

### Chunk strategies

`ChunkStrategy` declares seven values, all implemented in `rag/chunker.py`:

| Strategy | When it is right |
|---|---|
| `auto` | the default — `detect_strategy()` picks from the parsed block structure |
| `heading` | documents with a real heading hierarchy; keeps a section together |
| `paragraph` | prose without headings |
| `fixed_token` | unstructured text, and the fallback when nothing else applies |
| `semantic` | topic-shift boundaries rather than layout boundaries |
| `table_aware` | product tables — paragraph chunking splits a row from its header, and retrieval then returns a coverage limit with no idea which product it belongs to |
| `faq_aware` | Q/A exports, where the question and its answer must stay in one chunk |

A `Chunk` carries `document_version`, `index`, `token_count`, optional `page` and
`section`, an optional `parent_chunk_id`, free-form `metadata`, `tags`, and
`excluded_from_retrieval`. The parent link supports small-chunk retrieval with
large-chunk context: a parent is reachable only *through* an expansion of a matched
child, never as a direct hit — asserted by
`test_parent_chunks_are_only_reachable_through_expansion`.

### Where each piece lives

| Artefact | Store |
|---|---|
| The original uploaded file | S3-compatible object storage; the API never streams it, the browser `PUT`s to a signed URL |
| Parser and OCR intermediates | object storage under a `tmp/` prefix with a 30-day expiry rule |
| Chunk text, metadata, tags, version | **PostgreSQL** |
| The vector for each chunk | **Qdrant** ([ADR-0005](adr/0005-qdrant-as-production-vector-store.md)) |
| Citations | PostgreSQL, pinned to `document_version` |

The split matters. Qdrant holds vectors plus the payload keys needed to filter them —
`tenant_id`, `workspace_id`, `knowledge_base_id` — and nothing else authoritative.
Chunk text and metadata are relational data, so a re-index rebuilds the vector store
from PostgreSQL rather than from the original files.

Collections are namespaced by `EmbeddingSpec.index_key()`, i.e. by (model, dimension),
so vectors of different geometry can never mix in one collection. That is what makes
changing an embedding model a re-embed rather than a corruption; see
[`model.md`](model.md#changing-an-embedding-model).

`VECTOR_BACKEND=memory` exists for local development and tests. It is refused in
production, and its data does not survive an API restart.

## Knowledge mining inputs

Part I §13. The inputs are the most sensitive material in the platform: **transcripts
of real top-performer sales conversations** and **coaching notes** written about real
people. The outputs are playbook assets — top pitches, mined objections, golden
phrases.

`apps/api/app/rag/mining.py` enforces two gates, in this order.

### 1. Anonymisation runs before anything else touches the text

`anonymise()` masks every PII span **before** a segment reaches a model, a log or a
database row. It also records `residual: bool` — whether a PII pattern still matches
after masking — so a suspected leak survives as a flag rather than being swallowed.

### 2. A human review gate that cannot be bypassed

Every produced asset starts life in `review_required`, and this is enforced at three
separate points, deliberately redundantly:

- `MinedAsset.status` defaults to `ReviewStatus.REVIEW_REQUIRED`.
- `MiningAgent.run()` **re-stamps** every model-produced asset back to
  `review_required` with `reviewer_id = None`, regardless of what the model claimed
  about its own status. A model asserting `approved` is treated as noise.
- `MiningRun.publish()` raises `ReviewRequiredError` when any asset is still
  undecided, **and** when anonymisation flagged residual PII — in that case a reviewer
  must clear the batch first, even if every asset is individually approved.

`MiningRun.review()` requires a real `reviewer_id`; there is no anonymous approval.
Each asset keeps `source_excerpt` — the *anonymised* source line it was derived from —
because a reviewer cannot judge a phrase without seeing what it came from.

The lifecycle is `review_required → approved | rejected → published`. There is no
edge from generation to publication.

## Training-session data

A training session produces the platform's densest and most personal data. The tables
live in `apps/api/app/db/models/session.py` and `evaluation.py`.

| Row | What it holds |
|---|---|
| `TrainingSession` | who, which scenario and persona **at which version**, mode, status, runtime tier, voice/live-score flags, turn count, `last_event_seq`, latest `persona_state`, `attempt_number` |
| `TranscriptTurn` | speaker, text, `timestamp_ms`, optional `audio_url`, detected `intent`, `citations`, `state_delta`, `score_event`, `token_usage` |
| `PersonaStateEvent` | the persona's emotion/trust/interest/resistance state at a point in the session, linked to the turn that moved it |
| `Evaluation` | the scored result of a session |
| `EvaluationEvidence` | the transcript quote backing each `SkillScore`. Part I §27 forbids a bare number — `Empathy 74` alone is a spec violation, not a UI shortcut |
| `ComplianceFinding` | type, severity, the transcript quote, the policy rule, an explanation, a suggested correction |
| `AuditEvent` | who did what to which resource, with a real risk level |

Note what `TranscriptTurn` does **not** hold: the audio itself. `audio_url` points at
object storage, which is what lets the retention sweep age out recorded voice
independently of the text (see [Retention](#retention-and-deletion)).

### Version pinning makes a report reproducible

`TrainingSession` records `scenario_version`, `persona_version` and
`rubric_version` at session start, and a report renders against those pinned versions
— never against current state. `Citation.document_version` does the same for
knowledge: a re-parsed document does not silently change what a past turn cited, which
is why version-N chunks are retained and marked `excluded_from_retrieval` rather than
deleted.

The failure this prevents is not staleness but active misleadingness: a March report
rendered against May's edited scenario lists talking points nobody asked for and a
success condition nobody was measured against, with no way to tell from looking at it.
The reasoning in full is [ADR-0008](adr/0008-version-pinned-sessions.md).

> **Current status.** Two versions are pinned today (scenario and persona, plus rubric
> on the session row). The checklist's P0 item widens this to nine — knowledge
> snapshot, retrieval config, compliance policy, agent config bundle, model route,
> voice config. See [`roadmap.md`](roadmap.md) Phase 1.5.

## Tenant isolation as a data property

Isolation here is structural. It is not a convention that every query author must
remember.

**In PostgreSQL.** Every tenant-scoped table extends `TenantScopedMixin`: both
`tenant_id` and `workspace_id`, non-nullable, with an index that leads with them.
Filtering on `workspace_id` alone *works* — workspace ids are unique in practice, so
the query returns the right rows in testing, in staging and in production, right up
until an id is guessed or reused. That is the single most likely serious bug in the
codebase, and it passes every test that checks only the happy path.

**In Qdrant.** `TenantScope.__post_init__` raises `TenantIsolationError` when either
id is missing or blank, so an unscoped vector operation cannot be constructed. Every
point carries `tenant_id`, `workspace_id` and `knowledge_base_id` as payload-indexed
keys, and the filter builder always emits conditions on the first two plus
`knowledge_base_id ∈ …` when the scope names bases. A filter that arrives without
them is refused rather than widened —
`test_qdrant_filter_translation_refuses_an_unscoped_filter`.

**At the API.** A resource in another tenant returns **`404 not_found`**, never
`403`, so the API does not confirm that it exists. The audit trail records the real
reason.

**Above tenancy: the ACL.** Being in the right tenant does not imply access to a
knowledge base within it. `KnowledgeAcl` scopes to organization, workspace,
department, team, role or user, with per-permission grants (`view`, `use_for_rag`,
`edit`, `review`, `publish`, `export`, `delete`). §39 is a second gate, checked in
addition to tenancy, not instead of it.

> **Current status.** The vector-store isolation path has tests. The relational path
> does not yet have a test proving a cross-tenant read is denied, and
> [`roadmap.md`](roadmap.md) says so plainly: untested isolation is not isolation.

## PII

### What is detected

`PII_RULES` in `apps/api/app/agents/patterns.py`, tuned for zh-TW:

| Rule | Matches | Severity |
|---|---|---|
| `PII-TW-ID` | Taiwan national ID | high |
| `PII-TW-MOBILE` | Taiwan mobile numbers | high |
| `PII-TW-PHONE` | Taiwan landline numbers | medium |
| `PII-CARD` | 13–16 digit payment card numbers | high |
| `PII-EMAIL` | email addresses | medium |
| `PII-ADDRESS` | Taiwanese street addresses (縣/市 + 區/鄉/鎮) | medium |
| `PII-POLICY-NO` | insurance policy numbers | medium |

A separate rule family covers `SENSITIVE_INFORMATION` — medical records, diagnoses,
named conditions, internal-only markings — which is not PII but is treated with the
same care.

### What is masked

`SafetyService.mask_pii()` replaces every matched span, walking matches right-to-left
so earlier offsets stay valid. The result is `masked_text`, and the docstring states
its contract directly: text with PII masked is **safe to log, store or send to a
model**. Unmasked input is none of those three.

### What is never stored

- **Provider credentials never leave the API process.** `OPENAI_API_KEY` and its
  siblings are `SecretStr` in config, never placed in a response body, header, cookie
  or error message, never proxied to the browser as a "temporary" key, and never
  accepted from a client — `/integrations` takes a `secret_ref`, not raw credential
  material, and an `IntegrationResponse` never echoes a secret back.
- **The offending input value is dropped from validation errors.** `errors[]` carries
  the field location and the validator message only, so a request body containing
  transcript text or PII never reaches a response or a log.

### What is never logged

- **Transcript text and knowledge queries stay out of logs**, application and proxy
  alike. `POST /retrieval/test` audits *which* knowledge bases were searched and how
  many hits came back — never the query text (§49.5).
- **Readiness probe details report only the exception type**, never its message,
  because a driver message can contain a DSN with a password.
- **Runtime telemetry is content-free by type.** `TelemetryPatch` maps every
  content-shaped key (`prompt`, `text`, `transcript`, `query`, `messages`, `vectors`,
  …) to `never`, so adding one is a compile error, with `assertContentFree()` as a
  runtime backstop.
- **Nothing credential-shaped in `NEXT_PUBLIC_*`.** Next.js inlines that namespace
  into the client bundle, so the *name* alone is the violation. CI fails on it.

## Retention and deletion

Two distinct obligations, both in `apps/api/app/workers/retention_jobs.py`, both
dry-runnable — `dry_run=True` reports what *would* go, which is what an admin sees
before confirming.

### The sweep

`retention.sweep`, on the daily beat schedule on the `maintenance` queue. Defaults
from `SafetyService.retention_policy()`, overridable per tenant:

| Data class | Default | Why |
|---|---|---|
| Audio | **30 days** | recorded voice is the most sensitive artefact, so it goes first — the URL is stripped and object storage expires the blob |
| Transcripts | 365 days (`TRANSCRIPT_RETENTION_DAYS`) | hard delete |
| Mining drafts | 90 days | un-published candidate assets should not accumulate |
| Evaluations | 1095 days (3 years) | the record of a scoring decision |
| Audit events | 1825 days (5 years) | the record of a compliance decision |

Evaluations and audit events are kept far longer than transcripts on purpose: they are
the defensible record, and they are far smaller.

Object storage carries a 30-day expiry rule on the `tmp/` prefix for parser and OCR
intermediates, and bucket versioning is on so a bad re-parse is recoverable.

### Erasure

`retention.erase_user` handles a data-subject deletion request. It is a **hard**
delete of the user's personal content plus a purge of their chunks and vectors — a
real deletion, not a flag (Part I §40.2). The audit trail is retained in
**pseudonymised** form, because deleting the audit record of a deletion would itself
be a compliance failure.

> **Current status.** Retention and erasure exist as jobs. The wider governance layer
> the functional review asks for — per-class policy objects, export-personal-data,
> legal hold, workspace purge — is Phase 1.5 and not built. See
> [`roadmap.md`](roadmap.md).

## Enterprise switches

Three settings control what a browser is allowed to keep. All of them are server-side
policy delivered to the client, not client preferences.

| Setting | Default | Effect |
|---|---|---|
| `ALLOW_LOCAL_MODEL_CACHE` | `true` | whether model weights may be cached in the browser. Off means every session re-downloads, or the local tier is simply unused |
| `ALLOW_SENSITIVE_DATA_CACHE` | `false` | whether anything derived from session content may be cached locally. **The API refuses to boot in production with this enabled** — `ALLOW_SENSITIVE_DATA_CACHE must be false in production` |
| `CLEAR_ON_LOGOUT` | `true` | wipe local caches when the user logs out |

An admin can also collapse the whole client inference chain for a tenant:
`createAiRuntime({ enterpriseOverride: 'off' })` yields `['server']` — no adapter
requested, no device created, no weights downloaded, nothing cached. The runtime works
through the server from the first call. See
[`configuration.md`](configuration.md#前端端點) and
[ADR-0004](adr/0004-webgpu-as-acceleration-layer.md).

## Avatar assets

The avatar runtime animates a **source portrait**. That portrait is a data class with
legal weight, and the avatar spec's §73 is unambiguous about which likenesses may be
used at all:

- self-made characters,
- synthetic characters,
- characters for which consent has been obtained.

Nothing else. Per §73 each avatar asset stores:

```text
source          where the image came from
license         the licence under which it may be used
consent         the consent record for a real likeness
owner           who is accountable for it
created_at      when it entered the system
```

This is recorded in this repository as [ADR-0010](adr/0010-avatar-runtime-decisions.md),
which also carries the §74 licence constraint that matters commercially:
**LivePortrait's code is MIT, but its default InsightFace detection models are
non-commercial research only** and must be replaced before commercial use. That is a
blocker on shipping, not a footnote. Community MLX ports (`fasterliveportrait-mlx`,
`musetalk-mlx`) additionally require pinned SHAs, pinned weight revisions, checksums
and a licence review before they go anywhere near a deployment.

> **Current status.** `services/avatar-runtime/` currently contains
> `app/core/config.py` and is being written now. No avatar asset table, consent record
> or licence field exists in `packages/shared/src/entities.ts` yet; `Persona` carries
> an `avatarUrl` used by the simulation UI for a static portrait. The consent and
> licence records described above are a requirement to implement, not a description of
> what is stored today.

## Data class summary

| Data class | Store | Retention | Who can read it |
|---|---|---|---|
| Source documents | object storage | knowledge-base lifetime | `knowledge.read` + `KnowledgeAcl.view` |
| Parser / OCR intermediates | object storage, `tmp/` prefix | 30 days (bucket rule) | service only |
| Chunk text + metadata | PostgreSQL | knowledge-base lifetime | `knowledge.read` + ACL |
| Chunk vectors | Qdrant | knowledge-base lifetime | never read directly — retrieval only, always tenant-filtered |
| Mining inputs (transcripts, coaching notes) | PostgreSQL, anonymised on entry | mining-draft policy | `content.publish` reviewers |
| Mining draft assets | PostgreSQL | 90 days | reviewers; **never published without a named reviewer** |
| Session transcripts | PostgreSQL | 365 days | the trainee (`result.view_own`), their coach/manager within team scope, reviewers |
| Session audio | object storage (`audio_url`) | **30 days** | same as the transcript |
| Persona state events | PostgreSQL | with the session | same as the transcript |
| Persona **hidden** state | PostgreSQL | with the persona | coach/admin only — **never** reachable from a trainee-scoped response, including through a nested serialiser |
| Evaluations + evidence | PostgreSQL | 1095 days | the trainee, their coach/manager, reviewers |
| Compliance findings | PostgreSQL | with the evaluation | `risk.view`; closure needs `finding.close` |
| Audit events | PostgreSQL | 1825 days | `audit.read` |
| Provider credentials | server-side env / secrets manager | — | the API process. Never a browser, a log, a response or a service unit |
| Browser model cache | the device | until logout when `CLEAR_ON_LOGOUT` | the device's user |
| Avatar source portrait + consent record | see status note above | asset lifetime | workspace admins |

Roles in that last column are `Permission` names from `ROLE_PERMISSIONS` in
`apps/api/app/core/deps.py`; the role-to-permission matrix is in
[`api.md`](api.md#authorisation).
