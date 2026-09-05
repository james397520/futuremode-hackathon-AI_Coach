import type { Metadata } from 'next';
import { WorkspaceSelectPage } from '@/features/auth';
import { RequireSession } from '@/components/auth/require-session';

export const metadata: Metadata = { title: 'Choose a workspace' };

/** The workspace list comes from the authenticated session (`GET /auth/me`). */
export default function Page() {
  return (
    <RequireSession>
      <WorkspaceSelectPage />
    </RequireSession>
  );
}
