'use client';

import { type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import Image from 'next/image';
import { Button, GlassCard } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';

/**
 * There is no sign-in page. The API is part of the deployment, the provider
 * establishes a real session against it on load, and identity has no fixture
 * fallback — so the only two states here are "signed in" and "the API did not
 * answer".
 *
 * Redirecting to `/login` was wrong for both: with auto sign-in there was
 * nothing for a person to do on that page, and when the API was unreachable
 * (CORS, or simply not running) it turned a backend outage into a login form
 * that could never succeed.
 *
 * Both states below share the (auth) route group's own visual language — the
 * aurora stage and dot-matrix corner, a centred glass card — rather than a
 * bare string in the corner of an otherwise blank page.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="aurora-canvas relative flex min-h-screen items-center justify-center p-6">
        <div
          className="dot-matrix pointer-events-none absolute left-0 top-0 h-[52vh] w-[46vw] opacity-80"
          aria-hidden
        />
        <output aria-live="polite" className="relative w-full max-w-sm">
          <GlassCard
            tone="floating"
            className="flex flex-col items-center px-8 py-10 text-center"
          >
            {/* The mark itself is untouched — it is framed, not redesigned. The
                file is a square PNG with its own light ground, which is why it
                read as a white tile floating on the aurora; a rounded, clipped
                container with a hairline ring turns that same square into a
                deliberate app icon. */}
            <span
              className="boot-glow relative grid size-16 place-items-center overflow-hidden rounded-[20px] shadow-soft"
              style={{
                background: 'var(--glass-card-strong)',
                boxShadow:
                  '0 10px 30px -12px color-mix(in srgb, var(--accent-indigo) 55%, transparent)',
              }}
              aria-hidden
            >
              <span
                className="pointer-events-none absolute inset-0 rounded-[20px]"
                style={{
                  boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--text-primary) 10%, transparent)',
                }}
              />
              <Image src="/brand/logo-mark.png" alt="" width={44} height={44} priority />
            </span>

            <h1 className="mt-5 text-section">SkillCoach</h1>
            <p className="mt-1 text-body-sm text-text-secondary">企業訓練工作區</p>

            {/* Indeterminate, because the honest answer is that we do not know
                how long the API will take. A rail that pretends to know — a
                percentage, a filling bar — would be a fabricated number. */}
            <div
              className="boot-rail relative mt-7 h-1 w-full overflow-hidden rounded-pill"
              style={{ background: 'color-mix(in srgb, var(--text-primary) 12%, transparent)' }}
              aria-hidden
            />

            <p className="mt-3 text-tiny text-text-tertiary">正在連線到工作區…</p>
          </GlassCard>
        </output>
      </div>
    );
  }

  if (user == null) {
    return (
      <div className="aurora-canvas relative flex min-h-screen items-center justify-center p-6">
        <div
          className="dot-matrix pointer-events-none absolute left-0 top-0 h-[52vh] w-[46vw] opacity-80"
          aria-hidden
        />
        <GlassCard className="relative max-w-md p-7 text-center">
          <Image
            src="/brand/logo-mark.png"
            alt=""
            width={40}
            height={40}
            className="mx-auto"
            aria-hidden
          />
          <h1 className="mt-4 text-section">無法連線到 API</h1>
          <p className="mt-2 text-body-sm text-text-secondary">
            這個工作區的所有資料都來自 API，目前無法建立連線。請確認 API 服務已啟動，然後重試。
          </p>
          <Button
            variant="primary"
            size="md"
            className="mt-5 w-full"
            onClick={() => window.location.reload()}
          >
            <RefreshCw size={16} strokeWidth={1.9} aria-hidden />
            重試
          </Button>
        </GlassCard>
      </div>
    );
  }

  return <>{children}</>;
}
