/**
 * AiSparkle — spec §86 AI Sparkle。
 *
 * ✦ 用來標記「這是 AI 產生 / AI 功能」：AI Coach、Generate、Summarize、
 * Transcript Ready、AI Insight。§86 明確要求「避免每個功能都加 ✦」，
 * 因此這是刻意獨立的小元件，由呼叫端決定是否出現。
 *
 * 顏色來自 --accent-indigo → --accent-cyan → --accent-mint 的小面積漸層（§86），
 * 不做大面積 purple gradient text（§99）。
 */
import * as React from 'react';

import { cn } from '../lib/cn';

export type AiSparkleTone = 'gradient' | 'current';

export interface AiSparkleProps extends Omit<React.SVGProps<SVGSVGElement>, 'children'> {
  /** 邊長（px）。§85 建議 icon 18–20px；inline 標記用 12–14px。 */
  size?: number;
  /** `gradient` 使用 token 漸層；`current` 繼承 currentColor（放在彩色 pill 內時用）。 */
  tone?: AiSparkleTone;
  /** AI 正在運算時的柔和呼吸感（§44 `✦ Thinking…`）。會遵守 reduced motion。 */
  pulse?: boolean;
  /** 預設是純裝飾（aria-hidden）。需要被讀出時傳入 label。 */
  label?: string;
}

export const AiSparkle = React.forwardRef<SVGSVGElement, AiSparkleProps>(function AiSparkle(
  { size = 14, tone = 'gradient', pulse = false, label, className, ...props },
  ref,
) {
  // useId 會產生帶 ":" 的字串，直接放進 url(#id) 在部分瀏覽器會失效，故清掉。
  const rawId = React.useId();
  const gradientId = `ai-sparkle-${rawId.replace(/:/g, '')}`;

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role={label ? 'img' : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cn(
        'shrink-0',
        pulse && 'animate-pulse motion-reduce:animate-none',
        className,
      )}
      {...props}
    >
      {tone === 'gradient' ? (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="var(--accent-indigo)" />
            <stop offset="52%" stopColor="var(--accent-cyan)" />
            <stop offset="100%" stopColor="var(--accent-mint)" />
          </linearGradient>
        </defs>
      ) : null}
      {/* 四角星：主星 + 一顆小星，符合參考圖的細緻感 */}
      <path
        d="M12 2.4c.36 2.66 1.05 4.55 2.07 5.66 1.02 1.11 2.92 1.75 5.7 1.94-2.78.19-4.68.83-5.7 1.94-1.02 1.1-1.71 3-2.07 5.66-.36-2.66-1.05-4.56-2.07-5.66-1.02-1.11-2.92-1.75-5.7-1.94 2.78-.19 4.68-.83 5.7-1.94C10.95 6.95 11.64 5.06 12 2.4Z"
        fill={tone === 'gradient' ? `url(#${gradientId})` : 'currentColor'}
      />
      <path
        d="M18.6 15.2c.18 1.2.5 2.05.96 2.55.46.5 1.31.79 2.54.87-1.23.09-2.08.38-2.54.88-.46.5-.78 1.35-.96 2.55-.18-1.2-.5-2.05-.96-2.55-.46-.5-1.31-.79-2.54-.88 1.23-.08 2.08-.37 2.54-.87.46-.5.78-1.35.96-2.55Z"
        fill={tone === 'gradient' ? `url(#${gradientId})` : 'currentColor'}
        opacity="0.7"
      />
    </svg>
  );
});
