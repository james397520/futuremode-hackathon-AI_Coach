'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { SegmentedControl, Tooltip } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useTheme, type ThemeMode } from './theme-provider';

const OPTIONS: Array<{ value: ThemeMode; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: '淺色', Icon: Sun },
  { value: 'dark', label: '深色', Icon: Moon },
  { value: 'system', label: '跟隨系統', Icon: Monitor },
];

/**
 * §6 — Light / Dark / System segmented control.
 *
 * Two presentations, because the icon rail is 64px collapsed and 232px expanded
 * (§11): `compact` cycles through the three modes from a single 44x44 button,
 * `full` shows the real segmented control once labels are visible.
 */
export function ThemeToggle({
  variant = 'full',
  className,
}: {
  variant?: 'full' | 'compact';
  className?: string;
}) {
  const { mode, resolved, setMode, hydrated } = useTheme();
  const active = OPTIONS.find((o) => o.value === mode) ?? OPTIONS[2]!;

  if (variant === 'compact') {
    const next = OPTIONS[(OPTIONS.findIndex((o) => o.value === mode) + 1) % OPTIONS.length]!;
    return (
      <Tooltip content={`外觀主題：${active.label}——切換為${next.label}`} side="right">
        <button
          type="button"
          className={cn('rail-item justify-center', className)}
          aria-label={`外觀主題：${active.label}。按下可切換為${next.label}。`}
          onClick={() => setMode(next.value)}
        >
          <active.Icon size={19} strokeWidth={1.6} aria-hidden />
        </button>
      </Tooltip>
    );
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <span className="meta-label px-1">外觀</span>
      <SegmentedControl<ThemeMode>
        value={mode}
        onValueChange={setMode}
        ariaLabel="色彩主題"
        size="sm"
        options={OPTIONS.map(({ value, label, Icon }) => ({
          value,
          label,
          icon: <Icon size={15} strokeWidth={1.7} aria-hidden />,
        }))}
      />
      <p className="text-tiny text-text-tertiary px-1" aria-live="polite">
        {hydrated
          ? mode === 'system'
            ? `跟隨裝置設定——目前為${resolved === 'dark' ? '深色' : '淺色'}`
            : `${active.label}模式`
          : '正在判斷主題…'}
      </p>
    </div>
  );
}
