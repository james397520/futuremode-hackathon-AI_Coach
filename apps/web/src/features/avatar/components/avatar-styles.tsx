/**
 * Avatar surface motion — the CSS that makes the §53 fallback look alive.
 *
 * Scoped `<style>` rather than a stylesheet import, matching the simulation
 * feature's `simulation-styles.tsx`: this feature does not own the global CSS
 * entry point. Only design tokens are referenced — no colour literal (§99).
 *
 * The animations are deliberately tiny and slow. A static portrait that breathes
 * and blinks reads as "a person, waiting"; the same portrait with a bouncy
 * animation reads as a loading spinner wearing a face.
 *
 * `prefers-reduced-motion` collapses every one of them; the stage stays fully
 * legible because none of them carries information on their own.
 */
const CSS = `
/* Chest/shoulder breathing — 4.5s, ~0.6% scale. Barely perceptible by design. */
@keyframes avatar-breathe {
  0%, 100% { transform: scale(1) translateY(0); }
  50%      { transform: scale(1.006) translateY(-0.35%); }
}

/* Blink: a fast eyelid sweep. Long pause, 120ms close, long pause. */
@keyframes avatar-blink {
  0%, 92%, 100% { opacity: 0; }
  94%, 96%      { opacity: 1; }
}

/* §43 speaking: the glow breathes, the card never flashes. */
@keyframes avatar-speak-pulse {
  0%, 100% { opacity: 0.35; transform: scaleX(0.9); }
  50%      { opacity: 0.9;  transform: scaleX(1); }
}

/* Listening: a slow ring bloom, so "waiting for you" is visible at a glance. */
@keyframes avatar-listen-ring {
  0%   { opacity: 0.5; transform: scale(0.96); }
  70%  { opacity: 0;   transform: scale(1.06); }
  100% { opacity: 0;   transform: scale(1.06); }
}

/* Expression change: a one-shot wash across the portrait (§45 transition). */
@keyframes avatar-transition-wash {
  from { opacity: 0.85; }
  to   { opacity: 0; }
}

/* Warm-up shimmer while the runtime loads its models. */
@keyframes avatar-warm {
  from { background-position: -40% 50%; }
  to   { background-position: 140% 50%; }
}

.avatar-breathe { animation: avatar-breathe 4600ms var(--ease-out-soft, ease-in-out) infinite; transform-origin: 50% 88%; }
.avatar-breathe-fast { animation-duration: 3200ms; }
.avatar-blink { animation: avatar-blink 5400ms linear infinite; }
.avatar-speak-pulse { animation: avatar-speak-pulse 1500ms var(--ease-out-soft, ease-in-out) infinite; }
.avatar-listen-ring { animation: avatar-listen-ring 2400ms var(--ease-out-soft, ease-in-out) infinite; }
.avatar-transition-wash { animation: avatar-transition-wash 420ms var(--ease-out-soft, ease-out) both; }
.avatar-warm { background-size: 220% 100%; animation: avatar-warm 1800ms linear infinite; }

/* The live canvas: fill the stage, never letterbox on a fractional aspect. */
.avatar-canvas {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  /* §72 — no alpha over plain H.264; the stage owns the background instead. */
  background-color: var(--bg-canvas-soft);
}

/* Expression + intensity are applied as CSS variables from the store so a state
   change is one style write, not a re-render of the portrait. */
.avatar-portrait-shell {
  transform:
    rotate(var(--avatar-roll, 0deg))
    translate3d(calc(var(--avatar-yaw, 0) * 0.22%), calc(var(--avatar-pitch, 0) * 0.22%), 0);
  transition: transform 620ms var(--ease-out-soft, ease-out);
  will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
  .avatar-breathe, .avatar-blink, .avatar-speak-pulse,
  .avatar-listen-ring, .avatar-transition-wash, .avatar-warm {
    animation: none !important;
  }
  .avatar-portrait-shell { transition: none; transform: none; }
}
`;

export function AvatarStyles() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}
