import type { Metadata } from 'next';
import { WorkspaceSelectPage } from '@/features/auth';

export const metadata: Metadata = { title: 'Choose a workspace' };

export default function Page() {
  return <WorkspaceSelectPage />;
}
