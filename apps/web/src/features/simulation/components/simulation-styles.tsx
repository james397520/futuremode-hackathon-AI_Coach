/**
 * Motion + scrollbar CSS for the simulation surface — spec §43 Motion System,
 * §16 (thin right-hand scrollbar), §42 (dark mode detail).
 *
 * Written as a scoped <style> block rather than a `.css` import because this
 * feature does not own `apps/web/src/styles` or the global CSS entry point.
 * Only design tokens are referenced — no colour literal appears here (§99).
 */

const CSS = `
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

/* §42.2 Persona portrait: warm, never crushed in dark mode. */
.sim-portrait {
  box-shadow: 0 24px 55px color-mix(in srgb, var(--text-primary) 22%, transparent),
              0 0 0 1px var(--border-glass);
}
[data-theme='dark'] .sim-portrait { filter: saturate(1.04) brightness(1.06); }

/* Focus ring built from tokens (accessibility, §50). */
.sim-focusable:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--accent-blue) 70%, transparent);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .sim-card-enter, .sim-float-in, .sim-marker-pop,
  .sim-speaking-glow, .sim-listening-dot, .sim-caret, .sim-meter-live {
    animation: none !important;
  }
  .sim-lift:hover { transform: none; }
}
`;

export function SimulationStyles() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}
