/**
 * Motion + scrollbar CSS for the simulation surface — spec §43 Motion System,
 * §16 (thin right-hand scrollbar), §42 (dark mode detail).
 *
 * Written as a scoped <style> block rather than a `.css` import because this
 * feature does not own `apps/web/src/styles` or the global CSS entry point.
 * Only design tokens are referenced — no colour literal appears here (§99).
 */
import { TONE_CSS } from '../lib/tone';

const CSS = `
/* Theme-conditional ink + tone-text mixes (see lib/tone.ts). */
${TONE_CSS}

/* §43 Card enter: opacity 0→1, translateY 8→0, 280ms */
@keyframes sim-card-enter {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* §43 Floating right panel: translateX 12→0, 320ms */
@keyframes sim-float-in {
  from { opacity: 0; transform: translateX(12px); }
  to   { opacity: 1; transform: translateX(0); }
}

/* §43 Live speaking: bottom glow + tiny pulse. The card never flashes. */
@keyframes sim-speaking-glow {
  0%, 100% { opacity: 0.45; transform: scaleX(0.82); }
  50%      { opacity: 1;    transform: scaleX(1); }
}

@keyframes sim-listening-dot {
  0%, 100% { opacity: 0.35; transform: scale(0.9); }
  50%      { opacity: 1;    transform: scale(1); }
}

@keyframes sim-caret {
  0%, 45%  { opacity: 1; }
  55%, 100%{ opacity: 0.1; }
}

@keyframes sim-meter-shimmer {
  from { background-position: 0% 50%; }
  to   { background-position: 140% 50%; }
}

@keyframes sim-marker-pop {
  from { opacity: 0; transform: translateY(4px) scale(0.94); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}

.sim-card-enter { animation: sim-card-enter var(--dur-card-enter, 320ms) var(--ease-out-soft) both; }
.sim-float-in   { animation: sim-float-in 320ms var(--ease-out-soft) both; }
.sim-marker-pop { animation: sim-marker-pop 240ms var(--ease-out-soft) both; }

/* §43 Hover: translateY -1, shadow +10% */
.sim-lift {
  transition: transform var(--dur-hover, 140ms) var(--ease-out-soft),
              box-shadow var(--dur-hover, 140ms) var(--ease-out-soft);
}
.sim-lift:hover { transform: translateY(-1px); box-shadow: var(--shadow-floating); }

.sim-speaking-glow { animation: sim-speaking-glow 1600ms var(--ease-out-soft) infinite; }
.sim-listening-dot { animation: sim-listening-dot 1400ms var(--ease-out-soft) infinite; }
.sim-caret         { animation: sim-caret 1000ms steps(1, end) infinite; }

/* Streaming meter fill gets a slow sheen while a value is in flight. */
.sim-meter-live { background-size: 220% 100%; animation: sim-meter-shimmer 2600ms linear infinite; }

/* §16 thin right-hand scrollbar, tokenised for both themes. */
.sim-scroll {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--text-tertiary) 38%, transparent) transparent;
  overscroll-behavior: contain;
}
.sim-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
.sim-scroll::-webkit-scrollbar-track { background: transparent; }
.sim-scroll::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--text-tertiary) 34%, transparent);
  border-radius: var(--radius-pill);
}
.sim-scroll::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--text-tertiary) 52%, transparent);
}

/* Transcript reading rhythm (§16 / §25 document style). */
.sim-transcript-body {
  color: var(--text-secondary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* §42.2 Persona portrait: warm, never crushed in dark mode.
   One token shadow. The previous rule stacked a hand-rolled 22% text-primary
   drop shadow (which flips to a *light* glow in dark mode, where text-primary is
   near white) on top of a 1px rim ring, doubling the card's own elevation. */
.sim-portrait { box-shadow: var(--shadow-floating); }
[data-theme='dark'] .sim-portrait { filter: saturate(1.04) brightness(1.06); }

/* Popover menu rows — a tokenised hover wash instead of bg-black/5. */
.sim-menu-item { transition: background-color var(--dur-hover, 140ms) var(--ease-out-soft); }
.sim-menu-item:hover { background-color: color-mix(in srgb, var(--text-tertiary) 12%, transparent); }

/* Floating context cards over the 3D stage (the stage-fill layout).

   Each card is its own pane of liquid glass, not one merged plate and not a
   tinted card: an earlier version filled the stack with 72% --bg-canvas, which
   read as a coloured panel sitting on the stage instead of glass floating over
   it. What sells real glass is refraction plus a lit rim — heavy blur, a
   barely-there body, and a bright top-left edge where the curve catches the
   light — so the character stays visible straight through every card.

   The white comes from --text-on-media, the one token that is deliberately
   theme-invariant because it is painted over media rather than over the page
   canvas; a themed surface token would invert against the stage. */
.sim-stage-overlay { background: none; border: 0; box-shadow: none; }

/* The stage behind the cards is a 3D character, and the suit is near-black:
   the page's own --text-primary (near-black in light mode) fell to ~1.3:1 on
   the chest. Inside the overlay every text token is therefore rebound to the
   on-media ramp, which is what --text-on-media exists for.

   --sim-ink must NOT follow, or every inset scrim inside a card would invert
   to white and the drop shadow would become a halo. It is captured on the host
   element first, because rebinding a custom property in terms of itself on the
   same element is a cycle and resolves to nothing. */
.sim-stage-overlay-host { --sim-ink-locked: var(--sim-ink); }

.sim-stage-overlay {
  --sim-ink: var(--sim-ink-locked, var(--text-primary));
  --text-primary: var(--text-on-media);
  --text-secondary: color-mix(in srgb, var(--text-on-media) 84%, transparent);
  --text-tertiary: color-mix(in srgb, var(--text-on-media) 66%, transparent);
  color: var(--text-on-media);
}

.sim-stage-overlay > * {
  background: linear-gradient(
    152deg,
    color-mix(in srgb, var(--text-on-media) 15%, transparent) 0%,
    color-mix(in srgb, var(--text-on-media) 5%, transparent) 50%,
    color-mix(in srgb, var(--text-on-media) 9%, transparent) 100%
  ) !important;
  backdrop-filter: blur(30px) saturate(180%) brightness(1.04);
  -webkit-backdrop-filter: blur(30px) saturate(180%) brightness(1.04);
  border: 1px solid color-mix(in srgb, var(--text-on-media) 30%, transparent) !important;
  border-radius: 22px;
  box-shadow:
    0 20px 52px -14px color-mix(in srgb, var(--sim-ink) 34%, transparent),
    inset 0 1px 0 0 color-mix(in srgb, var(--text-on-media) 52%, transparent),
    inset 1px 0 0 0 color-mix(in srgb, var(--text-on-media) 24%, transparent),
    inset 0 -1px 0 0 color-mix(in srgb, var(--sim-ink) 14%, transparent) !important;
}

/* Two-column, chest-height layout: the cards have to give back the padding a
   full-width sidebar card can afford. The timeline is the one wide card, so it
   spans the pair instead of being squeezed into half a column — but only when it
   is the odd fifth card; the voice page floats just two, which must stay side by
   side. */
.sim-stage-overlay > * {
  padding: 10px 12px !important;
  border-radius: 18px !important;
}

.sim-stage-overlay > *:nth-child(n + 3):last-child { grid-column: 1 / -1; }

/* Cards in a row stretch to the row's height (items-stretch) rather than
   leaving a hole under the shorter one — the glass should be one clean strip.
   Stretching only works if the card itself is a column that can absorb the
   extra height, so its last block is pushed to the bottom instead of the card
   ending early with dead space below it. */
.sim-stage-overlay > * { display: flex; flex-direction: column; }
.sim-stage-overlay > * > *:last-child { margin-top: auto; }

/* The scrollbar is the affordance that the stack continues past the cap, so it
   stays visible rather than fading to transparent over the 3D stage. */
.sim-stage-overlay.sim-scroll { scrollbar-color: color-mix(in srgb, var(--text-on-media) 46%, transparent) transparent; }
.sim-stage-overlay.sim-scroll::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--text-on-media) 42%, transparent);
}
.sim-stage-overlay.sim-scroll::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--text-on-media) 64%, transparent);
}

/* Inset blocks inside a floating card would otherwise stack a second surface
   on the glass and turn it opaque. */
.sim-stage-overlay > * .glass-card,
.sim-stage-overlay > * .glass-strong {
  background: color-mix(in srgb, var(--text-on-media) 8%, transparent);
  border-color: color-mix(in srgb, var(--text-on-media) 18%, transparent);
  box-shadow: none;
}

/* Kit pills default to the strong glass surface, which is near-white in light
   mode — a white blob on dark glass. Same on-media wash as the inset blocks. */
.sim-stage-overlay > * .bg-glass-strong {
  background: color-mix(in srgb, var(--text-on-media) 12%, transparent);
  color: var(--text-on-media);
}

/* Trainee self-view: a rim + shadow so the webcam picture reads as a pane
   floating over the stage rather than a hole punched in it. */
.sim-self-view {
  border: 1px solid color-mix(in srgb, var(--text-on-media) 34%, transparent);
  box-shadow:
    0 14px 34px -12px color-mix(in srgb, var(--sim-ink) 46%, transparent),
    inset 0 1px 0 0 color-mix(in srgb, var(--text-on-media) 40%, transparent);
  background: color-mix(in srgb, var(--sim-ink) 40%, transparent);
}

/* Emotion badge (AffectFace). The mint segment orbits the ring — that motion is
   the reference's whole identity, so it runs continuously rather than only on
   change. The eyes blink on a slow, irregular-feeling cycle and pop when the
   emotion changes. Both are cheap transforms on the compositor. */
@keyframes af-orbit {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

@keyframes af-blink {
  0%, 92%, 100% { transform: scaleY(1); }
  95%           { transform: scaleY(0.12); }
}

@keyframes af-pop {
  from { opacity: 0; transform: scale(0.82); }
  to   { opacity: 1; transform: scale(1); }
}

.af-orbit {
  transform-origin: 50px 50px;
  animation: af-orbit linear infinite;
}

.af-eyes {
  transform-origin: 50px 46px;
  animation:
    af-pop 260ms var(--ease-out-soft) both,
    af-blink 5200ms var(--ease-out-soft) 260ms infinite;
}

.sim-affect-face {
  filter: drop-shadow(0 2px 6px color-mix(in srgb, var(--sim-ink) 55%, transparent));
}

/* Focus ring built from tokens (accessibility, §50). */
.sim-focusable:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-blue) 70%, transparent);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .sim-card-enter, .sim-float-in, .sim-marker-pop,
  .sim-speaking-glow, .sim-listening-dot, .sim-caret, .sim-meter-live,
  .af-orbit, .af-eyes {
    animation: none !important;
  }
  .sim-lift:hover { transform: none; }
}
`;

export function SimulationStyles() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}
