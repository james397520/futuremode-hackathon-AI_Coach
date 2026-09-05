<!--
Keep this short. The point of the template is the checklists at the bottom —
they exist because these are the four things that have actually gone wrong in
this codebase's problem space, not because checklists are nice.
-->

## What

<!-- One or two sentences. What changes, and why now. -->

## Spec reference

<!--
Which section of docs/spec/AI_Coach_Spec_v3.md does this implement or change?
Note that the spec has TWO numbering sequences: Part I (product, §1–§61) and
Part II (UI / architecture, §0–§102). Disambiguate as e.g. "Part II §55".
If this is infrastructure or a refactor with no spec section, write "n/a".
-->

Section:

## Ownership

<!--
docs/PROJECT_STRUCTURE.md §5 is the authoritative map of who owns which
subtree. Confirm every path you touched falls inside one owner's tree, or say
which owners you coordinated with.
-->

- [ ] Every path in this diff is inside a single owner's subtree per `docs/PROJECT_STRUCTURE.md`
- [ ] Or: crossing owners was necessary, and I have said why below

## How to verify

<!-- The commands a reviewer should run, and what they should see. -->

```
```

---

## Checklists

Delete any section that genuinely does not apply. Do not delete a section
because you are unsure — an unsure section is the one that needs the review.

### Always

- [ ] `pnpm -r typecheck && pnpm -r lint` passes
- [ ] `pytest` passes in `apps/api` (if the diff touches it)
- [ ] `scripts/check-contracts.sh` passes
- [ ] No new file lives somewhere `docs/PROJECT_STRUCTURE.md` does not sanction

### If this touches the cross-language contract

`packages/shared/**` or `apps/api/app/domain/**`

- [ ] TypeScript changed **first** — it is the source of truth (`docs/adr/0002`)
- [ ] Pydantic mirrored in the **same commit**, with byte-identical field names
      and enum literal values
- [ ] `scripts/check-contracts.sh` run locally and passing
- [ ] Every new streaming event is declared in `StreamingEvent`; nothing emits
      an undeclared event (Part II §55)

### If this touches tenant isolation, RBAC, or the safety layer

Any of `app/core/security`, `app/core/deps`, `app/agents/compliance`,
`app/services/safety`, `app/db/models`, or a router's authorisation.

- [ ] Every new query filters on `tenant_id` **and** `workspace_id` (§74).
      A query that filters on only one of them is the bug this checklist item
      exists for.
- [ ] Every new table carrying tenant data has both columns, non-nullable, and
      an index that leads with them
- [ ] A test asserts that tenant A cannot read tenant B's row — not that the
      happy path works, but that the cross-tenant path is **denied**
- [ ] Role checks use the §9 role set (`trainee`/`coach`/`manager`/`admin`/`reviewer`)
      and deny by default
- [ ] Persona `hidden` state (§16.3) is not reachable by a `trainee`-scoped
      response, including through a nested serialiser
- [ ] Coach hints and `next_strategy` insights are suppressed in
      `assessment` mode (§8.4 / §24)
- [ ] The server remains authoritative for safety, reranking and scoring; no
      client-supplied score, rerank order or safety verdict is trusted (§51–§55)
- [ ] New mutating action emits an `AuditEvent` with a real `risk` level (§42)
- [ ] No provider credential moved closer to the browser. `NEXT_PUBLIC_*` still
      contains nothing secret (§56 / §70 / §71)

### If this touches UI

- [ ] Colours come from `packages/design-tokens` CSS variables. **No hex
      literals**, no `rgb()` literals, no Tailwind palette colours (§99)
- [ ] Generic visual components went to `packages/ui`, not `apps/web`
- [ ] Light, dark and system themes all checked. Dark mode is not an inversion
      of light (§98)
- [ ] Nothing on the §99 forbidden list: pure-black backgrounds, neon cyan
      outlines, purple gradient text, per-card colours, pie/gauge overload,
      left-right chat bubbles, a permanent 240px sidebar, 8px radii, Bootstrap
      tables, filled material cards, heavy borders, excessive shadows,
      unreadable transparent glass
- [ ] Keyboard reachable, focus visible, contrast checked (§47)
- [ ] Server state via TanStack Query, session/client state via Zustand
      (§48.4 / §48.5)

### If this touches the client inference runtime

- [ ] The feature still works with WebGPU unavailable — WASM and server
      fallbacks both exercised (§51 / §62)
- [ ] The ML/WebGPU code is dynamically imported and stays out of the initial
      bundle (§96)
- [ ] Inference runs in a Worker; nothing blocks the main thread (§49.1 / §58)
- [ ] GPU resources are released on idle timeout (§60)
- [ ] Local model cache respects `RuntimePolicy` (§61 / §97)

### If this touches infra or CI

- [ ] `scripts/bootstrap.sh --check-services` succeeds against configured services
- [ ] `scripts/bootstrap.sh` is still idempotent — I ran it twice
- [ ] New service has a healthcheck and a documented backup strategy
- [ ] A new secret is documented in `.env.example` **with an empty value**

## Notes for the reviewer

<!-- Anything you want looked at particularly hard, or a decision you are unsure about. -->
