'use client';

/**
 * Restrained building blocks shared by the simulation cards.
 * §19 pastel pills, §21 inset cards, §22 hairline 4px meters (never a gauge — §99).
 */
import type { ReactNode } from 'react';

import { clampPercent } from '../lib/format';
import { insetSurface, meterGradient, pillSurface, tint, toneText, toneVar, type ToneKey } from '../lib/tone';
import { cn } from './kit';

// ---------------------------------------------------------------------------

export interface TonePillProps {
  tone?: ToneKey;
  children: ReactNode;
  icon?: ReactNode;
  /** 12–22% per §19. */
  fill?: number;
  className?: string;
  title?: string;
}

export function TonePill({ tone = 'blue', children, icon, fill = 16, className, title }: TonePillProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-pill px-2.5 py-1 text-tiny',
        className,
      )}
      style={pillSurface(tone, fill)}
    >
      {icon ? <span className="flex h-3 w-3 items-center justify-center">{icon}</span> : null}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------

export interface LiveDotProps {
  tone?: ToneKey;
  pulsing?: boolean;
  /**
   * Dot sits on an ink scrim over the persona portrait. The card mix
   * (`toneText`) is tuned to be dark-ish on light glass, so on a dark scrim it
   * would vanish; the raw accent is bright on ink in both themes.
   */
  onMedia?: boolean;
  className?: string;
}

export function LiveDot({ tone = 'mint', pulsing = false, onMedia = false, className }: LiveDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block h-1.5 w-1.5 rounded-pill', pulsing && 'sim-listening-dot', className)}
      style={{
        backgroundColor: onMedia
          ? tone === 'neutral'
            ? 'var(--text-on-media)'
            : toneVar(tone)
          : toneText(tone),
      }}
    />
  );
}

// ---------------------------------------------------------------------------

export interface MeterProps {
  label: string;
  /** 0–100. Always a value the server sent — the UI never interpolates its own. */
  value: number;
  tone?: ToneKey;
  /** Show a shimmer while a new value is settling. */
  live?: boolean;
  hint?: string;
}

/**
 * §22 — "使用非常細的 4px progress line。不要儀表板 speedometer。"
 * The width transition animates between *received* values only (§20).
 */
export function Meter({ label, value, tone = 'blue', live = false, hint }: MeterProps) {
  const pct = clampPercent(value);
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-meta text-text-secondary">{label}</span>
        <span className="text-meta tabular-nums" style={{ color: toneText(tone) }}>
          {Math.round(pct)}%
        </span>
      </div>
      <div
        className="h-1 w-full overflow-hidden rounded-pill"
        style={{ backgroundColor: tint('neutral', 16) }}
        role="meter"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={hint ? `${label} — ${hint}` : label}
      >
        <div
          className={cn('h-full rounded-pill', live && 'sim-meter-live')}
          style={{
            width: `${pct}%`,
            background: meterGradient(tone),
            transition: 'width 520ms var(--ease-out-soft)',
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface InsetBlockProps {
  tone?: ToneKey;
  fill?: number;
  className?: string;
  children: ReactNode;
}

/** §21 — 淡藍 inset card, 1px border, soft radius. */
export function InsetBlock({ tone = 'blue', fill = 9, className, children }: InsetBlockProps) {
  return (
    <div
      className={cn('rounded-card-sm border p-3.5', className)}
      style={insetSurface(tone, fill)}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface BulletProps {
  tone?: ToneKey;
  children: ReactNode;
  done?: boolean;
}

/** §21 小型圓點 bullet. */
export function Bullet({ tone = 'blue', children, done = false }: BulletProps) {
  return (
    <li className="flex items-start gap-2.5 text-body-sm text-text-secondary">
      <span
        aria-hidden="true"
        className="mt-[7px] inline-block h-1.5 w-1.5 shrink-0 rounded-pill"
        style={{ backgroundColor: done ? toneText('success') : toneText(tone) }}
      />
      {/* A ticked-off point is struck through and stepped down one text token —
          not faded: `opacity-70` took `--text-secondary` to 2.9:1 in light mode. */}
      <span className={cn(done && 'line-through decoration-1 text-text-tertiary')}>{children}</span>
    </li>
  );
}

// ---------------------------------------------------------------------------

export interface CardTitleProps {
  children: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function CardTitle({ children, eyebrow, action, className }: CardTitleProps) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <div className="text-tiny uppercase tracking-[0.08em] text-text-tertiary">{eyebrow}</div>
        ) : null}
        <h3 className="truncate text-card-title text-text-primary">{children}</h3>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

export interface KeyValueProps {
  label: string;
  value: ReactNode;
  mono?: boolean;
}

export function KeyValue({ label, value, mono = false }: KeyValueProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-meta text-text-tertiary">{label}</dt>
      <dd className={cn('text-meta text-text-primary', mono && 'tabular-nums')}>{value}</dd>
    </div>
  );
}
