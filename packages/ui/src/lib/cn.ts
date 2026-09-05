/**
 * cn() — clsx + tailwind-merge。
 *
 * 為什麼要自訂 tailwind-merge config：
 * `@ai-coach/design-tokens` 的 preset 新增了大量非標準 scale
 * （`text-card-title`、`rounded-card`、`shadow-floating`、`backdrop-blur-shell`…）。
 * tailwind-merge 預設不認得這些值，會把 `text-card-title` 誤判為 text-color，
 * 導致 `cn('text-card-title', 'text-text-primary')` 其中一個被吃掉。
 * 因此在這裡把 preset 的 scale 註冊回 tailwind-merge。
 *
 * 規則（spec §99）：元件內禁止 hardcode hex，只能用 preset utility 或 var(--token)。
 */
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      // §9 Radius
      borderRadius: ['shell', 'panel', 'card', 'card-sm', 'input', 'button', 'avatar', 'pill'],
      // §3 Glass blur（同時涵蓋 blur-* 與 backdrop-blur-*）
      blur: ['shell', 'card'],
      // §10/§11 Layout spacing
      spacing: ['rail', 'rail-expanded', 'safe'],
    },
    classGroups: {
      // §7 Typography scale
      'font-size': [
        {
          text: [
            'display',
            'page-title',
            'section',
            'card-title',
            'body',
            'body-sm',
            'meta',
            'tiny',
          ],
        },
      ],
      // §3 Elevation
      shadow: [{ shadow: ['soft', 'floating', 'shell', 'accent', 'accent-hover'] }],
      // §10 Shell
      'max-w': [{ 'max-w': ['shell'] }],
      // §43 Motion
      ease: [{ ease: ['out-soft'] }],
    },
  },
});

/** 合併 class 並解決 Tailwind utility 衝突（後者勝）。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export type { ClassValue };
