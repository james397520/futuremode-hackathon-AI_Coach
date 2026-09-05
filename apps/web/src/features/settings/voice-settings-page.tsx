'use client';

import { useState } from 'react';
import { Mic, Save, Volume2 } from 'lucide-react';
import { Button, Field, GlassCard, Input, Pill, Select, Slider, Switch } from '@/components/ui';
import { VOICE_SETTINGS } from '@/lib/fixtures/settings';
import { useCan } from '@/lib/auth-context';
import { SettingsShell } from './settings-shell';

/** §22.4 Voice Settings — provider, voice, speed, stability, barge-in, captions. */
export function VoiceSettingsPage() {
  const canManage = useCan('model.manage');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(VOICE_SETTINGS.map((setting) => [setting.id, setting.value])),
  );

  const set = (id: string, value: string) => setValues((prev) => ({ ...prev, [id]: value }));

  return (
    <SettingsShell
      title="語音"
      description="模擬人物聽起來是什麼樣子，以及語音練習中輪流發言的行為。"
      meta={<Pill tone="info" size="sm">套用於新的語音練習</Pill>}
      actions={
        <Button variant="primary" size="sm" disabled={!canManage}>
          <Save size={15} strokeWidth={1.8} aria-hidden />
          儲存
        </Button>
      }
    >
      <GlassCard className="p-5">
        <div className="flex items-center gap-2">
          <Volume2 size={16} strokeWidth={1.8} aria-hidden className="text-accent-blue" />
          <h2 className="text-card-title">語音合成</h2>
        </div>

        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          {VOICE_SETTINGS.map((setting) => (
            <div key={setting.id} className={setting.kind === 'slider' ? 'sm:col-span-1' : undefined}>
              {setting.kind === 'slider' ? (
                <Slider
                  label={setting.label}
                  hint={setting.hint}
                  min={setting.min ?? 0}
                  max={setting.max ?? 1}
                  step={setting.step ?? 0.05}
                  value={Number(values[setting.id] ?? setting.value)}
                  disabled={!canManage}
                  onValueChange={(value: number) => set(setting.id, String(value))}
                />
              ) : setting.kind === 'switch' ? (
                <div>
                  <Switch
                    checked={(values[setting.id] ?? setting.value) === 'on'}
                    onCheckedChange={(checked: boolean) => set(setting.id, checked ? 'on' : 'off')}
                    disabled={!canManage}
                    label={setting.label}
                  />
                  {setting.hint ? <p className="mt-1 text-tiny text-text-tertiary">{setting.hint}</p> : null}
                </div>
              ) : (
                <Field label={setting.label} hint={setting.hint}>
                  {setting.kind === 'select' && setting.options ? (
                    <Select
                      value={values[setting.id] ?? setting.value}
                      onValueChange={(value: string) => set(setting.id, value)}
                      options={setting.options.map((option) => ({ value: option, label: option }))}
                    />
                  ) : (
                    <Input
                      type="number"
                      value={values[setting.id] ?? setting.value}
                      disabled={!canManage}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) => set(setting.id, event.target.value)}
                    />
                  )}
                </Field>
              )}
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border-soft pt-4">
          <Button variant="secondary" size="sm">
            <Volume2 size={15} strokeWidth={1.8} aria-hidden />
            試聽語音
          </Button>
          <Button variant="ghost" size="sm">
            <Mic size={15} strokeWidth={1.8} aria-hidden />
            測試麥克風
          </Button>
          <p className="text-tiny text-text-tertiary">
            語音合成與轉錄都在伺服器端執行；服務供應商的金鑰不會傳到瀏覽器。
          </p>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <h2 className="text-card-title">輪流發言</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          由語音活動偵測判斷一個回合何時結束。當模擬人物還在說話、學員就開口時，系統會取消語音合成，
          並回到聆聽狀態，且不會遺失對話脈絡。
        </p>
        <ol className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 text-body-sm text-text-secondary">
          {['AI 說話中', '偵測到語音', '取消合成', '聆聽中', '轉錄', '延續脈絡'].map(
            (stage, index, all) => (
              <li key={stage} className="flex items-center gap-2">
                <span className="rounded-pill bg-glass-card px-2.5 py-1">{stage}</span>
                {index < all.length - 1 ? <span aria-hidden className="text-text-tertiary">→</span> : null}
              </li>
            ),
          )}
        </ol>
      </GlassCard>

      <GlassCard className="p-5">
        <h2 className="text-card-title">無障礙</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          語音練習期間與結束之後，字幕與完整逐字稿都一定看得到——語音練習絕不會是完成指派任務的唯一方式。
        </p>
      </GlassCard>
    </SettingsShell>
  );
}
