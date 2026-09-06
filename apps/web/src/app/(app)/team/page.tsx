import type { Metadata } from 'next';
import { TeamPage } from '@/features/team';

export const metadata: Metadata = { title: '團隊' };

export default function Page() {
  return <TeamPage />;
}
