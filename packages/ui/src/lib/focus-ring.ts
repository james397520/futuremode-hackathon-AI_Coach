/**
 * Focus ring — spec §47 Accessibility（visible focus）。
 *
 * 決策：ring 顏色由 --accent-blue 以 color-mix 降到低透明度，
 * 因此不會出現 §99 禁止的 neon cyan outline，同時在 light / dark 都自動跟著 token 走。
 * 所有可互動元件都必須帶上其中一個常數。
 */

/** 標準 focus ring（有 2px offset）— button / input / card 等獨立元件。 */
export const focusRing =
  'outline-none focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-[color:color-mix(in_srgb,var(--accent-blue)_48%,transparent)] ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-transparent';

/** 緊貼式 focus ring（無 offset）— menu item / list row / tab 等密集清單。 */
export const focusRingTight =
  'outline-none focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-[color:color-mix(in_srgb,var(--accent-blue)_40%,transparent)]';

/** 給「外框是 wrapper、真正 focus 的是內部 input」的組合用。 */
export const focusRingWithin =
  'focus-within:ring-2 ' +
  'focus-within:ring-[color:color-mix(in_srgb,var(--accent-blue)_38%,transparent)]';

/** §47 hit target ≥ 32px。小尺寸元件請套用這個最小高度。 */
export const minHitTarget = 'min-h-8 min-w-8';
