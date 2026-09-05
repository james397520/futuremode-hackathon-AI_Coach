# Live Simulation (`features/simulation`)

The most important surface of the product — spec `docs/spec/AI_Coach_Spec_v3.md`
Part I §20–§25, §29, §31, §32, §49–§50, §59, §62, §92–§94 and Part II §14–§24,
§42–§43, §91, §99–§100.

Public API (`index.ts`) — exactly two exports, both taking `{ sessionId: string }`:

```ts
export { LiveSimulationPage } from './components/live-simulation-page';
export { VoiceSimulationPage } from './components/voice-simulation-page';
```

Route files (owned by the app-shell owner) import them from `@/features/simulation`.

---

## 1. Layout (§14.1 — the authoritative decision)

```text
┌──────────────────────────────────────┬───────────────────────────┐
│ LEFT: Conversation / Training        │ RIGHT: AI Persona         │
│ transcript · coach · quick actions   │ + Objective / Live State  │
│ · composer                           │ + Coach · Timeline        │
└──────────────────────────────────────┴───────────────────────────┘
```

`TrainingGrid` owns this and nothing else. The right column is a stack of
*floating* cards which overflows the container by 8–16px at `xl`+ to produce the
reference layout's depth. Below `xl` the columns stack, conversation first.
It is never a dashboard table (§99).

## 2. Component tree (matches §91)

```text
<LiveSimulationPage>                 orchestration: bootstrap, socket, voice, gating
  <SimulationStyles/>                §43 motion + thin scrollbar CSS (tokens only)
  <SessionHeader/>                   §15
  <TrainingGrid>
    <ConversationPanel>              §16 — glass-strong surface
      TranscriptHeader               §16 title / LIVE / gradient pill / language
      <TranscriptFeed>               §16 §25 — document style, aria-live region
        <TranscriptTurnRow/>         §17 — 6 message kinds
          <CitationChip/>            §17 §12.5
          <ComplianceAlert/>         §17 §32
      CoachInlineEvents              §91 — newest actionable signal, pinned
      <AgentActivity/>               §19 §93 — one line, not a dump
      <QuickActions/>                §19 §24 §8.4
      <Composer/>                    §18
    </ConversationPanel>
    <PersonaColumn>                  §20–§23
      <ScenarioCard/>                §21 — tags + objective bullets
      <PersonaStage/>                §20.1 — portrait stage, aurora glow, pulse
      <PersonaObjectiveCard/>        §21 — talking points, objections, progress
      <PersonaStateCard/>            §22 — server-driven meters
      <CoachCard/>                   §23 — locked in Assessment Mode
      <StateTimeline/>               §31 §40 — labelled "Simulated"
    </PersonaColumn>
  </TrainingGrid>
  <SessionCompleteSummary/>          §29 — replaces the conversation when done
  <TranscriptDialog/> <ReportIssueDialog/> <KnowledgeReferenceDialog/> <AudioDevicePicker/>
```

```text
<VoiceSimulationPage>                §24 Part II, §22 Part I
  <SessionHeader/>
  <TrainingGrid variant="voice">
    left:  <Captions/> · <TranscriptFeed/> · <Waveform/> · <VoiceControls/>
    right: <PersonaStage/> (enlarged, waveform slot) · <PersonaStateCard/> · <CoachCard/>
  </TrainingGrid>
```

Supporting layers:

| Path | Role |
|---|---|
| `store/session-store.ts` | Zustand store + the pure `reduceEvent(state, event)` (§48.4) |
| `hooks/use-session-socket.ts` | socket ↔ store, exhaustive event switch, `ClientCommand`s |
| `hooks/use-session-bootstrap.ts` | REST bootstrap, or the §59 demo fixture with no backend |
| `hooks/use-voice-session.ts` | getUserMedia → Web Audio → AudioWorklet, VAD, barge-in (§50, §22.3) |
| `hooks/use-session-timer.ts` | elapsed / remaining, frozen while paused |
| `hooks/use-auto-scroll.ts` | follow-the-newest that yields when the reader scrolls up |
| `hooks/use-transcript-export.ts` | §24 Transcript copy / download |
| `lib/*` | tone helpers, labels, state-machine transitions, objective progress |
| `mock/*` | scripted §59 insurance demo (no backend required) |

---

## 3. Event → UI mapping

Every row is produced by `reduceEvent` in `store/session-store.ts`. The `switch`
is exhaustive with a `never` guard, so adding a variant to `StreamingEvent`
breaks the build here instead of being silently ignored.

| `StreamingEvent` | Session state | Store effect | Visible in |
|---|---|---|---|
| `session.started` | → `ready` | clears error, sets `startedAtMs`, **resets the `seq` high-water mark** (a restart re-numbers from 1, so this event must never be judged stale) | header state pill, timer |
| `session.paused` | → `paused` | records pause anchor | header pill, composer disabled + reason |
| `session.resumed` | → `listening` | adds paused duration to the offset | header pill, composer enabled |
| `session.completed` | → `completed` | clears partials, stores `evaluation_id` | `SessionCompleteSummary` (§29) |
| `speech.started` | → `persona_speaking` / `listening` | clears ASR partial | persona stage chip, "Your turn" |
| `speech.partial` | → `persona_speaking` / `transcribing` | `speechPartial` | streaming transcript row, captions |
| `speech.final` | trainee → `processing`, else → `listening` | appends turn (dedupes the local echo), applies early citations | transcript row + intent / score pills |
| `agent.thinking` | → `processing` | `activeAgent` | `AgentActivity` one-liner (§93) |
| `agent.response.partial` | → `persona_speaking` | appends delta to `partials[turn_id]` | streaming persona row, captions |
| `agent.response.final` | → `listening` | appends turn, drops the partial buffer | transcript row, TTS auto-play (voice page) |
| `persona.state.updated` | — | replaces `personaState`, appends history + timeline marker | `PersonaStateCard`, `StateTimeline`, objective phase |
| `coach.insight` | — | appends (or **drops** in assessment, see §4) | `CoachCard`, CoachInlineEvents, coach transcript row |
| `knowledge.citation` | — | attaches to the turn, or parks it in `pendingCitations` | `CitationChip`, Knowledge Reference dialog |
| `score.updated` | — | `liveScores[skill]` + timeline marker | live score meters, summary fallback |
| `compliance.warning` | — | appends finding + timeline marker | `ComplianceAlert` (§17 soft outline, never a big red alert) |
| `runtime.fallback` | — | `runtime.backend` / `degraded` | header runtime badge + a system transcript notice (§94) |
| `connection.reconnecting` | → `reconnecting` | attempt counter, `online: false` | header offline pill, system notice |
| `session.error` | recoverable → unchanged, else → `error` | `error` | inline dismissible banner (never a modal) |

Client → server commands (`ClientCommand`): `message.send`, `session.pause`,
`session.resume`, `session.end`, `coach.request_hint`, `voice.push_to_talk`,
`client.intent_hint`. `ack` is **not** sent from here — `ws-client` auto-acks
every accepted event.

### Resilience rules (§62 / §94)

* `reduceEvent` never throws. A malformed payload, an event for another session,
  or a duplicate/out-of-order `seq` returns state unchanged (stale events are
  additive-only: they can never move the state machine backwards).
* Session status only ever moves along `LEGAL_TRANSITIONS` (§92); an illegal
  transition is dropped, not applied.
* `seq` gaps are counted, never fatal.
* Runtime fallback and socket loss are informational badges/notices. The only
  modal in the feature is the audio-device / microphone-permission dialog, which
  is the one genuinely blocking case §94 allows.

### Perceived latency (§49.2)

Partial ASR and partial LLM output render on arrival. Nothing waits for a
sentence boundary. The trainee's own message is echoed optimistically as a
`local-*` turn and replaced when the authoritative `speech.final` lands.

---

## 4. Training vs Assessment gating (§8.4)

**Assessment Mode makes cheating affordances unreachable, not hidden.** Three
independent layers, in order of defence:

1. **Data layer** — `reduceEvent` drops any `coach.insight` whose
   `allowed_in_assessment` is `false` when `mode === 'assessment'`. The payload
   never enters the store, so it cannot be read from devtools or a React tree
   inspector. Only the count is kept (`suppressedCoachCount`) so the UI can say
   "held for the report".
2. **Command layer** — `useSessionSocket().requestHint()` returns without
   emitting `coach.request_hint` in an assessment, so even a stray call cannot
   ask the coach agent for help.
3. **Render layer** — the handlers simply do not exist: `LiveSimulationPage`
   builds `trainingHandlers` only when `mode === 'training'`, and
   `QuickActions` / `Composer` / `CoachCard` / `PersonaColumn` render nothing
   where those props are `undefined`. `KnowledgeReferenceDialog` is not mounted
   at all. No `display: none`, no `disabled`, no CSS involved.

| Affordance | Training | Assessment |
|---|---|---|
| Hint | ✔ pill + composer button | not rendered, command refused |
| Suggested Strategy | ✔ | not rendered |
| Ask Coach | ✔ (pill + coach card) | not rendered |
| View Knowledge Reference | ✔ dialog | dialog not mounted |
| Live Coach Insights | ✔ | withheld; `CoachCard` shows a locked/deferred state |
| Post-session coach note (`allowed_in_assessment: true`) | ✔ | ✔ — the contract's own opt-in is respected |
| Pause / Resume / Restart / End | ✔ | ✔ |
| Captions / Transcript / Report Issue / Audio Device | ✔ | ✔ |
| Compliance warnings | ✔ | ✔ — a safety signal, not a hint |

---

## 5. Persona state comes only from the server

`PersonaStateCard`, the emotion ladder in `StateTimeline`, and the phase half of
`PersonaObjectiveCard`'s progress bar are rendered **exclusively** from the
`PersonaSimulationState` payload of `persona.state.updated` (§20: "UI 的右側
Persona State 必須由此 state 驅動，而不是 UI 自己猜測").

Concretely:

* No interpolation toward a predicted value, no decay, no easing toward a guess.
  Meter widths animate *between two received numbers* (a 520ms CSS width
  transition) and nothing else.
* Before the first event the card says it is waiting. It never renders zeros as
  if they were data.
* `hidden_need_revealed`, `compliance_risk`, `intent`, `current_goal`, `budget`
  and `time_pressure` are shown verbatim when present and omitted when absent.
* The one client-side inference in the feature — talking-point coverage in
  `lib/objective.ts` — is a *text* heuristic over the trainee's own turns, is
  labelled on screen as "detected in your transcript — not a score", and never
  touches persona state. Authoritative scoring is the Evaluator agent's
  `score.updated` / `Evaluation`.
* `StateTimeline` carries a permanent "Simulated" tag and copy stating the state
  comes from the scenario engine, not from a real person's face or voice (§31).

---

## 6. Demo mode

With `NEXT_PUBLIC_API_BASE_URL` unset, `use-session-bootstrap` loads
`mock/mock-session.ts` and `use-session-socket` runs `mock/mock-event-stream.ts`
instead of the socket. The script replays §59 end to end — insurance sales,
陳先生 (38, engineer, married, two children; rational / price-sensitive /
family-oriented / skeptical), main objection
「我已經有保險了，為什麼還要多買？」, hidden need = family financial protection
after a major incident:

```text
opening → needs discovery → main price objection
  → budget discussion → hidden-need reveal → trust 74 (> 70) → closing
  → session.completed
```

It also exercises the awkward paths on purpose: partial-then-final text for both
ASR and LLM output, a `knowledge.citation` that arrives *before* its transcript
turn, and a mid-session `runtime.fallback`. The stream is interactive — only an
explicitly typed message satisfies the next trainee beat. Demo mode never creates
a trainee response on the user's behalf.

---

## 7. Style rules observed

* Tokens only — no hex/rgb/hsl literal anywhere in this feature. Translucent
  pastel washes use `color-mix(in srgb, var(--token) N%, transparent)` via
  `lib/tone.ts`, because the Tailwind preset maps colours to bare `var(...)`
  values and therefore cannot take an opacity modifier.
* §43 motion: card enter (opacity + 8px rise), floating panel (12px slide),
  hover lift 1px, speaking = a bottom glow and a tiny pulse — the card itself
  never flashes. All of it collapses under `prefers-reduced-motion`.
* §99: no messenger bubbles, no gauges, no pie charts, no heavy borders, no
  pure-black surfaces, no 8px radii, no per-card colour scheme.
* Transcript is document style: speaker · role tag · timecode · paragraph.

---

## 8. Seams onto modules owned by other agents (verified against the landed code)

| Module | API used |
|---|---|
| `@ai-coach/ui` (only via `components/kit.ts` — the single seam) | `cn`, `GlassCard`, `GradientPill`, `Textarea`, `Tooltip`, `Modal`, `Avatar`, `PersonaAvatar`, `Skeleton` |
| `@/lib/ws-client` | `createSessionSocket(sessionId, { onEvent, onStatus, onSeqGap })` → `StreamingClient`; then `connect()` / `send(ClientCommand)` / `close()`. The client owns reconnect+backoff, heartbeats, `seq` gap detection and auto-ack, so this feature never re-implements them. `WsStatus` `'open'` ⇒ online, `'reconnecting'` ⇒ header pill, `'failed'` ⇒ recoverable inline error. |
| `@/lib/api-client` | `endpoints.getSession(id)` → `endpoints.getScenario` + `endpoints.getPersona` (parallel) compose `SessionBootstrap`; `endpoints.getReport(evaluationId)` for §29. `api.post('/api/sessions/{id}/issues', { body })` is best-effort telemetry with no typed helper yet — **the one endpoint this feature needs that `api-client` does not expose.** |
| Tailwind preset | `bg-glass-card`, `bg-glass-strong`, `text-text-*`, `rounded-{card,card-sm,input,pill,avatar,shell}`, `shadow-{soft,floating}`, `text-{display,section,card-title,body,body-sm,meta,tiny}`, plus the plain classes `glass-card`, `glass-strong`, `dot-matrix` |

One kit caveat worth knowing: `Avatar`'s `size` is typed `AvatarSize | number` but only the
named scale is mapped to a class, so this feature always passes named sizes
(`"sm"` in the transcript gutter, `"xl"` on the persona stage).

Deliberate non-uses, with reasons, are documented at the top of
`components/kit.ts`: `Progress` (§22 wants a 4px hairline, not a bar),
`ScrollArea` (the transcript needs raw scroll-event + `scrollTop` control to
yield to the reader), the `framer-motion` motion presets (§43 motion is CSS here,
using the same numbers as `packages/ui/src/components/motion.tsx`, so the
high-frequency transcript list stays off the animation runtime), and
`lucide-react` (icons are local inline SVG).
