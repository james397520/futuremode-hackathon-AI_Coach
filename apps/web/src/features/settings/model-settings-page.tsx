'use client';

import { useState } from 'react';
import { AlertTriangle, Save } from 'lucide-react';
import { Button, Field, GlassCard, Input, Pill, Select, Switch } from '@/components/ui';
import { MODEL_SETTING_GROUPS } from '@/lib/fixtures/settings';
import { useCan } from '@/lib/auth-context';
import { SettingsShell } from './settings-shell';

/** §44 Model / AI Runtime Settings — LLM, embedding, reranker, speech, safety. */
export function ModelSettingsPage() {
  const canManage = useCan('model.manage');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      MODEL_SETTING_GROUPS.flatMap((group) => group.rows.map((row) => [row.id, row.value])),
    ),
  );

  const set = (id: string, value: string) => setValues((prev) => ({ ...prev, [id]: value }));

  return (
    <SettingsShell
      title="模型"
      description="平台呼叫的每一個模型，其服務供應商與參數。變更只會套用到新的練習；進行中的練習沿用當時鎖定的設定。"
      meta={<Pill tone="neutral" size="sm">工作區範圍</Pill>}
      actions={
        <Button variant="primary" size="sm" disabled={!canManage}>
          <Save size={15} strokeWidth={1.8} aria-hidden />
          儲存變更
        </Button>
      }
    >
      {!canManage ? (
        <GlassCard className="p-4">
          <p className="flex items-start gap-2 text-body-sm text-text-secondary">
            <AlertTriangle
              size={15}
              strokeWidth={1.8}
              aria-hidden
              className="mt-0.5 shrink-0 text-[color:color-mix(in_srgb,var(--warning)_40%,var(--text-primary))]"
            />
            你可以檢視這份設定，但無法變更。模型設定的異動都會寫入稽核紀錄。
          </p>
        </GlassCard>
      ) : null}

      {MODEL_SETTING_GROUPS.map((group) => (
        <GlassCard key={group.id} className="p-5">
          <h2 className="text-card-title">{group.title}</h2>
          <p className="mt-1 text-body-sm text-text-secondary">{group.description}</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {group.rows.map((row) => (
              <Field key={row.id} label={row.label} hint={row.note}>
                {row.kind === 'select' && row.options ? (
                  <Select
                    value={values[row.id] ?? row.value}
                    onValueChange={(value: string) => set(row.id, value)}
                    options={row.options.map((option) => ({ value: option, label: option }))}
                  />
                ) : row.kind === 'switch' ? (
                  <Switch
                    checked={(values[row.id] ?? row.value) === 'on'}
                    onCheckedChange={(checked: boolean) => set(row.id, checked ? 'on' : 'off')}
                    disabled={!canManage}
                    aria-label={row.label}
                  />
                ) : (
                  <Input
                    type={row.kind === 'number' ? 'number' : 'text'}
                    value={values[row.id] ?? row.value}
                    disabled={!canManage}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => set(row.id, event.target.value)}
                  />
                )}
              </Field>
            ))}
          </div>
        </GlassCard>
      ))}

      <GlassCard className="p-5">
        <h2 className="text-card-title">金鑰存放在哪裡</h2>
        <p className="mt-1 max-w-3xl text-body-sm text-text-secondary">
          服務供應商的憑證存放在伺服器端的密鑰管理服務，這裡只以名稱引用。任何金鑰都不會顯示在本頁、不會存在瀏覽器裡，
          也不會被打包進前端程式。金鑰輪替請到「整合」頁進行，不在這裡操作。
        </p>
      </GlassCard>
    </SettingsShell>
  );
}
