# Troubleshooting

Symptom → cause → fix, for problems this project actually hit. Every entry below was
a real debugging session; none of them are hypothetical.

The general principle worth internalising first: **the expensive bugs in this
repository are the silent ones.** A stack trace is cheap. What costs a day is a
stylesheet request that is rewritten and fails with no console error, an event literal
that exists in one language and not the other, or a script that resolves a path one
directory too high and reports the file as missing rather than as unfound.

## Contents

- [`check-contracts.sh` reports a missing `events.ts`](#check-contractssh-reports-a-missing-eventsts)
- [`pnpm: command not found`, or a corepack signature failure](#pnpm-command-not-found-or-a-corepack-signature-failure)
- [The web app renders as unstyled text](#the-web-app-renders-as-unstyled-text)
- [`len(app.routes)` says 5 and you expected 75](#lenapproutes-says-5-and-you-expected-75)
- [Python 3.14 on the dev machine, 3.11 in the spec](#python-314-on-the-dev-machine-311-in-the-spec)
- [A service reports not-ready](#a-service-reports-not-ready)
- [Qdrant dimension mismatch after switching embedding models](#qdrant-dimension-mismatch-after-switching-embedding-models)
- [The avatar runtime is unavailable](#the-avatar-runtime-is-unavailable)

## `check-contracts.sh` reports a missing `events.ts`

**Symptom**

```text
✗ missing packages/shared/src/events.ts — the contract source of truth must exist
```

…while the file is plainly there, and `ls packages/shared/src/events.ts` succeeds.

**Cause**

The script derives everything from one line:

```bash
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
```

The guard used to live at `infra/scripts/check-contracts.sh`, two levels below the
repository root, so it needed `/../..`. When the repository was restructured to
open-source conventions (`0fa2af6`) the script moved to `scripts/`, one level down —
and the `/../..` came with it. `REPO_ROOT` then resolved to the *parent of the
repository*, `TS_EVENTS` pointed at a path outside the checkout, and the precondition
check reported it as missing. Nothing about the message hints at the real problem,
because from the script's point of view the file genuinely was not there.

**Fix**

Fixed; the guard runs and currently reports:

```text
✓ streaming-event contract in sync — 26 literals match across TS and Python
```

**How to spot the same class of bug.** Any script that computes a root from
`BASH_SOURCE` has a hard dependency on its own depth in the tree, and moving the file
is a silent breaking change — `bash -n` passes, shellcheck passes, and the failure
message points at the wrong file. When a path-derived script reports something
missing, print the derived root before believing it:

```bash
bash -x scripts/check-contracts.sh 2>&1 | head -5
```

`scripts/bootstrap.sh` computes `REPO_ROOT` the same way and is exposed to exactly
the same mistake. If you move either script, re-check the `..` count in the same
commit.

## `pnpm: command not found`, or a corepack signature failure

**Symptom**

Either `pnpm: command not found`, or corepack failing to fetch and verify the pnpm
tarball:

```text
Error: Cannot find matching keyid: {"signatures":[...],"keyid":"SHA256:..."}
```

**Cause**

Corepack ships a pinned set of npm registry signing keys. On an older corepack those
keys are stale relative to the registry's current signatures, so integrity
verification fails on a package that is in fact fine.

**Fix**

Either bypass the check for the invocation:

```bash
COREPACK_INTEGRITY_KEYS=0 corepack pnpm install
COREPACK_INTEGRITY_KEYS=0 corepack pnpm -r typecheck
```

…or install pnpm directly and stop routing through corepack:

```bash
npm i -g pnpm@9.12.0
```

`package.json` pins `packageManager: pnpm@9.12.0`, so both routes give you the version
CI uses. `scripts/bootstrap.sh` calls `corepack enable` only when `pnpm` is not
already on `PATH`, so a directly-installed pnpm takes precedence and sidesteps the
problem entirely.

## The web app renders as unstyled text

The page loads. The HTML is all there. None of the CSS is. There are **two distinct
causes**, and they need different fixes — check which one you have before acting.

### Cause A — two `next dev` processes on one `.next/`

**Symptom.** 500s from the dev server, and errors mentioning
`routes-manifest.json` or another artefact under `.next/`.

**Cause.** Two `next dev` processes writing the same `.next/` directory interleave
their writes and corrupt the build manifests. This happens easily: a dev server left
running in another terminal, or a second one started by a tool.

**Fix.**

```bash
pkill -f 'next dev'                       # or find them: ps aux | grep 'next dev'
rm -rf apps/web/.next
COREPACK_INTEGRITY_KEYS=0 corepack pnpm dev
```

One dev server at a time. `pnpm dev` is `pnpm --filter @ai-coach/web dev`; running it
twice is the whole bug.

### Cause B — `upgrade-insecure-requests` on a LAN IP

**Symptom.** The page renders as unstyled text when reached at
`http://192.168.x.x:3000`, and correctly at `http://localhost:3000`. The console
shows **no error** — the failed requests do not even appear as failures in the usual
place.

**Cause.** The Content-Security-Policy directive `upgrade-insecure-requests` tells the
browser to silently rewrite every subresource fetch from `http://` to `https://`.
Chrome exempts `localhost` from this rewrite. It does **not** exempt a LAN IP. So on
`192.168.x.x` every stylesheet, script and image request is upgraded to an `https://`
origin that does not exist — the dev server has no TLS — and fails silently. The
document itself is a top-level navigation and is not upgraded, which is exactly why
you get complete HTML with no styling.

**Fix.** Already fixed in `apps/web/next.config.mjs` (`9d5d772`): both
`upgrade-insecure-requests` and `Strict-Transport-Security` are now emitted **only**
when `NODE_ENV === 'production'`, where the deployment is actually behind TLS. Part I
§73 only requires them there.

```js
const isDev = process.env.NODE_ENV !== 'production';
// ...
...(isDev ? [] : ['upgrade-insecure-requests']),
```

If you see this again, confirm it by comparing the two URLs rather than by reading the
console:

```bash
curl -sI http://localhost:3000/ | grep -i content-security-policy
```

The general lesson: a CSP directive that *rewrites* rather than *blocks* produces no
visible error anywhere. When something works on `localhost` and not on a LAN IP,
suspect the security headers before you suspect the app.

## `len(app.routes)` says 5 and you expected 75

**Symptom.** You are checking that the router surface mounted, and:

```python
>>> len(app.routes)
5
```

Three of those five are `/openapi.json`, `/docs` and `/docs/oauth2-redirect`. The
other two print as `_IncludedRouter` with `path = None`. It looks like every router
failed to mount.

**Cause.** Not a bug. FastAPI 0.141 defers `include_router`: the call records an
`_IncludedRouter` placeholder and the child routes are expanded later, so
`app.routes` is not a flat list of endpoints any more. Counting it measures the wrong
thing.

**Fix.** Inspect the generated OpenAPI document instead — it is built from the same
Pydantic models the handlers use, so it reflects what is actually served:

```bash
cd apps/api && .venv/bin/python -c "
from app.main import create_app
paths = create_app().openapi()['paths']
print('paths:', len(paths))
print('operations:', sum(
    len([m for m in v if m in ('get','post','put','patch','delete')])
    for v in paths.values()))
"
```

At the time of writing that reports **75 paths / 108 operations** across the eighteen
router groups — the app really does serve the surface documented in
[`api.md`](api.md#resource-routes). Or just curl it with the API running:
`curl -s localhost:8000/openapi.json | jq '.paths | length'`.

## Python 3.14 on the dev machine, 3.11 in the spec

**Symptom.** `pip install -e 'apps/api[dev]'` tries to build a dependency from source
and fails in a C compiler, or a package reports no matching distribution.

**Cause.** [`installation.md`](installation.md) and the deployment guide both specify
**Python 3.11+**, and the systemd units run whatever interpreter created
`/opt/ai-coach/apps/api/.venv`. This machine's `python3` is **3.14.0**, and
`apps/api/.venv` was built with it. 3.14 is recent enough that some scientific and
native-extension wheels are not published for `cp314` yet; pip then falls back to
building from an sdist, which needs a toolchain that may not be present.

The API's own test suite runs clean on 3.14 (242 tests). The exposure is concentrated
in the packages with compiled extensions — the ONNX runtime and tokenizer stack that
`services/inference` needs, and anything pulling native audio or vision libraries for
the avatar runtime.

**Fix.** Do not upgrade the wheel; pin the interpreter. Create the venv with the
version the deployment actually runs:

```bash
brew install python@3.11
rm -rf apps/api/.venv
/opt/homebrew/bin/python3.11 -m venv apps/api/.venv
apps/api/.venv/bin/pip install -e 'apps/api[dev]'
```

`scripts/bootstrap.sh` uses whatever `python3` resolves to, so put the pinned
interpreter first on `PATH` for that invocation rather than editing the script. Each
`services/*` package gets its own venv and can be pinned independently — which is the
point of them not sharing the API's dependency graph.

When you must diagnose rather than pin, the first question is which interpreter built
the environment:

```bash
apps/api/.venv/bin/python --version
```

## A service reports not-ready

### `apps/api`

```bash
curl -fsS http://localhost:8000/healthz   # liveness: process state only
curl -s   http://localhost:8000/readyz | jq .
```

`/healthz` deliberately touches no dependency — if it fails, the process is wrong, not
its environment. `/readyz` probes each **enabled** dependency in parallel with a hard
3-second timeout and returns 503 when any is down. The body names each dependency with
`ok`, `latency_ms` and a `detail`.

Read `detail` carefully: on an exception it reports **only the exception type**, never
the message, because a driver message can contain a DSN with a password. So
`ConnectionRefusedError` means exactly that and nothing more; go and probe the
dependency yourself.

What is probed is configuration-dependent, and this is the usual source of confusion:

| Dependency | Probed when |
|---|---|
| PostgreSQL | always |
| Redis | always |
| Qdrant | only when `VECTOR_BACKEND=qdrant` (a `GET /readyz` on the Qdrant URL) |
| Object storage | only when `OBJECT_STORAGE_ENABLED=true` (a `head_bucket`) |

A local checkout with `VECTOR_BACKEND=memory` and object storage off is *supposed* to
be ready with neither running. Conversely, "ready" on such a checkout is not evidence
that the Qdrant or S3 path works — it is evidence that it was never checked.

```bash
scripts/bootstrap.sh --check-services     # probe the endpoints in .env directly
```

### `services/inference` and `services/avatar-runtime`

> **Current status.** Neither service has an `app/main.py` yet, so neither serves a
> health endpoint at the time of writing: `pnpm inference:dev` and `pnpm avatar:dev`
> will fail to import. `services/inference` documents `/health/ready` as staying red
> until every preloaded model is warm, and the avatar spec defines the equivalent
> shape for the avatar runtime. When they land, both listen on `127.0.0.1` only —
> 8770 and 8765 — so probe them from the host, not from the edge:
>
> ```bash
> curl -s http://127.0.0.1:8770/health/ready
> curl -s http://127.0.0.1:8765/health/ready
> ```
>
> A not-ready inference service is not a session-ending condition: `apps/api` falls
> back to `ApiEmbedder` or the deterministic `LexicalReranker`. See
> [`model.md`](model.md) and [`roadmap.md`](roadmap.md).

## Qdrant dimension mismatch after switching embedding models

**Symptom.** After changing `EMBEDDING_MODEL`, retrieval returns nothing, returns
obviously irrelevant hits, or the vector store rejects an upsert on a vector-size
mismatch.

**Cause.** A vector space is defined by (model, dimension). Vectors from two different
models are not comparable even when the dimensions happen to match, and a
3072-dimension vector cannot be inserted into a 1536-dimension collection at all.
Changing the model **invalidates the index**; it does not migrate it.

The platform makes this structural rather than advisory: `EmbeddingSpec.index_key()`
is what the vector store namespaces collections by, so vectors of different geometry
can never mix in one collection. `test_qdrant_collection_name_is_namespaced_by_embedding_geometry`
in `apps/api/tests/test_vectorstore_isolation.py` asserts it. The practical effect is
that a model change silently starts writing to a **new, empty** collection — which is
why the symptom is "no results" rather than "wrong results".

**Fix.**

1. Set `EMBEDDING_MODEL` and `EMBEDDING_DIMENSION` **together** and restart. Setting
   one without the other is the mistake that produces the rejected upsert.
2. Re-embed every affected knowledge base:
   `POST /api/v1/documents/{document_id}/reprocess`.
3. Expect provider cost if the new model is an API model, and remember that an API
   model means data leaves the private environment.
4. **Do not delete the old collection** until the new one demonstrably serves
   correctly. Retrieval quality is the acceptance test, and a rollback needs the old
   vectors.

The full procedure, including the capacity arithmetic, is in
[`model.md`](model.md#changing-an-embedding-model).

## The avatar runtime is unavailable

**Expected behaviour.** Per the avatar spec's §53 fallback ladder, an avatar failure
**must never end a training session**:

| Failure | Behaviour |
|---|---|
| LivePortrait fails | freeze the expression; MuseTalk continues driving the mouth |
| MuseTalk fails | LivePortrait motion continues; audio continues |
| Both fail | **static portrait + audio** — the session continues |

This is ADR-010 in the avatar spec and is recorded here as
[ADR-0010](adr/0010-avatar-runtime-decisions.md). It is a hard requirement, not a
nicety: the training session is the product, and the avatar is a presentation layer
over it.

**How to confirm you got a degrade and not a crash.** The distinction matters, because
a correct degrade looks alarming (the face stops moving) and a crash can look calm
(the tab simply stops updating).

A degrade means all of the following still hold:

- the session WebSocket is still open and `seq` is still advancing;
- trainee turns are still accepted and persona turns still arrive
  (`agent.response.partial` / `agent.response.final`);
- audio still plays — the avatar spec makes the **audio PTS the master clock**, so
  audio continuing while video freezes is the fallback working exactly as designed;
- `session.completed` still fires at the end and an `Evaluation` is produced.

A crash means the socket closed, or the transcript stopped growing. Check the close
code: **1000** normal, **1008** policy violation (auth, origin, authorisation),
**1011** internal error. A 1011 during avatar trouble is a bug in the degrade path,
not the degrade path working.

Do **not** diagnose this from the video pane alone. A frozen portrait with live
audio and a live transcript is a healthy session.

> **Current status.** `services/avatar-runtime/` is being written and currently has
> only `app/core/config.py`; there is no avatar transport in `apps/web` yet. Until it
> exists there is nothing to degrade *from* — every session runs the static-portrait
> path by default.
