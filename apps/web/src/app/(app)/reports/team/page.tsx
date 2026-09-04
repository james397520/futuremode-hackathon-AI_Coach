import type { Metadata } from 'next';
import { TeamReportPage } from '@/features/reports';

export const metadata: Metadata = { title: 'Team report' };

export default function Page() {
  return <TeamReportPage />;
}
