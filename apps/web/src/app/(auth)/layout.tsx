import type { ReactNode } from 'react';

/**
 * §58-1 / §58-2 — login and workspace selection get the aurora background and a
 * centred glass card, but no app shell: there is no workspace context yet, so an
 * icon rail would be lying about what is navigable.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="aurora-canvas relative flex min-h-screen items-center justify-center p-6">
      <div className="dot-matrix pointer-events-none absolute left-0 top-0 h-[52vh] w-[46vw] opacity-80" aria-hidden />
      <main id="workspace-main" className="relative w-full max-w-md" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
