#!/usr/bin/env node
/**
 * Offline WCAG contrast audit of the design tokens.
 *
 * Reads `packages/design-tokens/src/tokens.css`, resolves both themes, and
 * prints the contrast ratio of every text token on every surface token, with
 * translucent surfaces composited over the canvas first (a blurred backdrop is
 * treated as the flat canvas colour, which is what heavy blur converges to).
 *
 *   node scripts/audit-contrast.mjs            # both themes, table
 *   node scripts/audit-contrast.mjs --fail     # exit 1 if any pair < AA
 *
 * Thresholds: 4.5:1 for normal text, 3:1 for large (>=18px or >=14px bold).
 * The table reports against 4.5 and flags 3.0–4.5 as "large only".
 *
 * Why this exists: the same check was rewritten inline five times during the
 * visual pass, twice wrongly (once dividing 0–1 `color()` channels by 255,
 * once ignoring alpha). This is the one copy that is known to be right.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'packages/design-tokens/src/tokens.css'), 'utf8');

// ---------------------------------------------------------------------------
// parse tokens.css into { light: {name: value}, dark: {...} }
// ---------------------------------------------------------------------------
function block(selector) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unbalanced block for ${selector}`);
}
function vars(text) {
  const out = {};
  for (const m of text.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const light = vars(block(':root'));
const dark = { ...light, ...vars(block("[data-theme='dark']")) };

// ---------------------------------------------------------------------------
// colour maths
// ---------------------------------------------------------------------------
function parse(v) {
  v = v.trim();
  let m;
  if ((m = v.match(/^#([0-9a-f]{6})$/i))) {
    const n = parseInt(m[1], 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255), a: 1 };
  }
  if ((m = v.match(/^#([0-9a-f]{3})$/i))) {
    return { rgb: m[1].split('').map((c) => parseInt(c + c, 16) / 255), a: 1 };
  }
  if ((m = v.match(/^rgba?\(([^)]+)\)$/))) {
    const p = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    return { rgb: p.slice(0, 3).map((c) => c / 255), a: p[3] ?? 1 };
  }
  return null; // gradients, var() refs, etc.
}
const over = (fg, bg) => fg.rgb.map((c, i) => c * fg.a + bg[i] * (1 - fg.a));
function lum(rgb) {
  const f = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// ---------------------------------------------------------------------------
// what to test
// ---------------------------------------------------------------------------
const TEXT = ['text-primary', 'text-secondary', 'text-tertiary'];
const ACCENT = ['accent-indigo', 'accent-blue', 'accent-cyan', 'accent-mint', 'accent-violet',
  'success', 'warning', 'danger', 'info'];
const SURFACES = ['bg-canvas', 'bg-canvas-soft', 'glass-shell', 'glass-card', 'glass-card-strong'];

function audit(name, t) {
  const canvas = parse(t['bg-canvas']).rgb;
  const surfaces = {};
  for (const s of SURFACES) {
    const p = parse(t[s]);
    if (p) surfaces[s] = p.a < 1 ? over(p, canvas) : p.rgb;
  }
  const rows = [];
  for (const txt of TEXT) {
    const p = parse(t[txt]);
    if (!p) continue;
    for (const [s, bg] of Object.entries(surfaces)) rows.push({ text: txt, surface: s, ratio: ratio(p.rgb, bg) });
  }
  // Accents are never drawn raw as text. `toneText()` in
  // apps/web/src/features/simulation/lib/tone.ts renders
  // color-mix(in srgb, <accent> 78%, var(--text-primary)); test that mix on the
  // 16% tint chip it actually sits on (tint composited over glass-card).
  const primary = parse(t['text-primary']).rgb;
  for (const acc of ACCENT) {
    const p = parse(t[acc]);
    if (!p) continue;
    const mixed = p.rgb.map((c, i) => c * 0.78 + primary[i] * 0.22);
    const chip = over({ rgb: p.rgb, a: 0.16 }, surfaces['glass-card']);
    rows.push({ text: `toneText(${acc.replace('accent-', '')})`, surface: 'chip 16% on card', ratio: ratio(mixed, chip) });
  }
  // text-on-media against the darkest and lightest plausible portrait midtones
  const media = parse(t['text-on-media']);
  if (media) {
    for (const [label, hex] of [['portrait-dark', '#3a3f4a'], ['portrait-mid', '#8a7a70'], ['portrait-light', '#c9b8ad']]) {
      rows.push({ text: 'text-on-media', surface: label, ratio: ratio(media.rgb, parse(hex).rgb) });
    }
  }

  console.log(`\n=== ${name} ===`);
  console.log('text'.padEnd(16), 'surface'.padEnd(20), 'ratio   verdict');
  let fails = 0;
  for (const r of rows) {
    const v = r.ratio >= 4.5 ? 'AA' : r.ratio >= 3 ? 'large only' : 'FAIL';
    if (v === 'FAIL') fails++;
    // Accents are used as text only on chips/labels, usually >=12px; still flag <3.
    console.log(r.text.padEnd(16), r.surface.padEnd(20), r.ratio.toFixed(2).padStart(5), '  ', v);
  }
  return fails;
}

const fails = audit('light', light) + audit('dark', dark);
console.log(`\n${fails} pair(s) below 3:1`);
if (process.argv.includes('--fail') && fails > 0) process.exit(1);
