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
      title="Models"
      description="Providers and parameters for every model the platform calls. Changes apply to new sessions only — running sessions keep their pinned configuration."
      meta={<Pill tone="neutral" size="sm">Workspace scope</Pill>}
      actions={
        <Button variant="primary" size="sm" disabled={!canManage}>
          <Save size={15} strokeWidth={1.8} aria-hidden />
          Save changes
        </Button>
      }
    >
      {!canManage ? (
        <GlassCard className="p-4">
          <p className="flex items-start gap-2 text-body-sm text-text-secondary">
            <AlertTriangle size={15} strokeWidth={1.8} aria-hidden className="mt-0.5 shrink-0 text-state-warning" />
            You can view this configuration but not change it. Model changes are recorded in the audit log.
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
        <h2 className="text-card-title">Where the keys live</h2>
        <p className="mt-1 max-w-3xl text-body-sm text-text-secondary">
          Provider credentials are held in the server-side secrets manager and referenced by name here. No
          key is rendered on this page, stored in the browser, or included in the client bundle. Rotating a
          key is done in Integrations, not here.
        </p>
      </GlassCard>
    </SettingsShell>
  );
}
