'use client';

import { GlassCard, Pill, Switch } from '@/components/ui';
import { ThemeToggle, useTheme } from '@/components/theme';
import { SettingsShell } from './settings-shell';

/** §58-37 Theme / Appearance (§6 theme mode, §43 motion, §47 reduced motion). */
export function AppearanceSettingsPage() {
  const { mode, resolved } = useTheme();

  return (
    <SettingsShell
      title="Appearance"
      description="Choose the workspace theme and motion preferences used across the product."
      meta={
        <>
          <Pill tone="neutral" size="sm">Selected: {mode}</Pill>
          <Pill tone="neutral" size="sm">Rendering: {resolved}</Pill>
        </>
      }
    >
      <GlassCard className="p-5">
        <h2 className="text-card-title">Theme</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          Your choice is remembered on this device and applied before the first paint, so switching never
          flashes the page.
        </p>
        <ThemeToggle className="mt-4 max-w-xs" />
      </GlassCard>

      <div className="grid gap-4 sm:grid-cols-2">
        <GlassCard className="p-5">
          <p className="meta-label">Light</p>
          <div className="mt-3 space-y-2">
            <div className="rounded-card-sm border border-border-soft bg-glass-card p-3">
              <p className="text-body-sm font-medium">Soft lavender workspace</p>
              <p className="mt-1 text-tiny text-text-tertiary">Quiet off-white surfaces with restrained purple accents</p>
            </div>
            <div className="flex gap-1.5">
              <span className="gradient-pill px-2.5 py-1 text-tiny">Status pill</span>
              <span className="rounded-pill border border-border-soft px-2.5 py-1 text-tiny text-text-secondary">
                Neutral
              </span>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <p className="meta-label">Dark</p>
          <div className="mt-3 space-y-2">
            <div className="rounded-card-sm border border-border-soft bg-glass-card p-3">
              <p className="text-body-sm font-medium">Lavender charcoal workspace</p>
              <p className="mt-1 text-tiny text-text-tertiary">Low-glare surfaces with the same compact hierarchy</p>
            </div>
            <div className="flex gap-1.5">
              <span className="gradient-pill px-2.5 py-1 text-tiny">Status pill</span>
              <span className="rounded-pill border border-border-soft px-2.5 py-1 text-tiny text-text-secondary">
                Neutral
              </span>
            </div>
          </div>
        </GlassCard>
      </div>

      <GlassCard className="p-5">
        <h2 className="text-card-title">Motion</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          Transitions are short and eased. If your operating system requests reduced motion, animation
          durations collapse to nearly zero automatically — no setting needed.
        </p>
        <div className="mt-4 space-y-3">
          <Switch checked onCheckedChange={() => undefined} label="Card entrance animation" />
          <Switch checked onCheckedChange={() => undefined} label="Soft theme cross-fade" />
          <Switch checked={false} onCheckedChange={() => undefined} label="Reduce all motion (overrides the above)" />
        </div>
      </GlassCard>
    </SettingsShell>
  );
}
