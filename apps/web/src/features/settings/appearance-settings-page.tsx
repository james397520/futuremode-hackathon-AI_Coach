'use client';

import { GlassCard, Pill, Switch } from '@/components/ui';
import { ThemeToggle, useTheme } from '@/components/theme';
import { SettingsShell } from './settings-shell';

const THEME_MODE_LABEL: Record<string, string> = {
  light: '淺色',
  dark: '深色',
  system: '跟隨系統',
};

/** §58-37 Theme / Appearance (§6 theme mode, §43 motion, §47 reduced motion). */
export function AppearanceSettingsPage() {
  const { mode, resolved } = useTheme();

  return (
    <SettingsShell
      title="外觀"
      description="選擇整個產品採用的工作區主題與動態效果偏好。"
      meta={
        <>
          <Pill tone="neutral" size="sm">已選擇：{THEME_MODE_LABEL[mode] ?? mode}</Pill>
          <Pill tone="neutral" size="sm">目前呈現：{THEME_MODE_LABEL[resolved] ?? resolved}</Pill>
        </>
      }
    >
      <GlassCard className="p-5">
        <h2 className="text-card-title">主題</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          你的選擇會記在這台裝置上，並在首次繪製前就套用，所以切換主題不會讓畫面閃爍。
        </p>
        <ThemeToggle className="mt-4 max-w-xs" />
      </GlassCard>

      <div className="grid gap-4 sm:grid-cols-2">
        <GlassCard className="p-5">
          <p className="meta-label">淺色</p>
          <div className="mt-3 space-y-2">
            <div className="rounded-card-sm border border-border-soft bg-glass-card p-3">
              <p className="text-body-sm font-medium">柔和薰衣草工作區</p>
              <p className="mt-1 text-tiny text-text-tertiary">沉靜的米白色面板，搭配收斂的紫色點綴</p>
            </div>
            <div className="flex gap-1.5">
              <span className="gradient-pill px-2.5 py-1 text-tiny">狀態標籤</span>
              <span className="rounded-pill border border-border-soft px-2.5 py-1 text-tiny text-text-secondary">
                一般
              </span>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <p className="meta-label">深色</p>
          <div className="mt-3 space-y-2">
            <div className="rounded-card-sm border border-border-soft bg-glass-card p-3">
              <p className="text-body-sm font-medium">薰衣草炭灰工作區</p>
              <p className="mt-1 text-tiny text-text-tertiary">低眩光面板，維持同樣緊湊的層次</p>
            </div>
            <div className="flex gap-1.5">
              <span className="gradient-pill px-2.5 py-1 text-tiny">狀態標籤</span>
              <span className="rounded-pill border border-border-soft px-2.5 py-1 text-tiny text-text-secondary">
                一般
              </span>
            </div>
          </div>
        </GlassCard>
      </div>

      <GlassCard className="p-5">
        <h2 className="text-card-title">動態效果</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          轉場都很短，而且帶有緩動。如果你的作業系統要求減少動態效果，動畫時間會自動縮到趨近於零——不需要另外設定。
        </p>
        <div className="mt-4 space-y-3">
          <Switch checked onCheckedChange={() => undefined} label="卡片進場動畫" />
          <Switch checked onCheckedChange={() => undefined} label="主題柔和淡入淡出" />
          <Switch checked={false} onCheckedChange={() => undefined} label="減少所有動態效果（會覆寫上面的設定）" />
        </div>
      </GlassCard>
    </SettingsShell>
  );
}
