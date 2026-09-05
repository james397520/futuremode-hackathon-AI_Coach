/**
 * Paste into DevTools on any page of the app. Prints every visible text node
 * whose WCAG ratio against its *composited* background is below AA.
 *
 * Handles what the naive versions got wrong:
 *   - `color(srgb r g b / a)` channels are 0–1, not 0–255
 *   - translucent backgrounds are composited up the ancestor chain, not read raw
 *   - the canvas fallback is the theme's `--bg-canvas`
 *
 * Caveat when driving this from the Claude Browser pane: if
 * `document.visibilityState === 'hidden'` the page is not painted — CSS
 * animations sit at frame 0 and rAF never fires. Take a screenshot first to
 * force a paint, or trust only synchronous layout reads.
 */
(() => {
  const canvasVar = getComputedStyle(document.documentElement).getPropertyValue('--bg-canvas').trim();
  const parse = (c) => {
    if (!c || c === 'transparent') return null;
    if (c.startsWith('color(')) {
      const m = c.match(/[-\d.]+/g).map(Number);
      return { rgb: m.slice(0, 3), a: c.includes('/') ? m[m.length - 1] : 1 };
    }
    let m = c.match(/^#([0-9a-f]{6})$/i);
    if (m) { const n = parseInt(m[1], 16); return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255), a: 1 }; }
    m = c.match(/[\d.]+/g);
    if (!m) return null;
    return { rgb: m.slice(0, 3).map((v) => Number(v) / 255), a: m.length > 3 ? Number(m[3]) : 1 };
  };
  const canvas = parse(canvasVar)?.rgb ?? [0.851, 0.89, 0.953];
  const bgOf = (el) => {
    const stack = [];
    for (let n = el; n; n = n.parentElement) {
      const p = parse(getComputedStyle(n).backgroundColor);
      if (p && p.a > 0) stack.push(p);
    }
    let out = canvas;
    for (let i = stack.length - 1; i >= 0; i--) {
      const { rgb, a } = stack[i];
      out = out.map((v, j) => rgb[j] * a + v * (1 - a));
    }
    return out;
  };
  const lum = (rgb) => {
    const f = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  };
  const bad = [];
  document.querySelectorAll('span,p,div,button,a,h1,h2,h3,h4,li,td,th,label,input::placeholder').forEach((e) => {
    if (e.children.length) return;
    const t = (e.textContent || e.placeholder || '').trim();
    if (!t || t.length > 60) return;
    const cs = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || cs.visibility === 'hidden') return;
    const fg = parse(cs.color);
    if (!fg) return;
    const bg = bgOf(e);
    const fgc = fg.a < 1 ? fg.rgb.map((v, i) => v * fg.a + bg[i] * (1 - fg.a)) : fg.rgb;
    const L1 = lum(fgc), L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(cs.fontSize);
    const big = px >= 18 || (px >= 14 && +cs.fontWeight >= 700);
    const need = big ? 3 : 4.5;
    if (ratio < need) bad.push({ text: t.slice(0, 24), ratio: +ratio.toFixed(2), need, px, el: e });
  });
  bad.sort((a, b) => a.ratio - b.ratio);
  console.log(`theme=${document.documentElement.getAttribute('data-theme') || 'light'} visibility=${document.visibilityState} failures=${bad.length}`);
  console.table(bad.map(({ el, ...rest }) => rest));
  return bad;
})();
