# ADR-0007 — Zustand for session/client state, TanStack Query for server state

- **Status:** accepted
- **Date:** initial architecture pass
- **Spec:** Part II §48.4 (client state), §48.5 (server state), §55/§68 (streaming events), §95 (performance), §92 (state machines); Part I §20 (agent structured state), §23 (live simulation)

## Context

Part II §48.4 and §48.5 assign the two halves explicitly:

```text
Zustand         →  session state, live persona state, local UI,
                   voice controls, WebGPU status
TanStack Query  →  knowledge, questions, reports, assignments, users
```

The split is not arbitrary, and it is worth understanding why rather than
following it by instruction, because the temptation to collapse it is real.

The two kinds of state in this application behave completely differently:

**Server state** is a cache of something the server owns. A knowledge base list,
a report, a question bank page. It can be stale, it needs revalidation, it is
keyed by a URL, and two components asking for it should share one request. It is
read far more than written.

**Session state** is not a cache of anything. During a live simulation, the
authoritative persona state arrives as a `persona.state.updated` **event** on a
WebSocket. There is no URL to fetch it from. It changes many times per turn,
several components render from it simultaneously (the persona card, the state
timeline, the objective card, the coach card), and Part II §95 requires
incremental updates rather than refetches.

Putting session state into a query cache means abusing `setQueryData` as an event
sink — an unkeyed, unfetchable "query" that only ever gets written imperatively.
Putting server state into a Zustand store means hand-writing caching,
deduplication, revalidation, and loading and error states that TanStack Query
already provides correctly.

## Decision

**Follow the split, and treat the boundary as a rule rather than a default.**

### TanStack Query — anything with a URL

`apps/web/src/lib/query-client.tsx`. Everything reachable through Part I §56 as
a resource: knowledge bases, documents, chunks, questions, personas, scenarios,
assignments, users, teams, reports, audit entries, integrations, runtime policy.

- Query keys are the resource path plus its parameters.
- Mutations invalidate the affected keys rather than writing the cache by hand,
  except where an optimistic update is genuinely warranted.
- Loading and error states come from the hook, so the skeleton and empty-state
  components in `packages/ui` have one consistent source
  (Part II §44, §45).

### Zustand — anything without one

`apps/web/src/features/simulation/store/session-store.ts` for the live session,
plus small stores for cross-cutting UI (`shell-store.ts` for the icon rail and
panels, the runtime provider for capability and telemetry).

The session store holds:

- the `SessionState` machine value (Part II §92: `idle`, `connecting`, `ready`,
  `listening`, `transcribing`, `processing`, `persona_speaking`, `paused`,
  `reconnecting`, `completed`, `error`)
- the transcript, appended turn by turn
- `PersonaSimulationState` — phase, emotion, trust, interest, resistance,
  patience, intent, current goal, hidden-need-revealed, compliance risk
- live skill scores, coach insights, compliance warnings, citations
- voice control state: push-to-talk, device selection, mute, captions
- the last acknowledged `seq`, for gap detection and reconnect replay

### The rule that makes it work

**The socket reducer is the only writer of live session state.** `StreamingEvent`
values arriving on `/ws` are reduced into the store, and components read from it.
A component never derives persona state from the transcript, and never guesses.

This mirrors a note the spec makes for the UI directly (Part I §20): the persona
state card must be driven entirely by the agent's structured state; the UI must
not infer it. A single-writer store is how that becomes structurally true
instead of a convention. It also means the mock event stream and the real socket
are interchangeable — they produce the same events into the same reducer, which
is exactly why swapping the mock out is a contained change rather than a
rewrite.

### Where they touch

Session *creation* and session *end* are REST (a mutation). The live session in
between is socket-driven Zustand state. On `session.completed`, the store's job
ends and the review page reads the persisted `Evaluation` through TanStack
Query — a resource with a URL, correctly on the query side of the line.

## Consequences

### Good

- **Each tool does what it is good at.** No hand-rolled cache, no query cache
  abused as an event bus.
- **Live updates are cheap.** A Zustand selector re-renders only the components
  reading the slice that changed. A `persona.state.updated` at 3 Hz across four
  components is not a performance concern, which matters for the 60fps target
  (Part II §95).
- **Single-writer discipline makes the UI honest.** The persona card cannot
  disagree with the server, because it has no independent source.
- **Reconnect and replay are tractable.** `seq` tracking lives in the store next
  to the reducer that consumes it, so gap detection is local rather than spread
  across the socket client and the components.
- **Zustand is small and unopinionated.** No provider tree, no context nesting,
  no boilerplate. Testing the reducer is testing a function.
- **The mock and the real socket are substitutable.** The single most important
  practical consequence — see [ROADMAP Phase 1](../roadmap.md).

### Bad, and what we do about it

- **Two mental models.** A contributor has to know which side a piece of state
  belongs on. Mitigated by the rule being simple and stated in one line: does it
  have a URL? Query. Does it arrive as an event? Store.
- **The boundary can blur.** The tempting mistake is caching a fetched scenario
  into the session store "so the live page has it". The convention is that the
  store holds session-lifetime data only, and fetched resources stay in the
  query cache and are read alongside it.
- **Zustand state is not persisted.** A hard reload during a session loses local
  state. Correct by design: the server is authoritative, and session recovery
  (Part I §49.4) means reconnecting and replaying from the last known `seq`, not
  restoring a client snapshot. `sessionStorage` for the last `seq` is a possible
  optimisation, not a requirement.
- **No time-travel debugging out of the box.** Redux DevTools middleware is
  available for Zustand if the live loop ever needs it; it is not wired today.
- **Selector discipline is on us.** Subscribing to the whole store instead of a
  slice re-renders on every event, and every event is roughly every 300 ms
  during a turn. This is the one performance foot-gun in the pattern and is
  worth a code-review habit.

### Rejected alternatives

- **Redux Toolkit for both** — a defensible single answer, and rejected on
  weight. RTK Query would cover the server side, but the boilerplate for the
  session reducer buys nothing over Zustand, and the spec names Zustand.
- **React Context for session state** — rejected on performance. Context has no
  selector granularity: every consumer re-renders on every persona state update.
- **Everything in TanStack Query, using `setQueryData` for events** — rejected
  as an abuse of the abstraction. An entry that is never fetched, never
  invalidated and only ever written imperatively is not a query.
- **Everything in Zustand, fetching by hand** — rejected. It means
  reimplementing deduplication, revalidation, retries and cache invalidation,
  and getting them subtly wrong.
- **Server-state-in-URL via server components only** — attractive for the list
  and detail pages, and it does not answer the live session at all. The two
  coexist: server components render the shell and initial data, and TanStack
  Query owns anything interactive that refetches.
