# Architecture Decision Records

One file per decision. Each records the **Context** that forced a choice, the
**Decision** taken, and the **Consequences** — including the bad ones, which are
the part worth writing down.

These are not proposals. Every ADR here documents a decision that is already
made and already visible in the repository. If you disagree with one, that is a
new ADR that supersedes it, not an edit to the existing file.

| # | Decision | Spec |
|---|---|---|
| [0001](0001-pnpm-workspace-plus-separate-python-app.md) | pnpm workspace for JavaScript, a standalone Python app alongside it | Part II §63, §64, §101 |
| [0002](0002-typescript-as-contract-source-of-truth.md) | TypeScript is the source of truth for cross-language contracts | Part I §53, §55; Part II §66, §92 |
| [0003](0003-custom-design-system-over-shadcn-theme.md) | A custom design system over an off-the-shelf shadcn theme | Part II §48.2, §98, §99, §102 |
| [0004](0004-webgpu-as-acceleration-layer.md) | WebGPU is an acceleration layer, server stays authoritative | Part II §51–§62, §96, §97 |
| [0005](0005-qdrant-as-production-vector-store.md) | Qdrant in production; Chroma and FAISS are POC-only | Part I §12.2; Part II §64, §74 |
| [0006](0006-fastapi-alongside-nextjs.md) | FastAPI for AI orchestration, alongside Next.js | Part II §63, §64, §70, §71 |
| [0007](0007-zustand-and-tanstack-query.md) | Zustand for session state, TanStack Query for server state | Part II §48.4, §48.5 |
| [0008](0008-version-pinned-sessions.md) | A session pins the scenario and persona versions it ran against | Part I §54, §28, §30 |

## Writing a new one

```markdown
# ADR-000N — <the decision, as a sentence>

- **Status:** proposed | accepted | superseded by ADR-000M
- **Date:**
- **Spec:**

## Context
What forced a choice. The constraints, the options, and what actually
discriminates between them.

## Decision
What we do. Present tense, specific enough to check code against.

## Consequences
### Good
### Bad, and what we do about it
### Rejected alternatives
```

Two conventions:

- **Cite the spec part.** The specification has two independent numbering
  sequences — Part I (§1–§61, product) and Part II (§0–§102, UI and
  architecture) — so a bare "§55" is ambiguous. Write "Part I §55".
- **Be honest in Consequences.** An ADR listing only benefits is marketing. The
  "bad" section is what makes the record useful to whoever reads it in a year
  wondering why the code looks like this.
