---
name: Bug report
about: Something behaves differently from the spec or from what you expected
title: "[bug] "
labels: ["bug", "needs-triage"]
---

<!--
Before filing: if this is a live-simulation bug, please capture the streaming
event log first (see "Streaming events" below). Nine times out of ten it is the
difference between a fixable report and a guess.
-->

## What happened

## What you expected

<!--
If the spec is explicit about the expected behaviour, quote it. The spec has TWO
numbering sequences — Part I (product, §1–§61) and Part II (UI / architecture,
§0–§102) — so write e.g. "Part II §55" rather than a bare number.
-->

Spec reference:

## Reproduction

1.
2.
3.

Frequency: <!-- always / intermittent (roughly how often) / happened once -->

## Where

- [ ] `apps/web` — frontend
- [ ] `apps/web/src/features/simulation` — live simulation specifically
- [ ] `apps/api` — API / agents / RAG
- [ ] `packages/ui` or `packages/design-tokens`
- [ ] `packages/ai-runtime` — WebGPU / WASM / server inference
- [ ] `infra` / CI
- [ ] Don't know

## Environment

| | |
|---|---|
| Branch / commit | |
| OS | |
| Browser + version | |
| Runtime badge shown in the UI | <!-- WebGPU / WASM / Server, from the runtime status pill (§93) --> |
| Role you were signed in as | <!-- trainee / coach / manager / admin / reviewer --> |
| Session mode | <!-- training / assessment — §8.4 changes what is allowed --> |

## Evidence

<details>
<summary>Browser console</summary>

```
```

</details>

<details>
<summary>API logs</summary>

<!-- The structured log line's request id (rid=… in the nginx/API log) is the
     fastest way to find the matching server-side trace. -->

```
```

</details>

<details>
<summary>Streaming events (live simulation bugs)</summary>

<!--
The session WebSocket carries a monotonically increasing `seq`. Paste the events
around the failure, including their seq numbers — a gap in seq is itself the
diagnosis for a whole class of these bugs.
-->

```
```

</details>

Screenshots / screen recording:

## Impact

- [ ] Blocks the §5.2 MVP loop
- [ ] Data correctness — a score, evaluation, citation or report is wrong
- [ ] Tenant isolation, RBAC, or PII — **stop and see the note below**
- [ ] Degrades UX but there is a workaround
- [ ] Cosmetic

> **If you ticked tenant isolation, RBAC, or PII:** do not describe the exploit
> in a public issue. Close this and report it privately to the maintainers
> instead (see `SECURITY.md` if present, otherwise contact a maintainer
> directly). Include the same detail — just not in public.
