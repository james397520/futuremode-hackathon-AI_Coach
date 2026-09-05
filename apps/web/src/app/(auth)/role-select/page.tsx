import type { Metadata } from 'next';
import { RoleSelectPage } from '@/features/auth';
import { RequireSession } from '@/components/auth/require-session';

export const metadata: Metadata = { title: '選擇工作身份' };

/** Roles come from the authenticated session, so there is nothing to choose without one. */
export default function Page() {
  return (
    <RequireSession>
      <RoleSelectPage />
    </RequireSession>
  );
}
