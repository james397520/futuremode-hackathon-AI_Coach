import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { RequireSession } from '@/components/auth/require-session';

/**
 * Everything inside `(app)` renders in the floating glass shell (§10 / §11),
 * and only for a browser holding a real API session — identity has no fixture
 * fallback, so without one there is no user, no workspace and no roles to draw.
 */
export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return (
    <RequireSession>
      <AppShell>{children}</AppShell>
    </RequireSession>
  );
}
