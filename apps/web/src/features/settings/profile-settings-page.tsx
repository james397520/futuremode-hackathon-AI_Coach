'use client';

import { useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { Avatar, Button, Field, GlassCard, Input, Pill, Select, Switch } from '@/components/ui';
import { NOTIFICATION_KIND_LABEL, type NotificationKind } from '@/lib/fixtures/notifications';
import { useAuth } from '@/lib/auth-context';
import { ROLE_LABEL } from '@/lib/rbac';
import { SettingsShell } from './settings-shell';

const CHANNELS = ['In app', 'Email', 'Teams'] as const;

/** §58-38 User Settings, plus §37 notification channels and §61 local data. */
export function ProfileSettingsPage() {
  const { user, workspace, isMock } = useAuth();
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [language, setLanguage] = useState('zh-TW');
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});

  const toggle = (key: string) => setPrefs((prev) => ({ ...prev, [key]: !(prev[key] ?? true) }));
  const isOn = (key: string) => prefs[key] ?? true;

  return (
    <SettingsShell
      title="Profile"
      description="Your details, language, notification channels and the data this browser keeps."
      meta={
        <>
          {user?.roles.map((role) => (
            <Pill key={role} tone="neutral" size="sm">
              {ROLE_LABEL[role]}
            </Pill>
          ))}
          {isMock ? <Pill tone="warning" size="sm">Demo session</Pill> : null}
        </>
      }
      actions={
        <Button variant="primary" size="sm">
          <Save size={15} strokeWidth={1.8} aria-hidden />
          Save
        </Button>
      }
    >
      <GlassCard className="p-5">
        <div className="flex items-center gap-4">
          <Avatar name={user?.display_name ?? 'Unknown'} size="lg" />
          <div className="min-w-0">
            <h2 className="text-card-title">{user?.display_name ?? 'Not signed in'}</h2>
            <p className="text-body-sm text-text-tertiary">{user?.email ?? '—'}</p>
            <p className="mt-0.5 text-tiny text-text-tertiary">
              {workspace?.name ?? 'No workspace'} · roles are provisioned by your identity provider
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Display name">
            <Input
              value={displayName}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDisplayName(event.target.value)}
            />
          </Field>
          <Field label="Work email" hint="Managed by your identity provider.">
            <Input value={user?.email ?? ''} readOnly disabled />
          </Field>
          <Field label="Interface language">
            <Select
              value={language}
              onValueChange={setLanguage}
              options={[
                { value: 'zh-TW', label: '繁體中文' },
                { value: 'zh-CN', label: '简体中文' },
                { value: 'en', label: 'English' },
                { value: 'ja', label: '日本語' },
              ]}
            />
          </Field>
          <Field label="Caption language" hint="Used during voice sessions.">
            <Select
              value="zh-TW"
              onValueChange={() => undefined}
              options={[
                { value: 'zh-TW', label: '繁體中文' },
                { value: 'en', label: 'English' },
                { value: 'off', label: 'Off' },
              ]}
            />
          </Field>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <h2 className="text-card-title">Notifications</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          Security warnings and review requests are always delivered in app and cannot be turned off.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="border-b border-border-soft text-left">
                <th scope="col" className="px-2 py-2 text-tiny font-medium uppercase text-text-tertiary">
                  Notification
                </th>
                {CHANNELS.map((channel) => (
                  <th key={channel} scope="col" className="px-2 py-2 text-tiny font-medium uppercase text-text-tertiary">
                    {channel}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Object.keys(NOTIFICATION_KIND_LABEL) as NotificationKind[]).map((kind) => {
                const locked = kind === 'security_warning' || kind === 'review_required';
                return (
                  <tr key={kind} className="border-b border-border-soft/60 last:border-b-0">
                    <th scope="row" className="px-2 py-2.5 text-left font-normal">
                      {NOTIFICATION_KIND_LABEL[kind]}
                      {locked ? <span className="ml-2 text-tiny text-text-tertiary">(always on)</span> : null}
                    </th>
                    {CHANNELS.map((channel) => {
                      const key = `${kind}:${channel}`;
                      const forcedOn = locked && channel === 'In app';
                      return (
                        <td key={key} className="px-2 py-2.5">
                          <Switch
                            checked={forcedOn ? true : isOn(key)}
                            disabled={forcedOn}
                            onCheckedChange={() => toggle(key)}
                            aria-label={`${NOTIFICATION_KIND_LABEL[kind]} via ${channel}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <h2 className="text-card-title">Data on this device</h2>
        <p className="mt-1 max-w-3xl text-body-sm text-text-secondary">
          This browser stores only your theme choice, the navigation pin state and — if you enabled local
          acceleration — cached model files. No transcript, score or knowledge content is cached by default,
          and everything here is cleared when you sign out.
        </p>
        <Button variant="ghost" size="sm" className="mt-4">
          <Trash2 size={15} strokeWidth={1.8} aria-hidden />
          Clear local data now
        </Button>
      </GlassCard>
    </SettingsShell>
  );
}
