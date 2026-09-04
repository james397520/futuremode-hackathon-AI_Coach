/**
 * @ai-coach/ui — Soft Aurora Glassmorphism 元件庫。
 *
 * 所有視覺都由 `@ai-coach/design-tokens` 的 CSS 變數驅動（§99：禁止 hardcode 顏色）。
 * 這裡**只有通用視覺元件**，不含任何業務語意（Persona / Scenario / Knowledge…）——
 * 那些屬於 `apps/web`（見 docs/PROJECT_STRUCTURE.md §4）。
 *
 * host app 必須 import：
 *   @ai-coach/design-tokens/tokens.css   （CSS 變數）
 *   @ai-coach/design-tokens/aurora.css   （aurora-canvas / dot-matrix / glass utility）
 * 並在 tailwind.config 套用 `aiCoachPreset`。
 */

/* ---- utils ---- */
export { cn, type ClassValue } from './lib/cn';
export { focusRing, focusRingTight, focusRingWithin, minHitTarget } from './lib/focus-ring';

/* ---- layout / surfaces ---- */
export * from './components/glass-shell';
export * from './components/glass-card';
export * from './components/section-header';

/* ---- controls ---- */
export * from './components/button';
export * from './components/icon-button';
export * from './components/input';
export * from './components/textarea';
export * from './components/select';
export * from './components/switch';
export * from './components/slider';
export * from './components/tabs';

/* ---- overlays ---- */
export * from './components/dialog';
export * from './components/drawer';
export * from './components/tooltip';
export * from './components/dropdown-menu';
export * from './components/popover';
export * from './components/toast';
export * from './components/command-palette';

/* ---- controls (composed) ---- */
export * from './components/field';
export * from './components/segmented-control';

/* ---- data display ---- */
export * from './components/gradient-pill';
export * from './components/pill';
export * from './components/sparkle';
export * from './components/progress';
export * from './components/avatar';
export * from './components/scroll-area';
export * from './components/skeleton';
export * from './components/empty-state';
export * from './components/stat-tile';
export * from './components/data-list';

/* ---- motion presets (§43) ---- */
export * from './components/motion';
