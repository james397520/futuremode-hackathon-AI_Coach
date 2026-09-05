/**
 * Focus ring — spec §47 Accessibility（visible focus）。
 *
 * 決策：ring 顏色來自 --accent-ink（accent 的可讀文字版），不是 neon cyan（§99），
 * 在 light / dark 都自動跟著 token 走。
 *
 * 為什麼不再用 --accent-blue 48%：focus 指示器對背景要有 3:1（WCAG 2.2 Focus
 * Appearance），淡藍 48% 疊在淺色玻璃上量得 1.4:1，等於看不見。
 * --accent-ink 80% 在 light 為 3.7–4.0:1、dark 為 5.1–5.7:1。
 * 所有可互動元件都必須帶上其中一個常數。
 */

/** 標準 focus ring（有 2px offset）— button / input / card 等獨立元件。 */
export const focusRing =
  'outline-none focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-[color:color-mix(in_srgb,var(--accent-ink)_80%,transparent)] ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';

/** 緊貼式 focus ring（無 offset）— menu item / list row / tab 等密集清單。 */
export const focusRingTight =
  'outline-none focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-[color:color-mix(in_srgb,var(--accent-ink)_75%,transparent)]';

/** 給「外框是 wrapper、真正 focus 的是內部 input」的組合用。 */
export const focusRingWithin =
  'focus-within:ring-2 ' +
  'focus-within:ring-[color:color-mix(in_srgb,var(--accent-ink)_70%,transparent)]';

/** §47 hit target ≥ 32px。小尺寸元件請套用這個最小高度。 */
export const minHitTarget = 'min-h-8 min-w-8';
