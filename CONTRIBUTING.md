# Contributing

Five rules carry most of the weight. If you read nothing else:

1. **Check [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md) before adding
   a file.**
2. **Contract changes go TypeScript first**, mirrored to Pydantic in the same
   commit, verified by `infra/scripts/check-contracts.sh`.
3. **No hex literals.** Colours come from design tokens.
4. **Nothing on the Part II §99 forbidden list.**
5. **Tenant isolation, RBAC and the safety layer get the extra review
   checklist.** Untested isolation is not isolation.

Everything below is detail on those.

> **Spec section numbers.** The specification has two independent numbering
> sequences: **Part I** (product and functional requirements, §1–§61) and
> **Part II** (UI, WebGPU, frontend and backend architecture, §0–§102). A bare
> "§55" is ambiguous, so write "Part I §55". Where the two parts conflict, Part
> I wins on product and business rules, Part II wins on visual and frontend
> engineering.

---

## 1. The ownership map

[`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md) is **the single
authoritative definition of where things go**. It exists because multiple people
and agents work on this repository in parallel, and §5 of it assigns subtrees to
owners.

**Before you create a file, find where it belongs in that document.** If it does
not appear there, that is the conversation to have — not a judgement call in the
moment.

The boundaries that get crossed most often:

| Rule | Why |
|---|---|
| Generic visual components → `packages/ui`, **never** `apps/web` | A `Button` in a feature folder is how a second, divergent design system starts ([ADR-0003](docs/adr/0003-custom-design-system-over-shadcn-theme.md)) |
| `packages/ui` carries **no business semantics** | No `PersonaCard`, no `ScenarioPill`. Those are app-level, and they make the UI package accrete product knowledge |
| `apps/web/src/app/` holds **routes and layout only** | Business logic lives in `features/`. A page component that fetches, transforms and renders is a page that cannot be reused or tested |
| Routers do **I/O conversion only** | Business logic → `services/`. LLM behaviour → `agents/`. A router with a `for` loop over domain objects is in the wrong place |
| `packages/shared-types` has **zero runtime dependencies** | No React, no imports with side effects. Every other package depends on it, so weight there is weight everywhere |
| `packages/ai-runtime` contains **no UI** | It is an inference abstraction. Rendering a badge from it couples the two |

When work genuinely spans two owners: say so in the PR, and say who you
coordinated with. The PR template asks.

---

## 2. The contract change protocol

The single most dangerous change in this repository is one that alters a shape
crossing the TypeScript↔Python boundary. `tsc` cannot see the Python and `mypy`
cannot see the TypeScript, so the failure is silent: the backend emits
`score.update`, the frontend reduces `score.updated`, the event falls through the
default case, and the live score panel is quietly empty for some sessions.
Nothing fails. Both test suites pass.

**TypeScript is the source of truth.** Always. See
[ADR-0002](docs/adr/0002-typescript-as-contract-source-of-truth.md).

```
1. Change  packages/shared-types/src/*.ts          ← the source of truth
2. Mirror  apps/api/app/domain/*.py                ← identical field names,
                                                      identical enum literals
3. Run     infra/scripts/check-contracts.sh        ← must pass
4. Commit  both changes in the SAME commit         ← never one without the other
```

**Rules for the mirror:**

- **Field names are byte-identical.** Python naming convention does not apply to
  wire fields. The field is `hidden_need`, because that is what the TypeScript
  says.
- **Enum literal values are byte-identical.** `'needs_discovery'` on both sides.
  The Python `StrEnum` *member name* may differ; its *value* may not.
- **A wire field colliding with a Python keyword is aliased**, and the alias
  preserves the wire name. `runtime.fallback` carries a field named `from`; the
  Pydantic model aliases it and the JSON stays `from`.
- **Never add an event on the Python side first.** Part I §55 forbids either
  side inventing an undeclared event, and a Python-only literal is worse than a
  TypeScript-only one: the backend will emit something the frontend silently
  drops.

**What the drift guard does and does not catch.** It compares the `type:`
discriminant literals in both directions and fails on any difference. It does
**not** compare field shapes — a renamed field inside
`PersonaSimulationState` passes. Two partial mitigations: `infra/scripts/seed.py`
round-trips its whole payload through the Pydantic models, and the PR checklist
asks explicitly. A JSON-fixture round-trip test in both languages is the proper
fix and is Phase 1 work. Until then, this one is on the reviewer.

```bash
infra/scripts/check-contracts.sh          # fails on drift, either direction
infra/scripts/check-contracts.sh --list   # print both sets side by side
```

---

## 3. Commits

[Conventional Commits](https://www.conventionalcommits.org/), because the type
and scope are what make `git log` navigable in a repository with this many
independent subtrees.

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**

| Type | Use |
|---|---|
| `feat` | new capability |
| `fix` | bug fix |
| `refactor` | behaviour-preserving change |
| `perf` | performance |
| `docs` | documentation |
| `test` | tests |
| `build` | build, deps, Docker |
| `ci` | workflows |
| `chore` | everything else |
| `revert` | a revert |

**Scopes** mirror the ownership map: `web`, `api`, `agents`, `rag`, `ws`,
`workers`, `ui`, `tokens`, `types`, `runtime`, `infra`, `ci`, `docs`, `spec`.

**Subject:** imperative mood, no trailing full stop, ≤ 72 characters. "add
retrieval playground", not "added" or "adds".

**Body:** *why*, not *what*. The diff says what. Reference the spec section.

**Footer:** `Closes #123`. `BREAKING CHANGE:` for anything that alters the
cross-language contract, a state machine, or the API surface.

```
feat(rag): add table-aware chunking strategy

Product PDFs put coverage limits in tables, and paragraph chunking split
rows from their headers — retrieval returned a limit with no idea which
product it belonged to.

Implements the table_aware value of ChunkStrategy (Part I §11.3).

Closes #142
```

```
fix(types): rename score.update to score.updated

The Pydantic mirror had score.update while the TypeScript union declared
score.updated, so the frontend dropped every live score event. Caught by
check-contracts.sh once the guard was added.

BREAKING CHANGE: any client reducing score.update must be updated.
```

**One logical change per commit.** A contract change is one commit spanning two
languages — that is the exception the protocol above requires, not a violation of
this rule.

---

## 4. Design tokens: no hex literals

Part II §99 forbids hardcoded colour, and it is enforceable rather than
aspirational.

**Colours come from `packages/design-tokens` CSS variables. Nothing else.**

```tsx
// ✗ no
<div className="bg-[#f0f4ff] border-[#e2e8f0]" />
<div style={{ color: '#5b8def' }} />
<div className="bg-blue-50 border-slate-200" />   // Tailwind's palette is
                                                   // also not our palette

// ✓ yes
<div className="bg-surface-glass border-border-subtle" />
<div className="text-accent-primary" />
```

This covers hex, `rgb()`, `hsl()`, named CSS colours and Tailwind's default
palette. All of them bypass the token system, and the token system is what makes
light and dark mode two authored designs rather than one design and an inversion
(Part II §98).

The same applies to the other visual constants — blur radii, shadows, corner
radii, spacing steps and the aurora gradient stops all live in the token
package. A magic `blur(12px)` in a component is the same category of mistake as
a hex literal.

**Need a colour that does not exist?** Add a token. That is a
`packages/design-tokens` change with its own review, which is the correct amount
of friction for introducing a new colour to the product.

Dark mode is not an inversion. Part II §98's framing: imagine the reference
image *at night* — glass still transparent, blue-violet light more prominent,
white borders becoming low-opacity white. Check both themes, and `system`.

---

## 5. The Part II §99 forbidden list

Verbatim, because it is short and specific. **Do not:**

- Pure black backgrounds
- Neon cyan outlines
- Large amounts of purple gradient text
- A different colour per card
- Too many pie charts
- Too many gauges
- ChatGPT-style left/right chat bubbles
- A permanently-resident 240px sidebar taking up space
- 8px border radius
- Bootstrap-style tables
- Material-design filled cards
- Heavy borders
- Excessive shadows
- Glass cards so transparent the text cannot be read
- **Treating WebGPU as the only backend the browser must support**

Notes on the ones people argue about:

- **The transcript is not a chat.** Part II §102 says "transcript 文件感" — a
  document feel. Left-right bubbles are explicitly forbidden. It reads as a
  transcript, because that is what it is.
- **The icon rail is narrow, not a sidebar.** See
  `apps/web/src/components/app-shell/icon-rail.tsx`.
- **Glass must be readable.** Frosted, not invisible. If you cannot read the
  text over a busy background, the glass is wrong — not the background.
- **The last item is architectural, not visual**, and it is the one with real
  consequences. See
  [ADR-0004](docs/adr/0004-webgpu-as-acceleration-layer.md).

---

## 6. Review checklist for sensitive changes

Some changes get an ordinary review. These get a second reader and this
checklist. The full version is in
[`.github/pull_request_template.md`](.github/pull_request_template.md); this
section is the reasoning.

### 6.1 Tenant isolation

**Triggers:** `app/db/models/**`, `app/core/tenancy.py`, `app/core/context.py`,
`app/rag/vectorstore.py`, any new query, any new table.

- [ ] Every new tenant-scoped table has **both** `tenant_id` and `workspace_id`,
      non-nullable, with an index that leads with them.
- [ ] Every new query filters on **both**.
- [ ] Qdrant points carry `tenant_id`, `workspace_id` and `knowledge_base_id`,
      payload-indexed, and every search passes a payload filter on all three.
- [ ] `KnowledgeAcl` is checked in addition to tenancy. Being in the right
      tenant does not imply access to a knowledge base within it (Part I §39).
- [ ] **A test asserts that tenant A cannot read tenant B's row.** Not that the
      happy path works — that the cross-tenant path is *denied*.

> **Why "both" is the whole point.** Filtering on `workspace_id` alone *works*.
> Workspace ids are unique in practice, so the query returns the right rows in
> testing, in staging, and in production — right up until an id is guessed or
> reused. This is the single most likely serious bug in the codebase, and it
> passes every test that only checks the happy path.

### 6.2 RBAC

**Triggers:** `app/core/security.py`, `app/core/deps.py`, `lib/rbac.ts`, any
router's authorisation, any serialiser.

- [ ] Deny by default. A new endpoint without an explicit role requirement is a
      bug, not a permissive default.
- [ ] Roles come from the Part I §9 set: `trainee`, `coach`, `manager`, `admin`,
      `reviewer`.
- [ ] **`PersonaHiddenState` is not reachable by a trainee-scoped response** —
      including through a nested serialiser. Hidden need, trigger points,
      objections, forbidden knowledge and exit condition are coach/admin only
      (Part I §16.3). This is where it breaks: the persona serialises correctly
      at the top level and leaks through a scenario's nested persona.
- [ ] Coach hints and `next_strategy` insights are **suppressed server-side** in
      `assessment` mode (Part I §8.4 / §24). Not hidden client-side — if the
      data reached the browser, the rule is already broken.
- [ ] Manager and coach scopes are limited to their own team.
- [ ] An author cannot publish their own AI-generated content (Part I §38).
- [ ] A mutating action emits an `AuditEvent` with a real `risk` level
      (Part I §42).

### 6.3 The safety layer

**Triggers:** `app/agents/compliance_agent.py`, `app/services/safety.py`,
`packages/ai-runtime/src/tasks/safety-precheck.ts`, scoring, reranking.

- [ ] **The server remains authoritative.** No client-supplied score, rerank
      order or safety verdict is persisted, and none can create, suppress or
      downgrade a `ComplianceFinding`.
- [ ] A `ComplianceFinding` carries evidence: the transcript quote, the policy
      rule, an explanation, a suggested correction. A finding without evidence
      is not reviewable and therefore not actionable.
- [ ] A `SkillScore` carries `evidence`. Part I §27 forbids a bare number —
      `Empathy 74` on its own is a spec violation, not a UI shortcut.
- [ ] Prompt-injection handling covers the Part I §21 cases: ambiguous,
      off-topic, over-scope, role escape, injection.
- [ ] Proxy and application logs do not contain transcript text or knowledge
      queries. That content belongs in the database under retention policy.
- [ ] Runtime telemetry stays content-free. Part I §49.5 permits WebGPU backend
      telemetry and forbids collecting sensitive content.

### 6.4 Secrets

- [ ] No provider credential moved closer to the browser.
- [ ] Nothing credential-shaped in `NEXT_PUBLIC_*`. Next.js inlines that
      namespace into the client bundle, so the name alone is the violation —
      an empty value today is not a defence. CI fails on this.
- [ ] A new secret is added to `.env.example` **with an empty value** and read
      through `app/core/config.py` as a `SecretStr`.
- [ ] Nothing secret in a Docker build arg. Build args are visible in image
      history.

---

## 7. Working on the repository

### Setup

```bash
infra/scripts/bootstrap.sh          # idempotent; see README for the manual path
```

### Before pushing

```bash
pnpm -r typecheck
pnpm -r lint
cd apps/api && ruff check . && ruff format --check . && mypy && pytest; cd -
infra/scripts/check-contracts.sh
```

### Formatting

Settled, and deliberately not up for discussion — see the comments in
[`.prettierrc`](.prettierrc). Semicolons yes, single quotes in TS, double in JSX
attributes, 100 columns to match ruff's `line-length`. Python is formatted by
`ruff format`, not Prettier. `.editorconfig` covers editors without either.

Reformatting the repository hands every open branch a conflict, so a change to
these values needs a much better reason than a preference.

### Testing

- **API:** pytest in `apps/api/tests/`. CI runs it against real Postgres, Redis
  and Qdrant service containers — specifically so the tenant-isolation tests are
  meaningful rather than mocked.
- **Contracts:** `infra/scripts/check-contracts.sh`, in CI as its own job.
- **Infra:** CI runs `bash -n`, shellcheck, `docker compose config` for all
  three profiles, and `seed.py --dry-run`.

### The mock stream

`apps/web/src/features/simulation/mock/mock-event-stream.ts` emits real
`StreamingEvent` values on a timer so the simulation UI can be built without a
backend. Two rules while it exists:

- **It must emit only declared events.** It is a consumer of the contract, not
  an exception to it. An event that exists only in the mock is a lie about what
  the backend can do.
- **Do not build a second one.** Fixtures in `apps/web/src/lib/fixtures/` cover
  the resource-shaped data; the mock covers the socket. That is the whole
  inventory, and [`docs/ROADMAP.md`](docs/ROADMAP.md) lists it so the debt stays
  visible.

---

## 8. Pull requests

Fill in [the template](.github/pull_request_template.md). Delete a checklist
section only if it *genuinely* does not apply — an unsure section is the one that
needs review.

- **Small and focused.** One logical change.
- **Say which spec section it implements**, with the Part.
- **Say how to verify it.** The commands a reviewer should run and what they
  should see.
- **Flag ownership crossings.** If the diff spans two owners' subtrees, say why
  and who you coordinated with.

Reviewers: for anything in section 6, the question is not "does this look
right?" but "is there a test that proves the denial path?".

---

## 9. Where to look things up

| Question | Answer |
|---|---|
| What must the product do? | [`docs/spec/AI_Coach_Spec_v3.md`](docs/spec/AI_Coach_Spec_v3.md) — authoritative |
| Where does this file go? | [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md) — authoritative |
| How does it fit together? | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| What is actually built? | [`docs/ROADMAP.md`](docs/ROADMAP.md) — honest |
| Why is it like this? | [`docs/adr/`](docs/adr/) |
| How do I run it? | [`README.md`](README.md), [`infra/scripts/bootstrap.sh`](infra/scripts/bootstrap.sh) |

`docs/ARCHITECTURE.md` ends with a table mapping every spec section to the
directory that implements it. That is the fastest way from "§65 says X" to the
code.
