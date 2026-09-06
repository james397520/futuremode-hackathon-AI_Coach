'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

/**
 * §94 Error Handling — plain language, no stack traces, and always a way forward.
 * The digest is shown because support needs it to correlate with server logs.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Client-side telemetry hook; never log user content here.
    console.error('[ai-coach] route error', error.digest ?? error.message);
  }, [error]);

  return (
    <div className="aurora-canvas flex min-h-[60vh] items-center justify-center p-6">
      <main className="glass-shell w-full max-w-lg p-8">
        {/* Raw warning on strong glass measured 1.7:1 — invisible. A warning tint
            well with the warning ink reads 4.3:1 in light, well above 3:1 for
            an icon, and stays above 10:1 in dark. */}
        <span
          className="ink-warning mb-5 flex h-12 w-12 items-center justify-center rounded-avatar bg-[color:color-mix(in_srgb,var(--warning)_16%,transparent)]"
          aria-hidden
        >
          <AlertTriangle size={22} strokeWidth={1.7} />
        </span>
        <h1 className="text-section">這個頁面發生了一些問題</h1>
        <p className="mt-2 text-body text-text-secondary">
          你的進度都已保留。進行中的練習仍在伺服器上執行，重新載入這個畫面不會遺失逐字稿或分數。
        </p>
        {error.digest ? (
          <p className="mt-3 text-tiny text-text-tertiary">
            請將這組代碼提供給客服：<code className="tabular-nums">{error.digest}</code>
          </p>
        ) : null}
        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-2 rounded-button bg-glass-card px-4 py-2 text-body-sm font-medium [box-shadow:var(--shadow-inset-hi)] hover:-translate-y-px"
          >
            <RotateCcw size={15} strokeWidth={1.8} aria-hidden />
            重試
          </button>
          <a
            href="/dashboard"
            className="rounded-button px-4 py-2 text-body-sm text-text-secondary hover:text-text-primary"
          >
            回到首頁
          </a>
        </div>
      </main>
    </div>
  );
}
