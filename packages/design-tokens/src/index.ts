export { aiCoachPreset, default as tailwindPreset } from './tailwind-preset';

/** §46 Responsive breakpoints — layout 決策集中在這裡，元件不要自己發明斷點 */
export const BREAKPOINTS = {
  xl: 1440, // 三欄完整：rail + conversation + persona column
  lg: 1200, // persona column 收窄
  md: 1024, // persona 卡片改為可收合 drawer
  sm: 768,  // 單欄，persona 置頂
} as const;

/** §59 Runtime badge 對外文案 — 不對一般學員顯示工程細節（§93） */
export const RUNTIME_LABEL = {
  webgpu: '本機 AI · GPU 加速',
  wasm: '本機 AI 就緒',
  server: '雲端 AI',
} as const;
