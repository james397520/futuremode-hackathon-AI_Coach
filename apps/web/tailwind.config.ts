import type { Config } from 'tailwindcss';
import { aiCoachPreset } from '@ai-coach/design-tokens/tailwind-preset';

/**
 * The whole visual system lives in `packages/design-tokens`.
 * This file only wires the preset up and declares where class names can appear.
 * Do not add colours / radii / shadows here — they belong in tokens.css (§99).
 */
const config: Config = {
  presets: [aiCoachPreset as Config],
  content: [
    './src/**/*.{ts,tsx,mdx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      screens: {
        // §46 — layout breakpoints come from design-tokens BREAKPOINTS.
        sm: '768px',
        md: '1024px',
        lg: '1200px',
        xl: '1440px',
        '2xl': '1800px',
      },
      keyframes: {
        'card-enter': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'soft-pulse': {
          '0%, 100%': { opacity: '0.45' },
          '50%': { opacity: '1' },
        },
        shimmer: {
          from: { backgroundPosition: '-200% 0' },
          to: { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'card-enter': 'card-enter var(--dur-card-enter) var(--ease-out-soft) both',
        'soft-pulse': 'soft-pulse 1.6s var(--ease-out-soft) infinite',
        shimmer: 'shimmer 1.8s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
