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
          'on-media': 'var(--text-on-media)',
          'on-media-dim': 'var(--text-on-media-dim)',
          'on-accent': 'var(--text-on-accent)',
          'on-pastel': 'var(--text-on-pastel)',
        },
        accent: {
          indigo: 'var(--accent-indigo)',
          blue: 'var(--accent-blue)',
          cyan: 'var(--accent-cyan)',
          mint: 'var(--accent-mint)',
          violet: 'var(--accent-violet)',
          /** solid fill under `text-text-on-accent` */
          solid: 'var(--accent-solid)',
          /** accent as text / icon on the glass (AA) */
          ink: 'var(--accent-ink)',
        },
        state: {
          success: 'var(--success)',
          warning: 'var(--warning)',
          danger: 'var(--danger)',
          info: 'var(--info)',
          /** semantic colour as *text* on the glass — the display values are pastel */
          'success-ink': 'var(--success-ink)',
          'warning-ink': 'var(--warning-ink)',
          'danger-ink': 'var(--danger-ink)',
          'info-ink': 'var(--info-ink)',
          /** solid fill under `text-text-on-accent` */
          'danger-solid': 'var(--danger-solid)',
        },
        surface: {
          solid: 'var(--surface-solid)',
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
        accent: 'var(--shadow-accent)',
        'accent-hover': 'var(--shadow-accent-hover)',
      },
      backdropBlur: {
        shell: 'var(--blur-shell)',
        card: 'var(--blur-card)',
      },
      fontFamily: { sans: 'var(--font-sans)' },
      fontSize: {
        display: ['32px', { lineHeight: '40px', letterSpacing: '-0.02em', fontWeight: '600' }],
        'page-title': ['18px', { lineHeight: '26px', letterSpacing: '-0.02em', fontWeight: '600' }],
        section: ['16px', { lineHeight: '24px', letterSpacing: '-0.015em', fontWeight: '600' }],
        'card-title': ['14px', { lineHeight: '21px', fontWeight: '600' }],
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
