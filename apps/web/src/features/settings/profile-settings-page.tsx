'use client';

import { useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { Avatar, Button, Field, GlassCard, Input, Pill, Select, Switch } from '@/components/ui';
import { NOTIFICATION_KIND_LABEL, type NotificationKind } from '@/lib/fixtures/notifications';
import { useAuth } from '@/lib/auth-context';
import { ROLE_LABEL } from '@/lib/rbac';
import { SettingsShell } from './settings-shell';

const CHANNELS = ['In app', 'Email', 'Teams'] as const;

const CHANNEL_LABEL: Record<(typeof CHANNELS)[number], string> = {
  'In app': '應用程式內',
  Email: '電子郵件',
  Teams: 'Teams',
};

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
      title="個人資料"
      description="你的個人資訊、語言、通知管道，以及這個瀏覽器保留的資料。"
      meta={
        <>
          {user?.roles.map((role) => (
            <Pill key={role} tone="neutral" size="sm">
              {ROLE_LABEL[role]}
            </Pill>
          ))}
          {isMock ? <Pill tone="warning" size="sm">示範模式</Pill> : null}
        </>
      }
      actions={
        <Button variant="primary" size="sm">
          <Save size={15} strokeWidth={1.8} aria-hidden />
          儲存
        </Button>
      }
    >
      <GlassCard className="p-5">
        <div className="flex items-center gap-4">
          <Avatar name={user?.display_name ?? '未知'} size="lg" />
          <div className="min-w-0">
            <h2 className="text-card-title">{user?.display_name ?? '尚未登入'}</h2>
            <p className="text-body-sm text-text-tertiary">{user?.email ?? '—'}</p>
            <p className="mt-0.5 text-tiny text-text-tertiary">
              {workspace?.name ?? '尚未指定工作區'} · 角色由你的身分提供者派發
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="顯示名稱">
            <Input
              value={displayName}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDisplayName(event.target.value)}
            />
          </Field>
          <Field label="公司電子郵件" hint="由你的身分提供者管理。">
            <Input value={user?.email ?? ''} readOnly disabled />
          </Field>
          <Field label="介面語言">
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
          <Field label="字幕語言" hint="語音練習期間使用。">
            <Select
              value="zh-TW"
              onValueChange={() => undefined}
              options={[
                { value: 'zh-TW', label: '繁體中文' },
                { value: 'en', label: 'English' },
                { value: 'off', label: '關閉' },
              ]}
            />
          </Field>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <h2 className="text-card-title">通知</h2>
        <p className="mt-1 text-body-sm text-text-secondary">
          安全性警告與審查請求一律會在應用程式內送達，而且無法關閉。
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="border-b border-border-soft text-left">
                <th scope="col" className="px-2 py-2 text-tiny font-medium uppercase text-text-tertiary">
                  通知類型
                </th>
                {CHANNELS.map((channel) => (
                  <th key={channel} scope="col" className="px-2 py-2 text-tiny font-medium uppercase text-text-tertiary">
                    {CHANNEL_LABEL[channel]}
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
                      {locked ? <span className="ml-2 text-tiny text-text-tertiary">（一律開啟）</span> : null}
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
                            aria-label={`${NOTIFICATION_KIND_LABEL[kind]}：透過${CHANNEL_LABEL[channel]}`}
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
        <h2 className="text-card-title">這台裝置上的資料</h2>
        <p className="mt-1 max-w-3xl text-body-sm text-text-secondary">
          這個瀏覽器只會存放你的主題選擇、導覽釘選狀態，以及——在你啟用本機加速時——快取的模型檔案。
          逐字稿、分數與知識內容預設都不會被快取，而且登出時這裡的一切都會清除。
        </p>
        <Button variant="ghost" size="sm" className="mt-4">
          <Trash2 size={15} strokeWidth={1.8} aria-hidden />
          立即清除本機資料
        </Button>
      </GlassCard>
    </SettingsShell>
  );
}
