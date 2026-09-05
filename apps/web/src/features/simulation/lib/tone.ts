/**
 * Tone helpers — spec §19 (pastel pills at 12–22% opacity), §42 (dark mode glass), §99.
 *
 * Why inline `color-mix()` instead of Tailwind opacity modifiers:
 * `packages/design-tokens/src/tailwind-preset.ts` maps colours to bare
 * `var(--accent-*)` values without an `<alpha-value>` placeholder, so
 * `bg-accent-indigo/16` cannot produce a translucent colour. `color-mix()` keeps
 * us 100% on design tokens (no hex literals anywhere — §99) while still giving
 * the 12–22% pastel washes the reference UI needs.
 *
 * Contrast (WCAG AA, 4.5:1 for the 11–16px text these helpers colour):
 * every ratio quoted below was computed by compositing the alpha surfaces over
 * the canvas token first (canvas → shell → card/strong → tint), for both themes.
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

type AccentTone = Exclude<ToneKey, 'neutral'>;

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

/**
 * How much of the accent survives in `toneText()`, per theme.
 *
 * The accents are pastels. In the light theme, 78% accent + 22% navy landed
 * between 2.1:1 (warning, mint) and 4.1:1 (indigo) on a 16% chip — below AA for
 * every tone but neutral. These are the largest accent shares that still clear
 * 4.5:1 on every `tint(tone, 0–26)` wash over both `--glass-card` and
 * `--glass-card-strong` (measured minimum 4.51:1, indigo at 26%).
 *
 * The dark theme mixes toward a near-white `--text-primary`, so the accents can
 * stay far more saturated; only indigo and danger needed trimming (4.5:1 minimum
 * on `--glass-card-strong` at 26%).
 *
 * The light values are also the `var()` fallbacks, so a chip rendered outside a
 * `<SimulationStyles/>` / `<AvatarStyles/>` subtree is still AA in both themes —
 * in dark mode a light-tuned mix only gets *more* contrast (≥5.05:1).
 */
const TONE_TEXT_MIX_LIGHT: Record<AccentTone, number> = {
  indigo: 62,
  blue: 46,
  cyan: 42,
  mint: 40,
  violet: 48,
  success: 42,
  warning: 41,
  danger: 52,
  info: 46,
};

const TONE_TEXT_MIX_DARK: Record<AccentTone, number> = {
  indigo: 70,
  blue: 78,
  cyan: 78,
  mint: 78,
  violet: 78,
  success: 78,
  warning: 78,
  danger: 72,
  info: 76,
};

const ACCENT_TONES = Object.keys(TONE_TEXT_MIX_LIGHT) as AccentTone[];

/**
 * A dark ink that stays dark in both themes, built only from tokens:
 * `--text-primary` is navy in light mode and `--bg-canvas` is navy in dark mode.
 * Needed for anything drawn *over media* (the persona portrait) or under
 * `--text-on-media`, where the theme must not flip the scrim to white.
 * The fallback is the light-theme value.
 */
export const INK = 'var(--sim-ink, var(--text-primary))';

/**
 * Theme-conditional variables behind `toneText()` and `INK`. Included by both
 * `SimulationStyles` and `AvatarStyles`; `:where()` keeps the light defaults at
 * zero specificity so the `[data-theme='dark']` block always wins.
 */
export const TONE_CSS = `
:where(:root) {
  --sim-ink: var(--text-primary);
${ACCENT_TONES.map((tone) => `  --sim-tone-mix-${tone}: ${TONE_TEXT_MIX_LIGHT[tone]}%;`).join('\n')}
}
[data-theme='dark'] {
  --sim-ink: var(--bg-canvas);
${ACCENT_TONES.map((tone) => `  --sim-tone-mix-${tone}: ${TONE_TEXT_MIX_DARK[tone]}%;`).join('\n')}
}
`;

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/** CSS variable reference for a tone, e.g. `var(--accent-mint)`. */
export function toneVar(tone: ToneKey): string {
  return `var(${TONE_VARS[tone]})`;
}

/** Translucent tone wash. `pct` is 0–100. */
export function tint(tone: ToneKey, pct: number): string {
  return `color-mix(in srgb, ${toneVar(tone)} ${clamp(pct, 0, 100)}%, transparent)`;
}

/**
 * Tone mixed toward the primary text colour so small labels stay readable in
 * both themes — AA (≥4.5:1) on every `tint(tone, 0–26)` chip over card or strong
 * glass. Also used as the fill for 6px status dots, where the same mix keeps
 * them ≥3:1 against the card.
 */
export function toneText(tone: ToneKey): string {
  if (tone === 'neutral') return 'var(--text-secondary)';
  return `color-mix(in srgb, ${toneVar(tone)} var(--sim-tone-mix-${tone}, ${TONE_TEXT_MIX_LIGHT[tone]}%), var(--text-primary))`;
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

/**
 * Translucent dark scrim for chips and plates drawn over the persona portrait.
 * With `--text-on-media` on top it is ≥4.6:1 even over a pure-white photo at the
 * default 66% (≥4.9:1 light, ≥5.9:1 dark; ~17:1 over a dark photo). Pair with a
 * `backdrop-blur` so the photo behind it flattens too.
 */
export function onMediaScrim(alpha = 66): string {
  return `color-mix(in srgb, ${INK} ${clamp(alpha, 0, 100)}%, transparent)`;
}

/** Chip over media: dark scrim + light text, in both themes. */
export function onMediaSurface(alpha = 66): CSSProperties {
  return {
    backgroundColor: onMediaScrim(alpha),
    color: 'var(--text-on-media)',
  };
}

/**
 * Primary call-to-action fill. Matches the UI kit's flattened primary button
 * (one solid indigo, no gradient), but deepened toward the ink so
 * `--text-on-media` clears AA on it: 6.0:1 light, 5.2:1 dark. The raw accent
 * alone measured 4.2:1 / 3.2:1, and the old indigo→blue→cyan gradient fell to
 * 2.0:1 at its cyan end.
 */
export function ctaSurface(): CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, var(--accent-indigo) 72%, ${INK})`,
    color: 'var(--text-on-media)',
  };
}

/**
 * Text colour for the kit's pastel `GradientPill` (blue → cyan → mint). The
 * kit paints it white, which is 1.8–2.5:1 on those stops; dark ink is
 * ≥6.1:1 light and ≥8.7:1 dark on every stop.
 */
export const pastelInk: CSSProperties = { color: INK };

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
