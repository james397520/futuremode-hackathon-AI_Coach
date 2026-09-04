/**
 * Tone helpers — spec §19 (pastel pills at 12–22% opacity), §42 (dark mode glass), §99.
 *
 * Why inline `color-mix()` instead of Tailwind opacity modifiers:
 * `packages/design-tokens/src/tailwind-preset.ts` maps colours to bare
 * `var(--accent-*)` values without an `<alpha-value>` placeholder, so
 * `bg-accent-indigo/16` cannot produce a translucent colour. `color-mix()` keeps
 * us 100% on design tokens (no hex literals anywhere — §99) while still giving
 * the 12–22% pastel washes the reference UI needs.
 */

import type { CSSProperties } from 'react';

export type ToneKey =
  | 'indigo'
  | 'blue'
  | 'cyan'
  | 'mint'
  | 'violet'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral';

const TONE_VARS: Record<ToneKey, string> = {
  indigo: '--accent-indigo',
  blue: '--accent-blue',
  cyan: '--accent-cyan',
  mint: '--accent-mint',
  violet: '--accent-violet',
  success: '--success',
  warning: '--warning',
  danger: '--danger',
  info: '--info',
  neutral: '--text-tertiary',
};

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** CSS variable reference for a tone, e.g. `var(--accent-mint)`. */
export function toneVar(tone: ToneKey): string {
  return `var(${TONE_VARS[tone]})`;
}

/** Translucent tone wash. `pct` is 0–100. */
export function tint(tone: ToneKey, pct: number): string {
  return `color-mix(in srgb, ${toneVar(tone)} ${clamp(pct, 0, 100)}%, transparent)`;
}

/** Tone mixed toward the primary text colour so small labels stay readable in both themes. */
export function toneText(tone: ToneKey): string {
  if (tone === 'neutral') return 'var(--text-secondary)';
  return `color-mix(in srgb, ${toneVar(tone)} 78%, var(--text-primary))`;
}

/** Pastel pill surface (§19: fill 12–22%, hairline border, no heavy borders — §99). */
export function pillSurface(tone: ToneKey, fill = 16): CSSProperties {
  return {
    backgroundColor: tint(tone, fill),
    borderColor: tint(tone, clamp(fill + 18, 0, 55)),
    color: toneText(tone),
  };
}

/** Inset card surface used by Objective / Coach blocks (§21 淡藍 inset card, 1px border). */
export function insetSurface(tone: ToneKey, fill = 10): CSSProperties {
  return {
    backgroundColor: tint(tone, fill),
    borderColor: tint(tone, clamp(fill + 14, 0, 48)),
  };
}

/** Soft gradient used by the 4px persona meters (§22 — thin line, never a speedometer). */
export function meterGradient(tone: ToneKey): string {
  return `linear-gradient(90deg, ${tint(tone, 55)}, ${toneVar(tone)})`;
}

/** Aurora glow behind the persona stage (§20.1 / §42.2 — keep the portrait warm, never crushed). */
export function auroraGlow(intensity = 1): string {
  const a = clamp(Math.round(26 * intensity), 0, 100);
  const b = clamp(Math.round(20 * intensity), 0, 100);
  const c = clamp(Math.round(22 * intensity), 0, 100);
  return [
    `radial-gradient(circle at 22% 18%, ${tint('blue', a)}, transparent 58%)`,
    `radial-gradient(circle at 78% 24%, ${tint('violet', c)}, transparent 60%)`,
    `radial-gradient(circle at 50% 92%, ${tint('mint', b)}, transparent 62%)`,
  ].join(', ');
}
