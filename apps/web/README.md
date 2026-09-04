# `@ai-coach/web`

The Next.js 15 App Router front end for the AI Coach platform — the only
user-facing app in the monorepo.

Spec: [`docs/spec/AI_Coach_Spec_v3.md`](../../docs/spec/AI_Coach_Spec_v3.md).
Ownership: [`docs/PROJECT_STRUCTURE.md`](../../docs/PROJECT_STRUCTURE.md) §2 / §5.

---

## Running it

```bash
pnpm install                     # from the repo root
cp ../../.env.example ../../.env # then edit
pnpm --filter @ai-coach/web dev  # or: pnpm dev
```

| Script      | What it does                                        |
| ----------- | --------------------------------------------------- |
| `dev`       | Next dev server on :3000                            |
| `build`     | Production build (also runs the App Router typecheck) |
| `start`     | Serves the production build                          |
| `lint`      | `next lint`                                         |
| `typecheck` | `tsc --noEmit`                                      |

Environment (all consumed at build time, all safe to expose):

| Variable                    | Default                 | Purpose                                        |
| --------------------------- | ----------------------- | ---------------------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL`  | `http://localhost:8000` | FastAPI orchestrator origin                    |
| `NEXT_PUBLIC_WS_BASE_URL`   | `ws://localhost:8000`   | Session / notification WebSocket origin        |
| `NEXT_PUBLIC_ENABLE_WEBGPU` | `auto`                  | `auto` \| `on` \| `off` — local inference policy |

> **No secret ever belongs here.** OpenAI / ElevenLabs / vector-DB credentials
> live only on the API server (§56 / §70 / §71). `next.config.mjs` pins
> `connect-src` to our own origins, so an accidental direct provider call fails
> loudly instead of leaking a key.

The app boots against **local fixtures**, with no API running. The signed-in user
comes from `src/lib/fixtures/identity.ts`; set

```js
localStorage['ai-coach:mock-role'] = 'trainee' // coach | manager | admin | reviewer
```

to review the RBAC-filtered navigation and the admin-only pages as another role.
Search for `MOCK` to find every place that needs swapping for a real call.

---

## How the code is split

```text
src/
├── app/        routes and layouts ONLY — no business logic
├── features/   one folder per product area; the page-level components live here
├── components/ cross-feature app components (shell, palette, notifications, theme)
├── lib/        api client, ws client, query client, auth, RBAC, fixtures, utils
└── styles/     the global stylesheet (imports design-tokens + aurora)
```

**Route files are thin.** Every `src/app/**/page.tsx` does three things and no
more: export `metadata`, `await params`, and render one component from
`src/features/*`. That keeps the App Router boundary mechanical and means a page
can be moved or wrapped without touching its implementation.

```tsx
// src/app/(app)/knowledge/[kbId]/chunks/page.tsx
export const metadata: Metadata = { title: 'Chunk viewer' };

export default async function Page({ params }: { params: Promise<{ kbId: string }> }) {
  const { kbId } = await params;
  return <ChunkViewerPage kbId={kbId} />;
}
```

`params` is a Promise: that is the Next.js 15 contract, and `next build`
typechecks it.

### Feature folders

| Folder                  | Pages it owns                                              |
| ----------------------- | ---------------------------------------------------------- |
| `features/auth`         | Login, workspace selector                                  |
| `features/dashboard`    | Dashboard                                                  |
| `features/simulations`  | Library, setup, session review/replay, completion          |
| `features/simulation`   | **Live + voice session — owned by another agent, do not edit** |
| `features/personas`     | List, builder, test lab                                    |
| `features/scenarios`    | List, nine-step builder wizard                             |
| `features/knowledge`    | KB list/overview, document, chunks, playground, mining, upload modal |
| `features/questions`    | Bank, editor, AI generator                                 |
| `features/training`     | Assignments + assign dialog                                |
| `features/performance`  | Individual progress / individual report                    |
| `features/reports`      | Team, skill, compliance                                    |
| `features/team`         | People and readiness                                       |
| `features/security`     | Findings, safety posture, audit log                        |
| `features/integrations` | Connector cards                                            |
| `features/settings`     | Models, AI runtime, voice, appearance, profile, billing     |

Note the two similarly named folders. **`features/simulation`** (singular) is the
Live Simulation experience and belongs to a different owner; nothing outside the
two thin `/live` and `/voice` route files imports from it. Everything *around* a
session — the library, the pre-flight setup, the replay and the completion
handoff — is **`features/simulations`** (plural) and lives here.

### Where visuals come from

- Generic glass primitives → `@ai-coach/ui`, re-exported through the single seam
  file **`src/components/ui.ts`**. Nothing else in this app imports the kit
  directly, so a kit rename is a one-file fix.
- Colours, radii, shadows, blur, typography → CSS variables from
  `@ai-coach/design-tokens`. **No hex literal anywhere in `src/`** (§99).
- Business-semantic visuals stay here, because `packages/ui` must not know about
  Persona / Score / Transcript:
  - `components/transcript/` — `TranscriptDocument`, `EvidenceDisclosure`, `StateTimeline`, `CitationList`
  - `components/data-viz/` — `ScoreBar`, `SkillRadar`, `TrendLine`, `MiniBars`, `Sparkline`, `SkillHeatmap`
  - `components/status/` — status pills and the document-processing pipeline

Two rules worth restating because they are easy to break:

1. **Transcripts, reports and lists are documents, not chats.** Every
   speaker-based surface uses the meeting-transcript layout in
   `TranscriptDocument` — a timestamp gutter, a named speaker, inline coach and
   compliance annotations. Messenger bubbles are forbidden (§25 Part I, §99).
2. **A score never appears as a bare number.** Skill scores render through
   `EvidenceDisclosure`, which expands to the transcript quote, the issue and the
   better approach, and links back to the turn (§27 / §39).

### State

- **Server state** → TanStack Query (`src/lib/query-client.tsx`), with the key
  factory in `queryKeys`. Knowledge, questions, reports, assignments, users.
- **Client / session state** → Zustand. Shell overlays live in
  `components/app-shell/shell-store.ts`; the live session store belongs to
  `features/simulation`.

### The shell

`components/app-shell/app-shell.tsx` composes the §10 layout: aurora canvas →
24px safe area → floating `GlassShell` (max 1800px, radius 30px, fixed height) →
64px glass `IconRail` + a workspace column that scrolls *inside* the frame. It is
deliberately not a full-bleed dashboard, and the rail is never a permanent 240px
sidebar (§99) — it expands to 232px on hover, focus or pin, and becomes a bottom
strip below 768px.

Navigation is declared once in `components/app-shell/nav.ts` (the thirteen items
of §57) and filtered by `useCan()`. A role that cannot use a section does not see
a disabled icon — it sees nothing.

### Theme

`components/theme/` resolves light / dark / system in this order: user profile
preference → `localStorage` → `prefers-color-scheme` → light. An inline blocking
script (`theme-script.ts`, injected in the root layout `<head>`) stamps
`data-theme` on `<html>` before the first paint; the 200ms cross-fade class is
added one frame *after* mount, so switching is soft and the first paint never
flashes (§6).

### Runtime

`components/runtime/runtime-provider.tsx` wraps `@ai-coach/ai-runtime` and
publishes `useComputeCapability()`. It renders nothing of its own. The runtime is
created with `enableLocal: false` until the user accepts the §97 prompt, so the
app is fully usable through the server tier from the first call and no model file
is downloaded without consent. Learners only ever see the outward label
(`RUNTIME_LABEL`) in the rail; backend, model, load time, inference milliseconds,
worker status and fallback reason are admin-only, in Settings → AI Runtime (§93).

### Realtime

`src/lib/ws-client.ts` is a dependency-free typed WebSocket client: it parses
`StreamingEvent` from `@ai-coach/shared`, reconnects with exponential
backoff and jitter, detects `seq` gaps so a lost turn is reconciled rather than
silently dropped, and acks each event so the server can trim its replay buffer.
It is generic on purpose — the live simulation feature and the notification
stream both consume it.

---

## Routes

`(auth)` renders without the app shell; `(app)` renders inside it.

```text
/                                              → redirect /dashboard
(auth)/login
(auth)/workspace-select

(app)/dashboard
(app)/simulations
(app)/simulations/[sessionId]/setup            ← the id here is a SCENARIO id
(app)/simulations/[sessionId]/live             ← features/simulation
(app)/simulations/[sessionId]/voice            ← features/simulation
(app)/simulations/[sessionId]/review
(app)/simulations/[sessionId]/complete
(app)/personas
(app)/personas/new
(app)/personas/[id]
(app)/personas/[id]/test-lab
(app)/scenarios
(app)/scenarios/[id]/builder                   ← `/scenarios/new/builder` creates
(app)/knowledge
(app)/knowledge/[kbId]
(app)/knowledge/[kbId]/documents/[docId]
(app)/knowledge/[kbId]/chunks
(app)/knowledge/[kbId]/playground
(app)/knowledge/[kbId]/mining
(app)/questions
(app)/questions/[id]/edit                      ← `/questions/new/edit` creates
(app)/questions/generate
(app)/training
(app)/performance
(app)/performance/[userId]
(app)/reports                                  → redirect /reports/team
(app)/reports/team
(app)/reports/skill
(app)/reports/compliance
(app)/team
(app)/security
(app)/security/audit-log
(app)/integrations
(app)/settings
(app)/settings/{models,runtime,voice,appearance,profile,billing}
```

**Why `setup` sits under `[sessionId]`:** the App Router requires every route at
the same position to use the same dynamic segment name, so the five simulation
sub-routes share one slug. On `/setup` the value is a scenario id — the session
does not exist until the trainee presses start. The `/live` and `/voice` routes
pass it straight through as `sessionId`, which is the contract with
`features/simulation`.

---

## Accessibility and responsiveness

- Breakpoints follow §46 and come from `BREAKPOINTS` in design-tokens: three
  columns ≥1440, a narrower right column 1200–1439, a collapsible right column
  1024–1199, stacked 768–1023, single column below 768 (where the rail becomes a
  bottom strip and the safe area is dropped).
- Keyboard: a skip link is the first tab stop, the rail expands on focus, every
  overlay closes on `Escape`, and bare-letter shortcuts are suppressed inside
  inputs (`components/keyboard/shortcuts.tsx`, §78).
- Streaming text is announced through a `role="log"` live region; status is never
  carried by colour alone — every pill, marker and row also states its meaning in
  text (§47).
