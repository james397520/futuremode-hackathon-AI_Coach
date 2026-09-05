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
      title="Voice"
      description="How the persona sounds, and how turn-taking behaves during a voice session."
      meta={<Pill tone="info" size="sm">Applies to new voice sessions</Pill>}
      actions={
        <Button variant="primary" size="sm" disabled={!canManage}>
          <Save size={15} strokeWidth={1.8} aria-hidden />
          Save
        </Button>
      }
    >
      <GlassCard className="p-5">
        <div className="flex items-center gap-2">
          <Volume2 size={16} strokeWidth={1.8} aria-hidden className="text-accent-blue" />
          <h2 className="text-card-title">Synthesis</h2>
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
            Preview voice
          </Button>
          <Button variant="ghost" size="sm">
            <Mic size={15} strokeWidth={1.8} aria-hidden />
            Test microphone
          </Button>
          <p className="text-tiny text-text-tertiary">
            Synthesis and transcription both run server-side; no provider key reaches the browser.
          </p>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <h2 className="text-card-title">Turn-taking</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          Voice activity detection drives end-of-turn. When the trainee starts speaking while the persona is
          talking, synthesis is cancelled and the session returns to listening without losing context.
        </p>
        <ol className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 text-body-sm text-text-secondary">
          {['AI speaking', 'Voice detected', 'Cancel synthesis', 'Listening', 'Transcribe', 'Continue context'].map(
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
        <h2 className="text-card-title">Accessibility</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          Captions and a full transcript are always available during and after a voice session — a voice
          session is never the only way to complete an assignment.
        </p>
      </GlassCard>
    </SettingsShell>
  );
}
