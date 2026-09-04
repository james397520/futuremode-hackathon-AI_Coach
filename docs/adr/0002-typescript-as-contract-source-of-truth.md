# ADR-0002 — TypeScript is the source of truth for cross-language contracts

- **Status:** accepted
- **Date:** initial architecture pass
- **Spec:** Part I §53 (data model), §55 (streaming event schema), Part II §66 (structured agent output), §92 (state machines)
- **Related:** [ADR-0001](0001-pnpm-workspace-plus-separate-python-app.md)

## Context

[ADR-0001](0001-pnpm-workspace-plus-separate-python-app.md) leaves the same
data shapes declared in two languages. Concretely:

- `packages/shared/src/entities.ts` and `apps/api/app/domain/*.py` both
  describe every entity in Part I §53.
- `packages/shared/src/events.ts` and `apps/api/app/domain/events.py`
  both describe the `StreamingEvent` union of Part I §55 — the realtime wire
  format, where the backend emits and the frontend reduces.
- `packages/shared/src/state-machines.ts` and
  `apps/api/app/domain/enums.py` both describe the Part II §92 state machines.

Nothing in either toolchain can detect a mismatch. The realistic failure is not
a dramatic one: the backend emits `score.update`, the frontend has a reducer
case for `score.updated`, the event falls through the default branch, and the
live score panel is quietly empty for some sessions. That takes a long time to
diagnose and no test catches it, because both sides pass their own tests.

Four ways to remove the ambiguity:

1. **Generate TypeScript from Python** (Pydantic → JSON Schema →
   `json-schema-to-typescript`).
2. **Generate Python from TypeScript** (`ts-json-schema-generator` →
   `datamodel-code-generator`).
3. **A neutral IDL** — Protobuf, or a hand-maintained JSON Schema — generating
   both.
4. **Hand-maintain both, declare one the source of truth, and enforce agreement
   with a check.**

## Decision

**TypeScript is the source of truth. Pydantic mirrors it. A drift guard
enforces agreement.**

Three parts:

**1. Direction.** `packages/shared/src/**` is authoritative. Any contract
change starts there.

**2. Mirroring rule.** `apps/api/app/domain/**` mirrors it with **byte-identical
field names and byte-identical enum literal values**. Python-side naming
conventions do not apply to wire fields: the field is `hidden_need`, not
`hiddenNeed` and not `hidden_need_` — it is whatever the TypeScript says. Where
a wire field collides with a Python keyword (`runtime.fallback` carries a field
named `from`), it is aliased, and the alias preserves the wire name.

**3. Enforcement.** `scripts/check-contracts.sh` extracts the `type:`
discriminant literals from both files and fails if the sets differ **in either
direction**. It runs as its own CI job (`contracts`) so it still reports when
the `web` or `api` job is red for an unrelated reason, and it is called from
`bootstrap.sh` so a developer sees drift locally before pushing.

Both directions matter. A literal in TypeScript with no Python counterpart means
the frontend has a reducer for an event the backend cannot emit — dead code. A
literal in Python with no TypeScript counterpart is worse: the backend emits an
event the frontend silently drops, and Part I §55 explicitly forbids either side
inventing an undeclared event.

### Why TypeScript and not Python

- **The wire format is JSON, and TypeScript's discriminated unions describe JSON
  natively.** `StreamingEvent` is eighteen variants sharing a `seq` /
  `session_id` / `at_ms` base and discriminated on `type`. In TypeScript that is
  a union and `switch (event.type)` is exhaustively checked by the compiler. The
  Pydantic equivalent needs eighteen classes plus an annotated discriminated
  union — correct, but it is the derived form, not the natural one.
- **The frontend has more contract surface.** Every entity, every event, every
  enum reaches the UI. The backend touches subsets. Errors are cheapest where
  the compiler checks the most.
- **`as const` arrays are both a type and a runtime value.** `SKILL_KEYS`,
  `SESSION_STATES`, `ROLES` and `AGENT_NAMES` are simultaneously the enum type
  and the iterable the UI renders. Python needs a `StrEnum` plus a separate
  ordering.
- **The contract package already has zero runtime dependencies.**
  `packages/shared` is types only — no React, no runtime imports — so
  every other package can depend on it without weight.

### Why not code generation, in either direction

This was the closest call, and generation was rejected on four counts:

- **Neither generator round-trips the interesting parts.** Pydantic → JSON
  Schema → TypeScript turns a discriminated union into `anyOf` with no
  discriminant, producing types you cannot `switch` on. The reverse direction
  loses Pydantic validators, `SecretStr`, and field aliases — all of which
  `apps/api/app/domain` legitimately uses.
- **Generated code is unreviewable.** A contract change is exactly the change
  that most deserves human eyes on the diff. A 2,000-line regenerated file
  hides which field moved.
- **A generator is a build-order dependency between the two toolchains**, which
  is the coupling ADR-0001 deliberately avoided. CI would have to install Node
  to check Python, or vice versa.
- **The mirror carries information the source cannot.** The Pydantic side adds
  validators, cross-field checks and the `from`-keyword alias. Generation would
  overwrite them or require a merge step, which is worse than writing them.

### Why not a neutral IDL

Protobuf or hand-written JSON Schema would give a single authoritative
definition and real generated code for both sides. Rejected because: the wire
format is JSON over WebSocket, not protobuf, so a `.proto` would be a schema
language used purely for codegen; the spec's contract is *already* written in
TypeScript-shaped terms (Part I §54 and Part II §59 give literal TypeScript
snippets); and it introduces a third language nobody writes day to day.

## Consequences

### Good

- **The expensive bug class is closed by a script that runs in about a second.**
  It costs one CI job and catches the failure that would otherwise take a day to
  find.
- **One unambiguous direction.** "Which side do I change first?" has a single
  answer, so a contract change never becomes a negotiation.
- **Both sides keep idiomatic, hand-written, reviewable code.** The Pydantic
  models can carry validators the TypeScript cannot express, and the TypeScript
  can carry `as const` arrays Python has no equivalent for.
- **The guard is honest about its own limits** and says so in its output rather
  than pretending to a completeness it does not have.

### Bad, and what we do about it

- **Duplicated effort.** Every contract change is written twice. Accepted: the
  contract surface is bounded (Part I §53's entity list is finite) and the
  second write is mechanical.
- **The guard only checks event *type literals*, not field shapes.** A renamed
  field inside `PersonaSimulationState` passes. This is the real gap. Two
  mitigations: `scripts/seed.py` round-trips its whole payload through the
  Pydantic models, which catches field drift on the entities it covers; and the
  PR template requires the TS-first ordering explicitly. A JSON-fixture
  round-trip test in both languages is the proper fix and belongs in Phase 1.
- **The extractors are grep, not parsers.** They rely on the literals appearing
  as plain quoted strings on the same line as the `type:` key — which is the
  house style in both files. If either file changes shape, the guard fails
  loudly with "extracted zero literals" rather than passing vacuously. That
  failure mode was designed in.
- **Discipline is required at review time.** A reviewer has to notice a Python
  change with no TypeScript change. The PR checklist makes this explicit rather
  than relying on memory.

## The protocol, for reference

```
1. Change packages/shared/src/*.ts             — the source of truth
2. Mirror into apps/api/app/domain/*.py              — identical field names
                                                       and enum literals
3. Run scripts/check-contracts.sh              — must pass
4. Both changes in the SAME commit                   — never one without the other
```

`scripts/check-contracts.sh --list` prints both sets side by side when
you want to see what it is comparing.
