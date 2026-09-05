/**
 * Motion presets — spec §43 Motion System / §47 reduced motion。
 *
 * 決策：**本 package 不依賴 framer-motion**。
 * 這裡只導出「純物件」的動效參數，由 `apps/web` 自己 `import { motion } from 'framer-motion'`
 * 再展開使用：
 *
 *   <motion.div {...respectsReducedMotion(cardEnter, reduced)}>…</motion.div>
 *
 * 好處：UI kit 不綁定動畫函式庫版本，Server Component 也能安全 import 常數。
 * 型別刻意寫寬（Record<string, unknown>），避免和 framer-motion 的型別打架。
 *
 * §43 數值：
 *   card enter          opacity 0→1、translateY 8→0、280ms
 *   floating panel      translateX 12→0、320ms
 *   hover               translateY -1、shadow +10%
 *   live speaking       avatar 底部微光暈 + tiny pulse（不整張卡閃爍）
 */
import * as React from 'react';

/** 一組動效值（對應 framer-motion 的 target / transition 物件）。 */
export type MotionValues = Record<string, unknown>;

export interface MotionPreset {
  initial?: MotionValues;
  animate?: MotionValues;
  exit?: MotionValues;
  whileHover?: MotionValues;
  whileTap?: MotionValues;
  transition?: MotionValues;
}

/** §43 ease — 與 --ease-out-soft 同一條曲線。 */
export const EASE_OUT_SOFT = [0.22, 1, 0.36, 1] as const;

/** §43 Card enter：opacity 0→1、translateY 8→0、280ms。 */
export const cardEnter: MotionPreset = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
  transition: { duration: 0.28, ease: EASE_OUT_SOFT },
};

/** §43 Floating right panel：translateX 12→0、320ms。 */
export const floatIn: MotionPreset = {
  initial: { opacity: 0, x: 12 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 8 },
  transition: { duration: 0.32, ease: EASE_OUT_SOFT },
};

/** §43 Hover：translateY -1、陰影加深約 10%。 */
export const hoverLift: MotionPreset = {
  whileHover: { y: -1, boxShadow: 'var(--shadow-floating)' },
  whileTap: { y: 0 },
  transition: { duration: 0.14, ease: EASE_OUT_SOFT },
};

/** §43 Live Speaking：只有光暈做極輕的呼吸，不放大、不閃爍整張卡。 */
export const speakingPulse: MotionPreset = {
  animate: {
    opacity: [0.55, 1, 0.55],
    scale: [1, 1.015, 1],
  },
  transition: { duration: 1.8, repeat: Infinity, ease: 'easeInOut' },
};

/** 交錯進場（清單 / KPI 分割區塊）。 */
export const staggerChildren: MotionPreset = {
  animate: { transition: { staggerChildren: 0.045 } },
};

export const motionPresets = {
  cardEnter,
  floatIn,
  hoverLift,
  speakingPulse,
  staggerChildren,
} as const;

/** 幾乎不動的 fallback：只留 opacity，不做位移或重複動畫。 */
const REDUCED_MOTION_PRESET: MotionPreset = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0 },
};

/** 讀取一次 `prefers-reduced-motion`（SSR 時回傳 false）。 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * §47：使用者要求減少動態時，把 preset 降級成純淡入。
 * `reduced` 省略時會即時查詢媒體查詢；在元件內建議傳入 `useReducedMotion()` 的結果，
 * 這樣使用者中途改設定也會跟著更新。
 */
export function respectsReducedMotion(
  preset: MotionPreset,
  reduced: boolean = prefersReducedMotion(),
): MotionPreset {
  return reduced ? REDUCED_MOTION_PRESET : preset;
}

/** 訂閱 `prefers-reduced-motion` 的 hook（§47）。 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}
