# ADR-0001 — pnpm workspace for JavaScript, a standalone Python app alongside it

- **Status:** accepted
- **Date:** initial architecture pass
- **Spec:** Part II §63 (backend architecture), §64 (stack), §101 (technical decision summary)
- **Supersedes / superseded by:** —

## Context

The spec fixes the two halves of the stack independently and for good reasons.
The frontend is Next.js + React + TypeScript because the product is a
design-heavy realtime web application (Part II §48.1, §101). The AI
orchestration layer is Python FastAPI because that is where the ecosystem
actually lives: the LLM SDKs, the document parsers, the OCR bindings, the
tokenizers, the vector-store clients, the reranking models. Neither choice is
negotiable without giving up something the spec requires.

That leaves a repository-layout question rather than a technology question. Four
options were on the table:

1. **Two repositories.** Frontend and backend evolve separately.
2. **One JS workspace with Python wedged in.** Add `apps/api` as a workspace
   package with a `package.json` that shells out to Python.
3. **A polyglot build tool** — Bazel, Pants, or Nx with a Python plugin — owning
   both toolchains.
4. **A pnpm workspace covering only the JS packages, with `apps/api` as a
   self-contained Python project next to it.**

The deciding constraint is the cross-language contract. `StreamingEvent`
(Part I §55) is a wire format both sides must agree on exactly, and the same is
true of every entity in Part I §53 and every state machine in Part II §92. A
change to one side that does not reach the other produces a silent runtime
mismatch, not a build error.

## Decision

**Option 4.** `pnpm-workspace.yaml` covers `apps/web` and `packages/*`.
`apps/api` is a normal Python project with its own `pyproject.toml`, its own
virtualenv and its own tooling (ruff, mypy, pytest). It is deliberately *not* a
pnpm workspace package.

The two halves are joined by three things and nothing else:

- **One repository**, so a contract change can be one atomic commit.
- **One environment file** at the root (`.env`), read by both.
- **One drift guard**, `scripts/check-contracts.sh`, which compares the
  streaming-event literals in `packages/shared/src/events.ts` against
  those in `apps/api/app/domain/events.py` and fails CI if they diverge.

Root `package.json` provides thin conveniences (`pnpm api:dev`, `pnpm infra:up`)
that shell out. It does not attempt to model Python dependencies.

## Consequences

### Good

- **Atomic contract changes.** The single most valuable property. TypeScript and
  Pydantic change in one commit, one PR, one review — and CI verifies they
  agree. Two repositories would make this a two-PR dance with a window where
  `main` is inconsistent.
- **Each toolchain stays idiomatic.** `pnpm install` behaves exactly as a pnpm
  user expects; `pip install -e '.[dev]'` behaves exactly as a Python developer
  expects. Nobody learns a bespoke build system to change a file.
- **CI parallelises naturally.** The `web` and `api` jobs share nothing, cache
  differently (pnpm store vs pip cache) and fail independently.
- **Container builds stay simple.** `web.Dockerfile` needs the JS workspace;
  `api.Dockerfile` needs `apps/api/pyproject.toml`. Neither drags the other's
  toolchain into its image.
- **Ownership maps cleanly.** `docs/PROJECT_STRUCTURE.md` §5 assigns subtrees to
  owners for parallel work, and the language boundary lines up with the
  ownership boundary.

### Bad, and what we do about it

- **No enforced contract at the type level.** `tsc` cannot see the Python and
  `mypy` cannot see the TypeScript. This is the real cost, and it is why
  [ADR-0002](0002-typescript-as-contract-source-of-truth.md) exists and why the
  drift guard is a first-class CI job rather than a nice-to-have.
- **Two dependency-update flows.** Dependabot/Renovate must be configured for
  both ecosystems; `.github/workflows/security.yml` runs both `pnpm audit` and
  `pip-audit` for the same reason.
- **Two version pins to keep in step.** Node 20 appears in `.nvmrc`,
  `web.Dockerfile` and `ci.yml`; Python 3.11 in `pyproject.toml`,
  `api.Dockerfile`, `worker.Dockerfile` and `ci.yml`. Each site carries a
  "keep in sync with" comment. A shared version file would be tidier and was
  judged not worth another indirection.
- **No shared task runner.** There is no single `make all`. `bootstrap.sh`
  covers the onboarding path, which is the case that actually matters.

### Rejected alternatives

- **Two repositories** — rejected because it makes the contract change
  non-atomic, which is precisely the failure this repository is most exposed to.
- **Python inside the JS workspace** — rejected as dishonest packaging. A
  `package.json` whose scripts shell out to `uvicorn` gives no real integration,
  breaks `pnpm -r build`, and confuses tooling that reasonably assumes a
  workspace package is JavaScript.
- **Bazel / Pants / Nx-with-Python** — rejected on cost. A polyglot build graph
  is genuinely valuable at a scale where a change must be traced across dozens
  of packages. Here it would add a build system every contributor has to learn,
  to solve a problem that one 200-line shell script solves.
