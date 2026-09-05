# ADR-0010 — The local avatar runtime: LivePortrait for expression, MuseTalk for the mouth, behind one backend API

- **Status:** accepted
- **Date:** avatar runtime design pass
- **Spec:** avatar runtime spec (LivePortrait + MuseTalk cross-platform implementation) §1–§3, §5, §9, §17, §24–§25, §29–§34, §38, §45, §47, §53, §69–§74, §90 (its own ADR-001…ADR-010); Part I §16 (persona), §22 (voice), §31 (persona state timeline); Part II §51 (acceleration, not dependency), §62 (fallback), §64 (deployment)

## Context

The avatar runtime gives the training persona a face: a portrait that reacts, holds
eye contact, looks sceptical when the trainee overpromises, and moves its mouth in
time with the persona's speech. It is a separate specification with its own numbering,
and that specification carries **its own ten ADRs in its §90** — one-line decisions,
recorded there without their reasoning.

This ADR folds those ten into this repository's format, so that a decision affecting
`services/avatar-runtime/`, the session WebSocket contract and the Persona card is
recorded where the rest of this system's decisions are, with the reasoning and the
costs written out.

Three constraints frame everything below.

**Two models, one face.** LivePortrait animates a portrait from a driving signal:
head pose, eyes, blinking, upper-face expression, idle and listening motion. MuseTalk
does speech-driven lip sync on the lower face. Naively chaining them —
`LivePortrait full face → MuseTalk full face → output` — is the obvious approach and
the spec's §2 lists exactly what it produces: skin-texture flicker, a jittering mouth
boundary, identity drift, doubled mouth deformation, frame-to-frame jitter. Two models
editing the same pixels fight each other.

**Two very different accelerators.** The development and demo platform is Apple
Silicon (MLX/Metal); the performance target is an NVIDIA RTX host (CUDA/TensorRT).
These share no runtime, no kernel library and no packaging story — and per §25 the
MLX/Metal workers cannot run in Docker at all (see
[ADR-0009](0009-systemd-over-docker-deployment.md)).

**The avatar is not the product.** The product is the training session: the
conversation, the evaluation, the compliance findings. The avatar is a presentation
layer over it, and it involves real-time GPU inference, which is the least reliable
thing in the stack.

## Decision

### 1. LivePortrait owns expression and pose; MuseTalk owns the mouth ROI only

*(spec ADR-001)*

> **LivePortrait 管「演技」，MuseTalk 管「嘴」。**

MuseTalk's output is composited into the mouth **region of interest** only, never over
the whole frame: mouth → mask → feather → colour match → alpha blend → temporal
smooth (§22). The mask comes from face parsing or a landmark polygon, not a rectangle
— a rectangular paste is visible as a seam on every frame.

The division is a contract, not a suggestion. Any change that lets one model touch the
other's territory reintroduces the §2 artefacts.

### 2. A self-built Expression Controller maps persona state to visuals; the LLM never touches model parameters

*(spec ADR-002)*

LivePortrait has no `emotion="angry"` API — that product-level abstraction does not
exist upstream. So the path is:

```text
semantic persona state  →  Expression Controller  →  curated motion template
                                                     / keypoint delta  →  LivePortrait
```

`ExpressionState` carries `name`, `intensity`, head yaw/pitch/roll, eye openness,
blink rate, gaze x/y and motion energy. The agent layer emits **semantics** —
`emotion: "skeptical"`, a trust value — and the controller translates. Hysteresis on
the state transition prevents the face oscillating when a value sits on a boundary.

Head and gaze are clamped for the first version (§70): yaw ±8–12°, pitch ±5–8°, roll
±5°, gaze restricted to `user`, `slightly_away`, `down`. A persona card is a small
frame; large head motion reads as a glitch, not as acting.

This is the same authority rule as [ADR-0004](0004-webgpu-as-acceleration-layer.md),
one layer down: the model produces meaning, the deterministic layer produces
parameters. An LLM writing keypoint deltas is unreviewable, untestable and one
prompt-injection away from a face doing something unacceptable.

### 3. Expression State Bank first; continuous dual inference later

*(spec ADR-003)*

**Mode A (P0)** pre-generates a motion template / idle loop per expression per avatar.
At runtime the persona state selects a loop and only MuseTalk runs live:

```text
Persona State → select expression loop → MuseTalk lip sync → output
```

**Mode B (P1)** runs LivePortrait per frame alongside MuseTalk and composites.
Higher latency, more memory pressure, harder blending, and it requires a genuinely
streaming pipeline. It is for RTX 4080/4090 and M-series Max/Ultra experiments.

Mode A wins the first version on every axis that matters here: lowest latency, easily
achievable on a Mac, lower RTX load, stable expressions, testable output, and each
persona's loops can be hand-corrected before shipping. The first version does **not**
treat Mode B as the only path.

The first release ships six expressions (§69): `neutral`, `listening`, `skeptical`,
`concerned`, `frustrated`, `interested`. `angry`, `confused`, `thinking`, `satisfied`,
`ready` and `disengaged` come second.

### 4. MLX on Mac, CUDA/TensorRT on RTX, behind one `AvatarBackend`

*(spec ADR-004, ADR-005, ADR-006)*

```python
class AvatarBackend(Protocol):
    async def load_avatar(self, avatar_id: str) -> None: ...
    async def set_state(self, state: dict) -> None: ...
    async def push_audio(self, pcm: bytes) -> None: ...
    async def frames(self) -> AsyncIterator[bytes]: ...
    async def interrupt(self) -> None: ...
    async def close(self) -> None: ...
```

Two implementations — `MacMLXAvatarBackend` and `RTXCudaAvatarBackend` — behind one
protocol. Mac takes the MLX-native route (FasterLivePortrait-MLX, MuseTalk-MLX); RTX
takes FasterLivePortrait with TensorRT plus MuseTalk on CUDA.

**The web app does not know which hardware it is talking to.** It asks one
`AvatarProvider` API for a session, exactly as `apps/web` asks `packages/ai-runtime`
for an embedding without choosing a backend.

TTS is abstracted the same way (§48): the runtime is not bound to ElevenLabs — any
provider (ElevenLabs, MiniMax Speech, a local engine) is normalised to PCM plus
timestamps before it reaches the pipeline.

### 5. Audio PTS is the master clock

*(spec ADR-007)*

> **Audio PTS 是主時鐘。**

At 25 fps one frame is 40 ms and `frame_pts = frame_index / 25`. Drift is checked
every 1–2 seconds, and a late video frame is **dropped, not queued** — queueing turns
a transient stall into permanent lag. The initial target is `|A/V drift| < 80 ms`,
tightened against measurement.

Audio is the master because it is what a listener notices. A dropped video frame is
invisible; 100 ms of lip-sync offset is not, and drifting audio is unintelligible.
This is also why "audio still playing while the face is frozen" is the *correct*
appearance of a degrade rather than a symptom of a crash.

Related timing rule (§47): **state is sent before audio.** State at t=0, expression
transition at t=50–200 ms, audio at t=150–400 ms — so the persona visibly prepares to
speak instead of snapping into speech.

### 6. WebRTC carries media; WebSocket carries control

*(spec ADR-008)*

```text
Avatar Runtime → VideoTrack → H.264 → WebRTC → Browser     media
                              WebSocket                     state / control / metrics
```

WebRTC exists for real-time media: jitter buffering, congestion control, adaptive
bitrate and low-latency A/V. A WebSocket carrying video frames re-implements all of
that badly. Conversely, control and state are small, ordered, reliable messages —
exactly what a WebSocket is for. The runtime emits `avatar.ready`, `avatar.loading`,
`avatar.state.changed`, `avatar.expression.transition`, `avatar.audio.buffering`,
`avatar.speaking.started`, `avatar.speaking.ended`, `avatar.interrupted`,
`avatar.frame.drop`, `avatar.runtime.degraded` and `avatar.error` (§45).

Note the operational consequence, already recorded in
[`roadmap.md`](../roadmap.md): WebRTC media does not traverse the HTTP proxy, so a
deployment needs STUN/TURN alongside it. nginx handles signalling over `/ws` only.

### 7. An avatar failure must never end a training session

*(spec ADR-009 — the load-bearing rule)*

> **Avatar 故障不得終止 AI Training Session。**

The §53 fallback ladder:

| Failure | Behaviour |
|---|---|
| LivePortrait fails | freeze the expression; MuseTalk keeps driving the mouth |
| MuseTalk fails | LivePortrait motion continues; audio continues |
| **Both fail** | **static portrait + audio — the session continues** |

Degrades are announced (`avatar.runtime.degraded`) rather than hidden, and the session
socket's own `runtime.fallback` semantics apply: a quiet status change, never an error
modal, never a blocked UI. This is Part II §62's rule applied to a second runtime, and
it is the reason the fallback path is built before the fast path.

How to confirm a degrade rather than a crash is in
[`troubleshooting.md`](../troubleshooting.md#the-avatar-runtime-is-unavailable).

### 8. Licensed, consented avatars only

*(spec ADR-010)*

Only self-made, synthetic, or explicitly consented likenesses. §73 requires each asset
to store `source`, `license`, `consent`, `owner` and `created_at`. There is no
"we'll sort the paperwork later" path: an avatar without those five fields is not a
usable asset.

## Consequences

### Good

- **Stable, identity-preserving frames.** Confining MuseTalk to the mouth ROI removes
  the entire §2 artefact class — texture flicker, boundary jitter, identity drift —
  rather than trying to smooth it away afterwards.
- **The face is reviewable.** Expressions come from curated templates a human
  approved, per persona. A coach can look at the six loops before a persona ships.
  That is not possible when a model writes the parameters.
- **Mac is a first-class target.** Mode A plus MLX makes the demo run well on the
  machine it is developed on, which is worth a great deal in practice.
- **The frontend is hardware-agnostic.** One `AvatarProvider` API; adding a third
  backend changes one package. The same shape as `packages/ai-runtime`, deliberately.
- **A/V sync has a single answer.** "Audio PTS is the clock" resolves every timing
  argument before it starts, and makes frame-dropping the obvious behaviour instead of
  a judgement call.
- **The session survives the avatar.** The most valuable property here. A GPU worker
  crash costs the trainee a moving portrait, not their session, their transcript or
  their evaluation.

### Bad, and what we do about it

- **The InsightFace licence is a real commercial blocker.** LivePortrait's *code* is
  MIT, but its official licence states plainly that the **default InsightFace
  detection models are non-commercial research only** (§74). Shipping commercially
  requires replacing that detection model and re-auditing every model asset. This is
  not a footnote to resolve at launch — it gates commercial use, it may change
  detection quality, and it must be tracked as a release blocker. MuseTalk's code is
  also MIT, and redistribution must still carry the MuseTalk licence, third-party
  notices and dependent model licences.
- **Community MLX ports are unpinned upstreams.** `fasterliveportrait-mlx` and
  `musetalk-mlx` are community work. §74 requires a pinned SHA, a pinned weights
  revision, a checksum, a regression run, a security review and a licence review
  before either goes into a deployment. That is real ongoing maintenance on code we do
  not control.
- **Expression templates are content, not code.** Every avatar needs its six loops
  generated and hand-checked. Adding a persona is no longer purely a data entry task,
  and the second-version expression set multiplies that work. Accepted as the price of
  reviewable output; Mode B is what removes it, eventually.
- **Mode A cannot express continuous emotion.** A discrete bank means the face steps
  between states rather than sliding. Hysteresis stops it oscillating, but a slow
  build of frustration across a conversation renders as a few transitions. Mode B is
  the answer, in P1.
- **WebRTC needs infrastructure the rest of the system does not.** STUN/TURN servers,
  and media that cannot go through the existing nginx path. Unbuilt, and listed as
  such in [`roadmap.md`](../roadmap.md).
- **Two accelerator paths to test.** Every avatar change needs verifying on MLX and on
  CUDA/TensorRT, and the fallback ladder needs testing on both — including the
  both-models-failed case, which is the one nobody exercises by accident.
- **Host-native packaging.** Per §25 the MLX/Metal workers cannot be containerised,
  which is the driving constraint behind
  [ADR-0009](0009-systemd-over-docker-deployment.md) and its loss of reproducible
  image builds.
- **Consent records are a data obligation.** Source, licence, consent, owner and
  creation time have to be stored, surfaced to admins and kept current. See
  [`dataset.md`](../dataset.md#avatar-assets) — and note that no such table exists in
  `packages/shared/src/entities.ts` yet.

### Rejected alternatives

- **Chaining both models over the full face** — rejected by §2. It is the intuitive
  design and it produces visibly broken output.
- **Letting the LLM emit LivePortrait parameters directly** — rejected by spec
  ADR-002. Unreviewable, untestable, and it puts model-controlled values on a
  rendering path where a bad one is a product incident.
- **Continuous dual inference (Mode B) as the only mode** — rejected for the first
  version by spec ADR-003. It is a P1 target, not a starting point.
- **One accelerator only (Mac *or* RTX)** — rejected by ADR-004/005/006. Mac is where
  the work happens; RTX is where the performance target lives. Both are required.
- **Video over the existing WebSocket** — rejected by spec ADR-008. It means
  re-implementing jitter buffering and congestion control, worse.
- **Video as the master clock** — rejected by spec ADR-007. Frame-rate-driven timing
  makes audio stretch or stall, which is far more noticeable than a dropped frame.
- **Treating an avatar failure as a session error** — rejected outright by spec
  ADR-009, and it would contradict Part II §62 as well.
- **Using a real person's likeness without a consent record** — rejected by spec
  ADR-010 and §73. There is no configuration for it.
