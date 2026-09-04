/**
 * Tailwind preset — 把 CSS 變數映射成 utility。
 * 關鍵決策（spec §48.2）：不用預設 shadcn theme；primitives 可用，
 * 但 glass / blur / gradient / spacing / card / button skin 全部自訂。
 */
import type { Config } from 'tailwindcss';

export const aiCoachPreset: Partial<Config> = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg-canvas)',
        'canvas-soft': 'var(--bg-canvas-soft)',
        glass: {
          shell: 'var(--glass-shell)',
          card: 'var(--glass-card)',
          strong: 'var(--glass-card-strong)',
        },
        border: {
          glass: 'var(--border-glass)',
          soft: 'var(--border-soft)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
        },
        accent: {
          indigo: 'var(--accent-indigo)',
          blue: 'var(--accent-blue)',
          cyan: 'var(--accent-cyan)',
          mint: 'var(--accent-mint)',
          violet: 'var(--accent-violet)',
        },
        state: {
          success: 'var(--success)',
          warning: 'var(--warning)',
          danger: 'var(--danger)',
          info: 'var(--info)',
        },
      },
      borderRadius: {
        shell: 'var(--radius-shell)',
        panel: 'var(--radius-panel)',
        card: 'var(--radius-card)',
        'card-sm': 'var(--radius-card-sm)',
        input: 'var(--radius-input)',
        button: 'var(--radius-button)',
        avatar: 'var(--radius-avatar)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
        floating: 'var(--shadow-floating)',
        shell: 'var(--shadow-shell)',
      },
      backdropBlur: {
        shell: 'var(--blur-shell)',
        card: 'var(--blur-card)',
      },
      fontFamily: { sans: 'var(--font-sans)' },
      fontSize: {
        display: ['42px', { lineHeight: '48px', letterSpacing: '-0.02em', fontWeight: '600' }],
        'page-title': ['32px', { lineHeight: '40px', letterSpacing: '-0.015em', fontWeight: '600' }],
        section: ['22px', { lineHeight: '30px', letterSpacing: '-0.015em', fontWeight: '600' }],
        'card-title': ['16px', { lineHeight: '24px', fontWeight: '600' }],
        body: ['14px', { lineHeight: '22px' }],
        'body-sm': ['13px', { lineHeight: '19px' }],
        meta: ['12px', { lineHeight: '17px', fontWeight: '500' }],
        tiny: ['11px', { lineHeight: '15px', fontWeight: '500' }],
      },
      spacing: {
        rail: 'var(--rail-width)',
        'rail-expanded': 'var(--rail-width-expanded)',
        safe: 'var(--shell-safe-area)',
      },
      maxWidth: { shell: 'var(--shell-max-width)' },
      transitionTimingFunction: { 'out-soft': 'var(--ease-out-soft)' },
    },
  },
};

export default aiCoachPreset;
