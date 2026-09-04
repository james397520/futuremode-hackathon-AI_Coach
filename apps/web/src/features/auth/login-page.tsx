'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { KeyRound, Loader2, Sparkles } from 'lucide-react';
import { Button, Field, GlassCard, Input } from '@/components/ui';
import { MOCK_CURRENT_USER } from '@/lib/fixtures/identity';

/**
 * §58-1 Login.
 *
 * MOCK: no credentials are checked here and nothing is stored in the browser.
 * A real sign-in posts to `/api/auth/login`, which sets an HttpOnly session
 * cookie — the browser never holds a token, and never an API key (§70/§71).
 * SSO is the primary path for enterprise workspaces (§43 identity connectors).
 */
export function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(MOCK_CURRENT_USER.email);
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);

  return (
    <GlassCard tone="strong" className="p-8">
      <div className="mb-7 flex items-center gap-3">
        <span className="gradient-pill flex h-10 w-10 items-center justify-center" aria-hidden>
          <Sparkles size={19} strokeWidth={1.9} />
        </span>
        <div>
          <h1 className="text-section">AI Coach</h1>
          <p className="text-body-sm text-text-secondary">企業情境模擬與能力評估</p>
        </div>
      </div>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          // MOCK: skip straight to workspace selection.
          router.push('/workspace-select');
        }}
      >
        <Field label="工作信箱" hint="請使用公司信箱，以便找到你的工作區。">
          <Input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)}
          />
        </Field>

        <Field label="密碼">
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)}
          />
        </Field>

        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
          {pending ? <Loader2 size={16} strokeWidth={2} className="animate-spin" aria-hidden /> : null}
          {pending ? '登入中…' : '登入'}
        </Button>
      </form>

      <div className="my-6 flex items-center gap-3 text-tiny text-text-tertiary">
        <span className="h-px flex-1 bg-border-soft" aria-hidden />
        或使用以下方式繼續
        <span className="h-px flex-1 bg-border-soft" aria-hidden />
      </div>

      <div className="space-y-2">
        <Button variant="secondary" size="md" className="w-full" onClick={() => router.push('/workspace-select')}>
          <KeyRound size={16} strokeWidth={1.8} aria-hidden />
          Microsoft Entra ID（單一登入）
        </Button>
        <Button variant="ghost" size="md" className="w-full" onClick={() => router.push('/workspace-select')}>
          Google 工作區
        </Button>
      </div>

      <p className="mt-7 text-tiny text-text-tertiary">
        存取權由工作區管理者設定。登入、匯出與權限變更都會記錄於稽核日誌。{' '}
        <Link href="/security" className="text-accent-indigo hover:underline">
          安全與稽核
        </Link>
      </p>
    </GlassCard>
  );
}
