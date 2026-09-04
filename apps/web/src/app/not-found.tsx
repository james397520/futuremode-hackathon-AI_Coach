import Link from 'next/link';
import { Compass } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="aurora-canvas flex min-h-screen items-center justify-center p-6">
      <div className="dot-matrix pointer-events-none fixed left-0 top-0 h-[40vh] w-[40vw] opacity-70" aria-hidden />
      <main className="glass-shell relative w-full max-w-md p-8 text-center">
        <span
          className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-avatar bg-glass-strong text-accent-indigo"
          aria-hidden
        >
          <Compass size={22} strokeWidth={1.7} />
        </span>
        <h1 className="text-section">This page is not part of the workspace</h1>
        <p className="mt-2 text-body text-text-secondary">
          The link may be from an older version, or the item was archived. Everything is reachable
          from the dashboard or the command palette (⌘K).
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link
            href="/dashboard"
            className="rounded-button bg-glass-strong px-4 py-2 text-body-sm font-medium shadow-soft hover:-translate-y-px"
          >
            Back to dashboard
          </Link>
          <Link
            href="/simulations"
            className="rounded-button px-4 py-2 text-body-sm text-text-secondary hover:text-text-primary"
          >
            Simulation library
          </Link>
        </div>
      </main>
    </div>
  );
}
