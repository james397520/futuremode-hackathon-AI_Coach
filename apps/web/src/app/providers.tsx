'use client';

import type { ReactNode } from 'react';
import { ToastViewport } from '@/components/ui';
import { ThemeProvider } from '@/components/theme';
import { RuntimeProvider } from '@/components/runtime';
import { AuthProvider } from '@/lib/auth-context';
import { QueryProvider } from '@/lib/query-client';

/**
 * §91 suggested component tree:
 *   ThemeProvider → RuntimeProvider → AuthProvider → AppShell
 *
 * QueryProvider sits outermost because AuthProvider will fetch the session with
 * TanStack Query once `/api/auth/me` exists (§48.5).
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <RuntimeProvider>
          <AuthProvider>
            {children}
            <ToastViewport />
          </AuthProvider>
        </RuntimeProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}
