import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';

/** Everything inside `(app)` renders in the floating glass shell (§10 / §11). */
export default function AppGroupLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
