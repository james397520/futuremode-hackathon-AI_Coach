# `features/avatar` — the live virtual human

The right-hand persona card used to render one character in a rounded box. It now
renders a **real avatar surface**: live video frames when a local Avatar Runtime
(LivePortrait + MuseTalk) is running, and a designed, animated portrait when it is
not. The rest of the persona card — the aurora glow, the name plate, the
`Speaking` chip, the waveform slot — is untouched; only the picture changed.

The runtime is a **loopback process that is usually not installed**. Everything
here is built around that: the absence of an avatar is a normal state, never an
error, and can never stop a training session (spec §53).

---

## Transport: staged, deliberately

| Phase | Media | Control | Status |
| --- | --- | --- | --- |
| **1 (now)** | JPEG/WebP frames as **binary WebSocket messages**, painted to `<canvas>` | same socket, JSON (§45) | implemented |
| **2 (next)** | **WebRTC** `VideoTrack` (H.264) into `<video>`, audio on the same track | WebSocket stays the control channel (§38) | `transport: 'webrtc'` is reserved in the store; only `avatar-stage.tsx` changes |

Why staged (§37): the model pipeline and WebRTC fail in completely different
ways. Debugging expression, lip-sync and barge-in over a socket that either
delivers a JPEG or does not is far cheaper than debugging them through an ICE
negotiation. When Phase 2 lands, audio and video share one media clock (§51) and
the browser stops playing a second, separate TTS stream.

§72: there is no alpha channel. Plain H.264 does not carry one, so the runtime
sends opaque frames and the stage owns the background. Transparent cut-outs would
need segmentation plus a WebGL composite — explicitly out of scope for v1.

---

## Files

| File | Role |
| --- | --- |
| `types.ts` | The §39–§45 contract, §76 error codes, §9 expression state. No React. |
| `avatar-client.ts` | `AvatarClient` (HTTP) + `AvatarSocket` (control events **and** binary frames, reconnect with jittered backoff). **Nothing throws** — every call resolves to `AvatarResult`. |
| `avatar-store.ts` | zustand: runtime status, backend, capabilities, measured fps, A/V drift, last §76 error, current expression + transition, §52 checklist. |
| `use-avatar-session.ts` | Probe → `/capabilities` → `POST /sessions` → socket. Streams persona state, calls `/interrupt` on barge-in. |
| `use-avatar-frames.ts` | `createImageBitmap` + `requestAnimationFrame`, **drops late frames instead of queueing** (§17/§49), closes every bitmap (§62). |
| `lib/expression.ts` | persona state → semantic emotion → `ExpressionState`, clamped to §70 (yaw ±10°, pitch ±6°, roll ±5°). |
| `components/avatar-stage.tsx` | The surface: canvas / fallback / warm-up, speaking glow, live region, `aria-label`. |
| `components/avatar-fallback.tsx` | The §53 floor: portrait or initial mark, breathing, blinking, emotion wash. |
| `components/runtime-badge.tsx` | Plain language for trainees; engineering detail only for `runtime.view_telemetry`. |
| `components/preflight.tsx` | The §52 checklist — advisory for avatar checks, blocking only for TTS + audio device. |
| `mock/mock-avatar-runtime.ts` | Drives expression transitions from persona state when no runtime exists. |

---

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_AVATAR_BASE_URL` | `http://127.0.0.1:8765` | HTTP origin of the runtime (§39). |
| `NEXT_PUBLIC_AVATAR_WS_URL` | derived from the base URL | WebSocket origin (§45). |
| `NEXT_PUBLIC_AVATAR_ID` | `customer_001` | Prepared avatar asset (§7). |
| `NEXT_PUBLIC_AVATAR_ENABLED` | `1` | `0` skips every network call and forces the fallback. |

The runtime's own `.env` (§67 — `AVATAR_BACKEND`, `AVATAR_DEFAULT_FPS`,
`AVATAR_MODE`, …) belongs to the service, not to the web app. The browser asks
`/capabilities` instead of assuming any of it: `fps` is `min(25,
max_recommended_fps)` and the mode falls back to `continuous` only when a backend
reports no state bank.

### CSP

`apps/web/next.config.mjs` must list the avatar origins or the browser blocks
them **silently**:

- `connect-src` — `NEXT_PUBLIC_AVATAR_BASE_URL` and `NEXT_PUBLIC_AVATAR_WS_URL`
  (`blob:` was already present)
- `img-src` — the avatar origin, for the runtime's prepared portrait (it is plain
  `http` on loopback, which the existing `https:` entry does not cover)
- `media-src` — the avatar origin, reserved for the Phase-2 video element

### Pointing at a runtime on another host

The runtime binds to loopback by design (§73: the portrait and consent record
never leave the machine). To drive a workstation GPU from a laptop:

```bash
# on the GPU host — bind explicitly, and put it behind a tunnel or a private LAN
AVATAR_HOST=0.0.0.0 AVATAR_PORT=8765 …

# in apps/web/.env.local
NEXT_PUBLIC_AVATAR_BASE_URL=http://10.0.0.21:8765
NEXT_PUBLIC_AVATAR_WS_URL=ws://10.0.0.21:8765
```

Both variables are baked in at build time and both must be in the CSP. Over
https the page will refuse mixed content, so a remote runtime needs `https://` /
`wss://` (a reverse proxy with TLS), not plain http.

---

## Fallback ladder (§53)

```
frames arriving              →  live canvas
LivePortrait down            →  frozen expression, MuseTalk mouth  (status: degraded)
MuseTalk down                →  LivePortrait motion + audio        (status: degraded)
both down / not installed    →  portrait + CSS motion              (status: unavailable)
runtime present but loading  →  portrait + warm-up shimmer         (status: loading)
```

`status` never climbs back up on failure: a runtime that was `ready` degrades, one
that never answered is simply `unavailable`. **No rung of this ladder blocks the
session, and none of them is presented to a trainee as an error.**

---

## No runtime? It still demos.

`useMockAvatarDriver` synthesises the §45 events the real runtime would send from
the persona state the simulation is already producing, so the §87 demo arc —
neutral → skeptical → frustrated → interested — plays out on the portrait with
nothing installed. The face changes colour temperature, the caption changes, the
head drifts within the §70 clamp, and the customer visibly reacts before speaking
(§47: the transition leads by ~140ms).

---

## Notes for the next change

- **Never queue frames.** Audio is the master clock (§17). A late frame is
  dropped, not buffered; buffering trades one dropped frame for permanent drift.
- **State before audio (§47).** The state POST is debounced by 90ms so the
  expression transition starts before the TTS does.
- Frame pixels never enter React state, and frame stats reach the store at ~1Hz.
- Motion honours `prefers-reduced-motion`; every state is also legible from text
  (the caption chip, the badge, the live region).
