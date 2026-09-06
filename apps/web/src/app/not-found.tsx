import Link from 'next/link';
import { Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="aurora-canvas flex min-h-screen items-center justify-center p-6">
      <div className="dot-matrix pointer-events-none fixed left-0 top-0 h-[40vh] w-[40vw] opacity-70" aria-hidden />
      <main className="glass-shell relative w-full max-w-md p-8 text-center">
        <span
          className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-avatar bg-glass-card text-accent-indigo"
          aria-hidden
        >
          <Compass size={22} strokeWidth={1.7} />
        </span>
        <h1 className="text-section">這個頁面不在工作區裡</h1>
        <p className="mt-2 text-body text-text-secondary">
          這個連結可能來自舊版本，或該項目已被封存。所有功能都可以從首頁或指令面板（⌘K）找到。
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link
            href="/dashboard"
            className="rounded-button bg-glass-card px-4 py-2 text-body-sm font-medium [box-shadow:var(--shadow-inset-hi)] hover:-translate-y-px"
          >
            回到首頁
          </Link>
          <Link
            href="/simulations"
            className="rounded-button px-4 py-2 text-body-sm text-text-secondary hover:text-text-primary"
          >
            模擬練習情境庫
          </Link>
        </div>
      </main>
    </div>
  );
}
